"""M13 export/import adapter: preferences, UI state and module settings.

Preferences, UI state and account-level settings are imported only when the user asks for
preferences; settings of a Program, term or course go with that scope.

Version 2 only drops settings that no longer exist: `_v1_to_v2` removes the tasks setting
`auto_tasks_from_assessments` (assessment tasks always exist since 2.0, migration 0033). A
namespace whose rows a later migration moved (other levels, another namespace) is read by that
migration's reshape step, registered by the module that owns the namespace with `move_rows`:
M09's materials settings were per Program, and its `display` was the Canvas tab's.
"""

from collections.abc import Callable
from typing import Any

from semestra.modules.portability import Table
from semestra.modules.portability.registry import OlderArchive, register_portability
from semestra.modules.portability.tables import TableAdapter
from semestra.modules.settings.models import SettingsPreferences, SettingsUiState, SettingsValue

SCHEMA_VERSION = 2

# Settings removed since version 1, by namespace.
_REMOVED = {"tasks": ("auto_tasks_from_assessments",)}


def _v1_to_v2(payload: dict[str, Any], archive: OlderArchive) -> dict[str, Any]:
    del archive
    values: list[Any] = []
    for row in payload.get("values") or []:
        if isinstance(row, dict) and isinstance(data := row.get("data"), dict):  # pyright: ignore[reportUnknownMemberType]
            removed = _REMOVED.get(str(row.get("namespace")), ())  # pyright: ignore[reportUnknownMemberType]
            row = {**row, "data": {k: v for k, v in data.items() if k not in removed}}  # pyright: ignore[reportUnknownVariableType]
        values.append(row)
    return {**payload, "values": values}


def move_rows(
    payload: dict[str, Any],
    namespace: str,
    read: Callable[[list[dict[str, Any]]], list[dict[str, Any]]],
) -> dict[str, Any]:
    """For a reshape step of a migration that moved a namespace's settings (other levels,
    another namespace): its rows (each `{namespace, scope_type, scope_id, data, ...}`) as `read`
    gives them now. Rows that end up on the same scope of a namespace become one, the values
    the backup had there winning."""
    rows = [r for r in payload.get("values") or [] if isinstance(r, dict)]
    own = [r for r in rows if r.get("namespace") == namespace]
    if not own:
        return payload
    rows = [*(r for r in rows if r.get("namespace") != namespace), *read(own)]
    merged: dict[tuple[Any, ...], dict[str, Any]] = {}
    for r in rows:
        scope = (r.get("namespace"), r.get("scope_type"), r.get("scope_id"))
        if (first := merged.get(scope)) is None:
            merged[scope] = r
        else:
            data = {**(r.get("data") or {}), **(first.get("data") or {})}
            merged[scope] = {**first, "data": data}
    return {**payload, "values": list(merged.values())}


ADAPTER = TableAdapter(
    "settings",
    SCHEMA_VERSION,
    (
        Table(
            SettingsPreferences,
            "preferences",
            id_column=None,
            refs={"active_program_id": "optional"},
            preferences=True,
            upsert_on=(),
        ),
        Table(SettingsUiState, "ui_state", id_column=None, preferences=True, upsert_on=("key",)),
        Table(
            SettingsValue,
            "values",
            refs={"scope_id": "scope"},
            preferences=("scope_type", "account"),
            upsert_on=("namespace", "scope_type", "scope_id"),
        ),
    ),
)

register_portability(
    module="settings",
    schema_version=SCHEMA_VERSION,
    depends_on=("academics",),
    export=ADAPTER.export,
    import_=ADAPTER.import_,
    preview=ADAPTER.preview,
    purge=ADAPTER.purge,
    purge_content=ADAPTER.purge_content,
    tables=tuple(t.model.__tablename__ for t in ADAPTER.tables),
    limits={t.model.__tablename__: t.limit for t in ADAPTER.tables if t.limit is not None},
    upgrades={1: _v1_to_v2},
)
