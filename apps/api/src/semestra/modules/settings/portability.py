"""M13 export/import adapter: preferences, UI state and module settings.

Preferences, UI state and account-level settings are imported only when the user asks for
preferences; settings of a Program, term or course go with that scope.

Version 2 only drops settings that no longer exist: `_v1_to_v2` removes the tasks setting
`auto_tasks_from_assessments` (assessment tasks always exist since 2.0, migration 0033).
"""

from typing import Any

from semestra.modules.portability import Table, table_adapter
from semestra.modules.portability.registry import OlderArchive
from semestra.modules.settings.models import SettingsPreferences, SettingsUiState, SettingsValue

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


ADAPTER = table_adapter(
    module="settings",
    schema_version=2,
    upgrades={1: _v1_to_v2},
    depends_on=("academics",),
    tables=(
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
