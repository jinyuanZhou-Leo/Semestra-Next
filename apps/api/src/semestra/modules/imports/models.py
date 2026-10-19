from datetime import datetime
from typing import Any

from sqlalchemy import JSON, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from semestra.core.db import Base, OwnedMixin, TimestampMixin, UTCDateTime, new_id


class ImportsSession(Base, OwnedMixin, TimestampMixin):
    """One import (M08 §3): drafts extracted from a source, reviewed, then committed."""

    __tablename__ = "imports_sessions"
    __table_args__ = (Index("ix_imports_sessions_program_created", "program_id", "created_at"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    program_id: Mapped[str] = mapped_column(
        String, ForeignKey("academics_programs.id", ondelete="CASCADE")
    )
    # ics | syllabus | timetable_image | lms | text | agent
    source_kind: Mapped[str] = mapped_column(String)
    # {kind: term_wizard | term | course, term_id?, course_id?, start_date?, end_date?}
    target: Mapped[dict[str, Any]] = mapped_column(JSON)
    # extracting | ready | committing | committed | failed | discarded
    status: Mapped[str] = mapped_column(String)
    job_id: Mapped[str | None] = mapped_column(String, default=None)
    # [{upload_id?, file_item_id?, filename?, lms_course_id?, status, error_code?}]
    source_refs: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    source_meta: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    # Pasted text (source `text`); cleared on commit or discard.
    text: Mapped[str | None] = mapped_column(String, default=None)
    summary: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    error_code: Mapped[str | None] = mapped_column(String, default=None)
    committed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)


class ImportsItem(Base, OwnedMixin):
    """One object to write (course, meeting, assessment, ...) with its evidence and decision."""

    __tablename__ = "imports_items"
    __table_args__ = (Index("ix_imports_items_session_position", "session_id", "position"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    session_id: Mapped[str] = mapped_column(
        String, ForeignKey("imports_sessions.id", ondelete="CASCADE")
    )
    type: Mapped[str] = mapped_column(String)
    data: Mapped[dict[str, Any]] = mapped_column(JSON)
    # {field: {upload_id?, file_item_id?, page?, quote?}}
    evidence: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    # {field: high | medium | low}
    confidence: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    decision: Mapped[str] = mapped_column(String, default="accept")  # accept | reject | pending
    issues: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    depends_on: Mapped[list[str]] = mapped_column(JSON, default=list)
    # {created_id} | {updated_id} | {error_code, error_params}
    result: Mapped[dict[str, Any] | None] = mapped_column(JSON, default=None)
    position: Mapped[int] = mapped_column(Integer, default=0)


class ImportsUpload(Base, OwnedMixin):
    """A file uploaded for an import before it belongs to a course (wizard, screenshots).
    Moved into the course's files (M07) on commit; removed with its session."""

    __tablename__ = "imports_uploads"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    session_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("imports_sessions.id", ondelete="SET NULL"), default=None, index=True
    )
    storage_key: Mapped[str] = mapped_column(String)
    filename: Mapped[str] = mapped_column(String)
    mime_type: Mapped[str] = mapped_column(String)
    size_bytes: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime)
