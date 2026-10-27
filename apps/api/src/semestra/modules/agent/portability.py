"""M13 adapter: assistant conversations stay on this account.

Messages, tool calls and proposals embed ids of other modules' rows in free-form JSON that an
import cannot remap, so conversations are neither exported nor replaced; they are only purged with
the account (attachments live under `users/<id>/agent/`, removed with the account's storage).
The approval preferences are consent given on this account, so they do not travel either.
Memories travel (they are the user's own words); the conversation they came from does not. A
memory overwrites the one with the same name; the import keeps to the 60-memory limit and the
rules a conversation keeps to. Archives from before memories had names (schema version 1:
`category` and `content`) are converted on import.
"""

from typing import Any

from sqlalchemy import func, select

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules.agent import memory
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


async def _memory(ctx: Ctx, row: dict[str, Any], opts: ImportOptions) -> dict[str, Any] | None:
    """A version 1 row gets a name, a type and a line that fits (the whole old text becomes the
    body when it was longer). A row a conversation could not have saved (a bad name, sensitive
    text) or one past the limit is left out; a row with an existing name replaces that memory."""
    del opts
    if "name" not in row and isinstance(row.get("content"), str):
        old_id = str(row.get("id") or "")
        description, body = memory.split_line(row["content"])
        row = {
            **row,
            "name": "memory-" + old_id.replace("-", "")[-8:],
            "type": _TYPES.get(str(row.get("category")), "user"),
            "description": description,
            "body": body,
        }
    name, description, body = row.get("name"), row.get("description"), row.get("body") or ""
    if not (isinstance(name, str) and isinstance(description, str) and isinstance(body, str)):
        return None
    if row.get("type") not in ("user", "feedback", "project", "reference"):
        return None
    try:
        memory.check(name, description, body)
    except AppError:
        return None
    if len(description) > memory.MAX_DESCRIPTION or len(body) > memory.MAX_BODY:
        return None
    if await memory.by_name(ctx, name) is None:
        count = await ctx.db.scalar(
            select(func.count()).select_from(AgentMemory).where(AgentMemory.user_id == ctx.user_id)
        )
        if (count or 0) >= memory.MAX_MEMORIES:
            return None
    return row


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
            transform=_memory,
            limit=memory.MAX_MEMORIES,
        ),
    ),
)
