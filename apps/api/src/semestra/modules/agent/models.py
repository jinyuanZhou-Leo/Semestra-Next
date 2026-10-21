from datetime import datetime
from typing import Any

from sqlalchemy import JSON, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from semestra.core.db import Base, OwnedMixin, new_id


class AgentSession(Base, OwnedMixin):
    """One assistant conversation (M12 §2). `state` holds what the loop keeps between requests:
    the summary of compacted turns and the tool-call counts of the current user message."""

    __tablename__ = "agent_sessions"
    __table_args__ = (
        Index("ix_agent_sessions_user_updated", "user_id", "updated_at"),
        Index("ux_agent_sessions_user_client_key", "user_id", "client_key", unique=True),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    program_id: Mapped[str | None] = mapped_column(String, default=None)
    title: Mapped[str | None] = mapped_column(String, default=None)
    # The page scope the session was started from: {program_id, term_id?, course_id?}.
    scope: Mapped[dict[str, Any] | None] = mapped_column(JSON, default=None)
    pinned: Mapped[bool] = mapped_column(default=False)
    # A temporary chat neither reads nor writes memories (M12 记忆).
    temporary: Mapped[bool] = mapped_column(default=False)
    # When the idle conversation was last read for memories (`memory.consolidate_idle`).
    memory_processed_at: Mapped[datetime | None] = mapped_column(default=None)
    # {summary: str | None, summarized_until: message id | None,
    #  turn: {tool_calls, requests, last_call, repeats} (see `loop.Counters`),
    #  memory: the memories as the conversation started (`memory.snapshot`)}
    state: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column()
    updated_at: Mapped[datetime] = mapped_column()
    archived_at: Mapped[datetime | None] = mapped_column(default=None)
    # The client's key for the new conversation: creating it twice returns this one (M12 §4).
    client_key: Mapped[str | None] = mapped_column(String, default=None)


class AgentMessage(Base, OwnedMixin):
    """One message of the transcript. `content` is what the UI shows, a list of blocks: text,
    reasoning, image_ref, file_ref, skill, tool_call, tool_result, citation, note, timing, paused.
    `model_parts` is what the model sees: the Pydantic AI message of an assistant or tool row
    (`history.dump`); user rows are rendered from their blocks (`history.user_request`)."""

    __tablename__ = "agent_messages"
    __table_args__ = (Index("ix_agent_messages_session_created", "session_id", "created_at"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    session_id: Mapped[str] = mapped_column(
        String, ForeignKey("agent_sessions.id", ondelete="CASCADE")
    )
    role: Mapped[str] = mapped_column(String)  # 'user' | 'assistant' | 'tool'
    content: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    model_parts: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON, default=None)
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
    # Read on upload with M07's parser (`attachments.py`): the detected kind (pdf, docx, ics,
    # image, ...), the number of pages stored in `agent_attachment_pages`, or why it failed.
    doc_kind: Mapped[str | None] = mapped_column(String, default=None)
    page_count: Mapped[int | None] = mapped_column(Integer, default=None)
    parse_error: Mapped[str | None] = mapped_column(String, default=None)


class AgentAttachmentPage(Base, OwnedMixin):
    """One page of an attachment as markdown (M12 实现说明). Not chunked or indexed: saving the
    attachment to the course's files does that."""

    __tablename__ = "agent_attachment_pages"

    attachment_id: Mapped[str] = mapped_column(
        String, ForeignKey("agent_attachments.id", ondelete="CASCADE"), primary_key=True
    )
    page_no: Mapped[int] = mapped_column(Integer, primary_key=True)
    markdown: Mapped[str] = mapped_column(String, default="")
    # A scanned page without a text layer: its markdown is empty.
    needs_ocr: Mapped[bool] = mapped_column(default=False)


class AgentPreferences(Base):
    __tablename__ = "agent_preferences"

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("auth_users.id", ondelete="CASCADE"), primary_key=True
    )
    auto_approve: Mapped[list[str]] = mapped_column(JSON, default=list)
    mcp_allow_destructive: Mapped[bool] = mapped_column(default=False)
    updated_at: Mapped[datetime] = mapped_column()


class AgentMemory(Base, OwnedMixin):
    """One thing Sem remembers about the user across conversations (M12 记忆): who they are, how
    they want Sem to work, what they are working towards, or where to find something outside the
    app. The structured data (courses, grades, the timetable) is never copied here."""

    __tablename__ = "agent_memories"
    __table_args__ = (
        Index("ix_agent_memories_user_updated", "user_id", "updated_at"),
        Index("ux_agent_memories_user_name", "user_id", "name", unique=True),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    # A kebab-case handle the model picks: how it updates, reads and links (`[[name]]`) a memory.
    name: Mapped[str] = mapped_column(String)
    type: Mapped[str] = mapped_column(String)  # user | feedback | project | reference
    # One line: what the index in the prompt shows.
    description: Mapped[str] = mapped_column(String)
    # The detail, read on demand with `agent.memory.get`; empty when the line says it all.
    body: Mapped[str] = mapped_column(String, default="")
    # The conversation it came from; kept when that conversation is deleted.
    source_session_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("agent_sessions.id", ondelete="SET NULL"), default=None
    )
    created_at: Mapped[datetime] = mapped_column()
    updated_at: Mapped[datetime] = mapped_column()
