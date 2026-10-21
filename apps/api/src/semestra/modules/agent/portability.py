"""M13 adapter: assistant conversations stay on this account.

Messages, tool calls and proposals embed ids of other modules' rows in free-form JSON that an
import cannot remap, so conversations are neither exported nor replaced; they are only purged with
the account (attachments live under `users/<id>/agent/`, removed with the account's storage).
The approval preferences are consent given on this account, so they do not travel either.
Memories travel (they are the user's own words); the conversation they came from does not. A
memory overwrites the one with the same name. Archives from before memories had names
(schema version 1: `category` and `content`) are converted on import.
"""

from typing import Any

from semestra.core.context import Ctx
from semestra.modules.agent.models import (
    AgentAttachment,
    AgentAttachmentPage,
    AgentMemory,
    AgentMessage,
    AgentPreferences,
    AgentProposal,
    AgentSession,
)
from semestra.modules.portability import ImportOptions, Table, table_adapter

# Version 1 categories → types (as in migration 0019).
_TYPES = {"preference": "user", "context": "user", "goal": "project", "constraint": "project"}


async def _memory_v1(ctx: Ctx, row: dict[str, Any], opts: ImportOptions) -> dict[str, Any]:
    del ctx, opts
    if "name" in row or not isinstance(row.get("content"), str):
        return row
    old_id = str(row.get("id") or "")
    return {
        **row,
        "name": "memory-" + old_id.replace("-", "")[-8:],
        "type": _TYPES.get(str(row.get("category")), "user"),
        "description": row["content"],
        "body": "",
    }


ADAPTER = table_adapter(
    module="agent",
    schema_version=2,
    tables=(
        Table(AgentSession, "sessions", exported=False),
        Table(AgentMessage, "messages", exported=False),
        Table(AgentProposal, "proposals", exported=False),
        Table(AgentAttachment, "attachments", exported=False),
        Table(AgentAttachmentPage, "attachment_pages", id_column=None, exported=False),
        Table(AgentPreferences, "preferences", id_column=None, exported=False),
        Table(
            AgentMemory,
            "memories",
            exclude=("source_session_id",),
            upsert_on=("name",),
            transform=_memory_v1,
        ),
    ),
)
