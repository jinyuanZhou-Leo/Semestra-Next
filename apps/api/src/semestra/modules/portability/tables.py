"""A portability adapter built from a description of a module's tables (M13 §3).

A module lists its tables parents first, each with the columns that point at other rows:

    table_adapter(
        module="grading",
        schema_version=1,
        depends_on=("academics",),
        tables=(
            Table(GradingScale, "scales", refs={"program_id": "required"}),
            Table(GradingCategory, "categories", refs={"course_id": "required"}),
            ...
        ),
    )

Export writes `{"schema_version": n, "<key>": [row, ...]}` with every column but `user_id` (and
`exclude`, for secrets). Import gives each row a new id, rewrites references through the shared
id map and drops a row whose required reference was not imported. Ids that appear inside other
strings and JSON values (card lists, settings, UI state keys) are rewritten the same way; ids are
UUIDs, so they cannot be confused with other text.
"""

import re
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, time
from typing import Any, Literal

from sqlalchemy import JSON, Date, DateTime, Time, delete, inspect, not_, select

from semestra.core.context import Ctx
from semestra.core.db import Base, new_id
from semestra.modules.portability.registry import (
    IdMap,
    ImportOptions,
    ImportReport,
    Writer,
    register_portability,
)

RefKind = Literal["required", "optional", "scope"]
"""`required`: the row is dropped when the target was not imported. `optional`: the reference
becomes null instead. `scope`: like required, but '' and null (the account level) stay."""

_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")

Transform = Callable[[Ctx, dict[str, Any], ImportOptions], Awaitable[dict[str, Any] | None]]


@dataclass(frozen=True)
class Table:
    model: type[Base]
    key: str
    refs: Mapping[str, RefKind] = field(default_factory=lambda: {})
    # The column that holds the row's own id (regenerated on import); None for tables keyed by
    # their references or by natural keys.
    id_column: str | None = "id"
    # Columns that never leave the server (secrets, health state).
    exclude: tuple[str, ...] = ()
    # False: purged with the account, but neither exported nor touched by a "replace" import.
    exported: bool = True
    # Preference rows (all, or those where `column == value`): imported only when asked, and
    # replaced only then.
    preferences: bool | tuple[str, Any] = False
    # Natural key (without user_id): an imported row overwrites an existing one with the same key.
    upsert_on: tuple[str, ...] | None = None
    # Runs on each row before it is written; returns None to leave the row out on purpose.
    transform: Transform | None = None
    # Adds computed fields to an exported row (they reach `transform` on import).
    on_export: Callable[[Any, dict[str, Any]], dict[str, Any]] | None = None
    # Most rows one user may have, when the module caps it; shown with the data overview's count.
    limit: int | None = None


def remap_value(value: Any, id_map: Mapping[str, str]) -> Any:
    """`value` with every id the import has mapped replaced by its new id."""
    if isinstance(value, str):
        return _UUID.sub(lambda m: id_map.get(m.group(0), m.group(0)), value) if value else value
    if isinstance(value, list):
        return [remap_value(v, id_map) for v in value]  # pyright: ignore[reportUnknownVariableType]
    if isinstance(value, dict):
        return {remap_value(k, id_map): remap_value(v, id_map) for k, v in value.items()}  # pyright: ignore[reportUnknownVariableType]
    return value


def _dump(value: Any) -> Any:
    if isinstance(value, datetime | date | time):
        return value.isoformat()
    return value


def _load(column: Any, value: Any) -> Any:
    if value is None:
        return None
    kind = column.type
    impl = getattr(kind, "impl", kind)
    if isinstance(impl, DateTime):
        return datetime.fromisoformat(value)
    if isinstance(impl, Date):
        return date.fromisoformat(value)
    if isinstance(impl, Time):
        return time.fromisoformat(value)
    return value


def _is_json(column: Any) -> bool:
    return isinstance(column.type, JSON)


def _is_preference(table: Table, row: Mapping[str, Any]) -> bool:
    if isinstance(table.preferences, bool):
        return table.preferences
    col, value = table.preferences
    return row.get(col) == value


def _preference_clause(table: Table) -> Any:
    col, value = table.preferences  # pyright: ignore[reportGeneralTypeIssues]
    return getattr(table.model, col) == value


class TableAdapter:
    def __init__(self, module: str, schema_version: int, tables: Sequence[Table]) -> None:
        self.module = module
        self.schema_version = schema_version
        self.tables = tuple(tables)

    def _columns(self, table: Table) -> list[Any]:
        return [
            c
            for c in inspect(table.model).columns
            if c.key != "user_id" and c.key not in table.exclude
        ]

    async def export(self, ctx: Ctx, writer: Writer) -> None:
        out: dict[str, Any] = {"schema_version": self.schema_version}
        for table in self.tables:
            if not table.exported:
                continue
            model: Any = table.model
            rows = await ctx.db.scalars(select(model).where(model.user_id == ctx.user_id))
            items: list[dict[str, Any]] = []
            for obj in rows:
                item = {c.key: _dump(getattr(obj, c.key)) for c in self._columns(table)}
                if table.on_export is not None:
                    item = table.on_export(obj, item)
                items.append(item)
            items.sort(key=lambda r: str(r.get(table.id_column or "", "")))
            out[table.key] = items
        writer.write_json(out)

    async def preview(self, payload: dict[str, Any]) -> dict[str, int]:
        return {t.key: len(payload.get(t.key) or []) for t in self.tables if t.exported}

    async def import_(
        self, ctx: Ctx, payload: dict[str, Any], id_map: Mapping[str, str], options: Any
    ) -> ImportReport:
        assert isinstance(id_map, IdMap)
        opts: ImportOptions = options
        report = ImportReport()
        for table in self.tables:
            if not table.exported:
                continue
            report.imported[table.key] = 0
            for raw in payload.get(table.key) or []:
                outcome = await self._import_row(ctx, table, raw, id_map, opts)
                if outcome == "imported":
                    report.imported[table.key] += 1
                elif outcome == "skipped":
                    report.skipped[table.key] = report.skipped.get(table.key, 0) + 1
            await ctx.db.flush()
        return report

    async def _import_row(
        self, ctx: Ctx, table: Table, raw: Any, id_map: IdMap, opts: ImportOptions
    ) -> Literal["imported", "skipped", "excluded"]:
        if not isinstance(raw, dict):
            return "skipped"
        row: dict[str, Any] = dict(raw)  # pyright: ignore[reportUnknownArgumentType]
        old_id = row.get(table.id_column) if table.id_column else None

        def exclude() -> Literal["excluded"]:
            if isinstance(old_id, str):
                id_map.excluded.add(old_id)
            return "excluded"

        if _is_preference(table, row) and not opts.include_preferences:
            return exclude()
        outcome = _remap_refs(table, row, id_map)
        if outcome == "excluded":
            return exclude()
        if outcome == "skipped":
            return "skipped"
        if table.transform is not None:
            transformed = await table.transform(ctx, row, opts)
            if transformed is None:
                return exclude()
            row = transformed
        values = self._values(table, row, id_map)
        if table.id_column:
            if not isinstance(old_id, str) or not old_id:
                return "skipped"
            values[table.id_column] = id_map.setdefault(old_id, new_id())
        values["user_id"] = ctx.user_id
        if not await _upsert(ctx, table, values, old_id, id_map):
            model: Any = table.model
            ctx.db.add(model(**values))
        return "imported"

    def _values(self, table: Table, row: dict[str, Any], id_map: IdMap) -> dict[str, Any]:
        """The row's column values, with the ids inside its other values remapped."""
        values: dict[str, Any] = {}
        for key, column in {c.key: c for c in self._columns(table)}.items():
            if key not in row:
                continue
            value = row[key]
            if key not in table.refs and key != table.id_column:
                value = (
                    remap_value(value, id_map)
                    if (_is_json(column) or isinstance(value, str))
                    else value
                )
            values[key] = _load(column, value)
        return values

    async def purge(self, ctx: Ctx) -> None:
        for table in reversed(self.tables):
            model: Any = table.model
            await ctx.db.execute(delete(model).where(model.user_id == ctx.user_id))

    async def purge_content(self, ctx: Ctx, preferences: bool) -> None:
        for table in reversed(self.tables):
            if not table.exported:
                continue
            model: Any = table.model
            stmt = delete(model).where(model.user_id == ctx.user_id)
            if not preferences:
                if table.preferences is True:
                    continue
                if table.preferences is not False:
                    stmt = stmt.where(not_(_preference_clause(table)))
            await ctx.db.execute(stmt)


def _remap_refs(
    table: Table, row: dict[str, Any], id_map: IdMap
) -> Literal["ok", "skipped", "excluded"]:
    """Points the row's references at the new ids. A required reference that is missing or
    unknown skips the row; one to an excluded row excludes it too."""
    for col, kind in table.refs.items():
        target = row.get(col)
        if target is None or (kind == "scope" and target == ""):
            if kind == "required":
                return "skipped"
            continue
        if target in id_map:
            row[col] = id_map[target]
        elif kind == "optional":
            row[col] = None
        elif target in id_map.excluded:
            return "excluded"
        else:
            return "skipped"
    return "ok"


async def _upsert(
    ctx: Ctx, table: Table, values: dict[str, Any], old_id: Any, id_map: IdMap
) -> bool:
    """Updates the row that `upsert_on` matches, if there is one; returns whether it did."""
    if table.upsert_on is None:
        return False
    model: Any = table.model
    existing = await ctx.db.scalar(
        select(model).where(
            model.user_id == ctx.user_id,
            *(getattr(model, k) == values.get(k) for k in table.upsert_on),
        )
    )
    if existing is None:
        return False
    for key, value in values.items():
        if key != table.id_column:
            setattr(existing, key, value)
    if table.id_column and isinstance(old_id, str):
        id_map[old_id] = getattr(existing, table.id_column)
    return True


def table_adapter(
    *,
    module: str,
    schema_version: int,
    depends_on: tuple[str, ...] = (),
    tables: Sequence[Table],
) -> TableAdapter:
    """Registers the adapter and returns it (tests call its methods directly)."""
    adapter = TableAdapter(module, schema_version, tables)
    register_portability(
        module=module,
        schema_version=schema_version,
        depends_on=depends_on,
        export=adapter.export,
        import_=adapter.import_,
        preview=adapter.preview,
        purge=adapter.purge,
        purge_content=adapter.purge_content,
        tables=tuple(t.model.__tablename__ for t in tables),
        limits={t.model.__tablename__: t.limit for t in tables if t.limit is not None},
    )
    return adapter
