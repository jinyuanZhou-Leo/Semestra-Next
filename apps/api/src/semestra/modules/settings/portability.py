"""M13 export/import adapter: preferences, UI state and module settings.

Preferences, UI state and account-level settings are imported only when the user asks for
preferences; settings of a Program, term or course go with that scope.
"""

from semestra.modules.portability import Table, table_adapter
from semestra.modules.settings.models import SettingsPreferences, SettingsUiState, SettingsValue

ADAPTER = table_adapter(
    module="settings",
    schema_version=1,
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
