"""Module export/import adapters (M13 §3).

Every module that stores user data registers one adapter with `register_portability`, usually
from `modules/<module>/portability.py` imported by its package. Most modules describe their
tables with `tables.table_adapter(...)`; a module with special rules writes the callbacks itself
(see `plugins_builtin/portability.py`).

* `export(ctx, writer)` calls `writer.write_json(obj)` once (it becomes `data/<module>.json`) and
  `await writer.add_file(key, stream)` for each stored file it wants in the archive.
* `import_(ctx, payload, id_map, options)` writes the module's rows and returns a report with
  `imported` and `skipped` counts per entity. `id_map` maps every archive id to the id it got
  here; ids of rows that were left out on purpose are in `id_map.excluded`.
* `preview(payload)` counts what the payload holds per entity.
* `purge(ctx)` deletes all of the user's rows in the module (account deletion).
* `purge_content(ctx, preferences)` deletes what a "replace" import replaces: the data that goes
  into backups, preferences only when they are imported too. Defaults to `purge`.

`tables` names the database tables the adapter is responsible for; a test checks that every
table with a `user_id` column belongs to one adapter and is empty for the user after `purge`.
"""

from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

from semestra.core.context import Ctx


class Writer(Protocol):
    def write_json(self, obj: Any) -> None: ...

    async def add_file(self, key: str, stream: Any) -> None: ...


class FileSource(Protocol):
    """The archive's `files/` during an import.

    Copying files must not happen while the import holds SQLite's write lock (every user's
    saves would wait), so it happens first: an adapter's `prepare` calls `store` for each file,
    under a key it chooses (pre-assigning the new row id in the `IdMap` if the key needs it).
    Its `import_` then calls `claim` for each file it keeps; claimed files count against the
    user's quota, and files nobody claimed (their rows were skipped) are deleted afterwards, as
    is everything stored when the import fails."""

    def has(self, key: str) -> bool: ...

    async def store(self, key: str, final_key: str, content_type: str) -> int: ...

    def claim(self, final_key: str) -> int | None: ...


@dataclass
class ImportOptions:
    mode: Literal["merge", "replace"]
    # Archive ids of the Programs to import; None imports all of them.
    program_ids: frozenset[str] | None
    include_preferences: bool
    files: FileSource | None = None


class IdMap(dict[str, str]):
    """Archive id → new id, shared by all modules of one import. `excluded` holds archive ids
    of rows left out on purpose (a Program that was not selected, preferences not imported), so
    their dependants are left out silently instead of being reported as skipped."""

    def __init__(self) -> None:
        super().__init__()
        self.excluded: set[str] = set()


class Report(Protocol):
    imported: dict[str, int]
    skipped: dict[str, int]


@dataclass
class ImportReport:
    imported: dict[str, int] = field(default_factory=lambda: {})
    skipped: dict[str, int] = field(default_factory=lambda: {})


ExportFn = Callable[[Ctx, Writer], Awaitable[None]]
# Runs before any row is written, outside the import's write transaction (see `FileSource`).
PrepareFn = Callable[[Ctx, dict[str, Any], IdMap, ImportOptions], Awaitable[None]]
ImportFn = Callable[[Ctx, dict[str, Any], Mapping[str, str], Any], Awaitable[Report]]
PreviewFn = Callable[[dict[str, Any]], Awaitable[dict[str, int]]]
PurgeFn = Callable[[Ctx], Awaitable[None]]
PurgeContentFn = Callable[[Ctx, bool], Awaitable[None]]


@dataclass(frozen=True)
class Adapter:
    module: str
    schema_version: int
    depends_on: tuple[str, ...]
    export: ExportFn
    import_: ImportFn
    preview: PreviewFn
    purge: PurgeFn
    purge_content: PurgeContentFn
    tables: tuple[str, ...]
    prepare: PrepareFn | None = None
    # Row caps by table name (e.g. Sem memories), for the data overview.
    limits: Mapping[str, int] = field(default_factory=lambda: {})


_adapters: dict[str, Adapter] = {}


def register_portability(
    *,
    module: str,
    schema_version: int,
    depends_on: tuple[str, ...] = (),
    export: ExportFn,
    import_: ImportFn,
    preview: PreviewFn,
    purge: PurgeFn,
    purge_content: PurgeContentFn | None = None,
    tables: tuple[str, ...] = (),
    prepare: PrepareFn | None = None,
    limits: Mapping[str, int] | None = None,
) -> None:
    if module in _adapters:
        raise ValueError(f"duplicate portability adapter {module!r}")

    async def purge_all(ctx: Ctx, preferences: bool) -> None:
        del preferences
        await purge(ctx)

    _adapters[module] = Adapter(
        module=module,
        schema_version=schema_version,
        depends_on=tuple(depends_on),
        export=export,
        import_=import_,
        preview=preview,
        purge=purge,
        purge_content=purge_content or purge_all,
        tables=tuple(tables),
        prepare=prepare,
        limits=dict(limits or {}),
    )


def adapters() -> list[Adapter]:
    """All adapters, dependencies first (the import order; purge runs it backwards).
    Dependencies on modules without an adapter are ignored."""
    ordered: list[Adapter] = []
    state: dict[str, Literal["visiting", "done"]] = {}

    def visit(name: str) -> None:
        if state.get(name) == "done" or name not in _adapters:
            return
        if state.get(name) == "visiting":
            raise ValueError(f"portability adapters depend on each other in a cycle ({name})")
        state[name] = "visiting"
        for dep in _adapters[name].depends_on:
            visit(dep)
        state[name] = "done"
        ordered.append(_adapters[name])

    for name in sorted(_adapters):
        visit(name)
    return ordered


def get_adapter(module: str) -> Adapter | None:
    return _adapters.get(module)
