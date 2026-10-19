"""M13 export/import adapter: AI providers and model assignments, without their keys.

A provider that had a key comes back disabled until the user enters one again. Usage records
are not exported; they are deleted with the account.
"""

from typing import Any

from semestra.core.context import Ctx
from semestra.modules.ai.models import AiModelAssignment, AiProvider, AiUsageEvent
from semestra.modules.portability import ImportOptions, Table, table_adapter

SECRET_COLUMNS = ("api_key_encrypted", "key_hint", "last_checked_at", "last_error_code")


def _mark_key(obj: Any, row: dict[str, Any]) -> dict[str, Any]:
    return {**row, "had_key": obj.api_key_encrypted is not None}


async def _provider(ctx: Ctx, row: dict[str, Any], options: ImportOptions) -> dict[str, Any]:
    del ctx, options
    if row.pop("had_key", False):
        row["enabled"] = False
    return row


ADAPTER = table_adapter(
    module="ai",
    schema_version=1,
    tables=(
        Table(
            AiProvider,
            "providers",
            exclude=SECRET_COLUMNS,
            preferences=True,
            on_export=_mark_key,
            transform=_provider,
        ),
        Table(
            AiModelAssignment,
            "model_assignments",
            id_column=None,
            refs={"provider_id": "required"},
            preferences=True,
            upsert_on=("purpose",),
        ),
        Table(AiUsageEvent, "usage_events", exported=False),
    ),
)
