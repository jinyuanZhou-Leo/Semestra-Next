"""Names of chat attachments (`core.labels`)."""

from semestra.core.labels import owned_names, resolver
from semestra.modules.agent.models import AgentAttachment

attachment = owned_names(AgentAttachment, lambda row: row.name)
resolver("id", module="agent.attachment")(attachment)
resolver("attachment")(attachment)
