from datetime import datetime
from typing import Any

from sqlalchemy import JSON, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from semestra.core.db import Base, OwnedMixin, new_id


class AgentSession(Base, OwnedMixin):
    """One assistant conversation (M12 §2). `state` replaces LangGraph's checkpoint: the tools
    loaded with `tools_load` (LRU order) and the summary of compacted turns."""

    __tablename__ = "agent_sessions"
    __table_args__ = (Index("ix_agent_sessions_user_updated", "user_id", "updated_at"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    program_id: Mapped[str | None] = mapped_column(String, default=None)
    title: Mapped[str | None] = mapped_column(String, default=None)
    # The page scope the session was started from: {program_id, term_id?, course_id?}.
    scope: Mapped[dict[str, Any] | None] = mapped_column(JSON, default=None)
    pinned: Mapped[bool] = mapped_column(default=False)
    # {loaded_tools: [name, ...], summary: str | None, summarized_until: message id | None}
    state: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column()
    updated_at: Mapped[datetime] = mapped_column()
    archived_at: Mapped[datetime | None] = mapped_column(default=None)


class AgentMessage(Base, OwnedMixin):
    """One message of the transcript. `content` is a list of blocks: text, image_ref, file_ref,
    tool_call, tool_result, proposal_ref, citation, note (see `schemas.Block`)."""

    __tablename__ = "agent_messages"
    __table_args__ = (Index("ix_agent_messages_session_created", "session_id", "created_at"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    session_id: Mapped[str] = mapped_column(
        String, ForeignKey("agent_sessions.id", ondelete="CASCADE")
    )
    role: Mapped[str] = mapped_column(String)  # 'user' | 'assistant' | 'tool'
    content: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    model: Mapped[str | None] = mapped_column(String, default=None)
    input_tokens: Mapped[int | None] = mapped_column(Integer, default=None)
    output_tokens: Mapped[int | None] = mapped_column(Integer, default=None)
    created_at: Mapped[datetime] = mapped_column()


class AgentProposal(Base, OwnedMixin):
    """A write tool call waiting for the user's decision (M12 §3.5)."""

    __tablename__ = "agent_proposals"
    __table_args__ = (Index("ix_agent_proposals_session", "session_id"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    session_id: Mapped[str] = mapped_column(
        String, ForeignKey("agent_sessions.id", ondelete="CASCADE")
    )
    message_id: Mapped[str] = mapped_column(
        String, ForeignKey("agent_messages.id", ondelete="CASCADE")
    )
    call_id: Mapped[str] = mapped_column(String)
    capability: Mapped[str] = mapped_column(String)
    args: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    preview: Mapped[dict[str, Any] | None] = mapped_column(JSON, default=None)
    # 'pending' | 'approved' | 'rejected' | 'executed' | 'failed' | 'expired'
    status: Mapped[str] = mapped_column(String, default="pending")
    result: Mapped[Any] = mapped_column(JSON, default=None, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String, default=None)
    decided_at: Mapped[datetime | None] = mapped_column(default=None)
    executed_at: Mapped[datetime | None] = mapped_column(default=None)
    created_at: Mapped[datetime] = mapped_column()


class AgentAttachment(Base, OwnedMixin):
    """A file or image dropped into the composer; counted in the storage quota."""

    __tablename__ = "agent_attachments"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    session_id: Mapped[str] = mapped_column(
        String, ForeignKey("agent_sessions.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String)  # 'image' | 'file'
    name: Mapped[str] = mapped_column(String)
    storage_key: Mapped[str] = mapped_column(String)
    mime: Mapped[str] = mapped_column(String)
    size: Mapped[int] = mapped_column(Integer)
    file_item_id: Mapped[str | None] = mapped_column(String, default=None)
    created_at: Mapped[datetime] = mapped_column()


class AgentPreferences(Base):
    __tablename__ = "agent_preferences"

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("auth_users.id", ondelete="CASCADE"), primary_key=True
    )
    auto_approve: Mapped[list[str]] = mapped_column(JSON, default=list)
    mcp_allow_destructive: Mapped[bool] = mapped_column(default=False)
    updated_at: Mapped[datetime] = mapped_column()
