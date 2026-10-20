"""M13 adapter: assistant conversations stay on this account.

Messages, tool calls and proposals embed ids of other modules' rows in free-form JSON that an
import cannot remap, so conversations are neither exported nor replaced; they are only purged with
the account (attachments live under `users/<id>/agent/`, removed with the account's storage).
The approval preferences are consent given on this account, so they do not travel either.
Memories travel (they are the user's own words); the conversation they came from does not.
"""

from semestra.modules.agent.models import (
    AgentAttachment,
    AgentAttachmentPage,
    AgentMemory,
    AgentMessage,
    AgentPreferences,
    AgentProposal,
    AgentSession,
)
from semestra.modules.portability import Table, table_adapter

ADAPTER = table_adapter(
    module="agent",
    schema_version=1,
    tables=(
        Table(AgentSession, "sessions", exported=False),
        Table(AgentMessage, "messages", exported=False),
        Table(AgentProposal, "proposals", exported=False),
        Table(AgentAttachment, "attachments", exported=False),
        Table(AgentAttachmentPage, "attachment_pages", id_column=None, exported=False),
        Table(AgentPreferences, "preferences", id_column=None, exported=False),
        Table(AgentMemory, "memories", exclude=("source_session_id",)),
    ),
)
