from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from semestra.core.db import Base, OwnedMixin, TimestampMixin, new_id


class LmsConnection(Base, OwnedMixin, TimestampMixin):
    """An account on an LMS instance (M09 §3). Credentials are stored encrypted only."""

    __tablename__ = "lms_connections"
    __table_args__ = (Index("ix_lms_connections_user_provider", "user_id", "provider"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    provider: Mapped[str] = mapped_column(String)
    display_name: Mapped[str] = mapped_column(String)
    # The provider's normalized, non-secret configuration (Canvas: {base_url}).
    config_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    # `v<key version>:<core.security.encrypt(...)>`; null after an import without credentials.
    credentials_encrypted: Mapped[str | None] = mapped_column(String, default=None)
    credentials_hint_json: Mapped[dict[str, str]] = mapped_column(JSON, default=dict)
    account_name: Mapped[str | None] = mapped_column(String, default=None)
    status: Mapped[str] = mapped_column(String, default="connected")  # 'connected' | 'error'
    last_checked_at: Mapped[datetime | None] = mapped_column(default=None)
    last_error_code: Mapped[str | None] = mapped_column(String, default=None)


class LmsProgramBinding(Base, OwnedMixin, TimestampMixin):
    """The connection a Program uses; owned here so M02's programs table stays untouched."""

    __tablename__ = "lms_program_bindings"

    program_id: Mapped[str] = mapped_column(
        String, ForeignKey("academics_programs.id", ondelete="CASCADE"), primary_key=True
    )
    connection_id: Mapped[str] = mapped_column(
        String, ForeignKey("lms_connections.id", ondelete="RESTRICT"), index=True
    )


class LmsCourseLink(Base, OwnedMixin, TimestampMixin):
    """A course linked to one external course of its Program's connection."""

    __tablename__ = "lms_course_links"
    __table_args__ = (
        UniqueConstraint(
            "program_id",
            "connection_id",
            "external_course_id",
            name="uq_lms_course_links_external",
        ),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    course_id: Mapped[str] = mapped_column(
        String, ForeignKey("academics_courses.id", ondelete="CASCADE"), unique=True
    )
    program_id: Mapped[str] = mapped_column(
        String, ForeignKey("academics_programs.id", ondelete="CASCADE"), index=True
    )
    connection_id: Mapped[str] = mapped_column(
        String, ForeignKey("lms_connections.id", ondelete="RESTRICT"), index=True
    )
    external_course_id: Mapped[str] = mapped_column(String)
    external_code: Mapped[str | None] = mapped_column(String, default=None)
    external_name: Mapped[str | None] = mapped_column(String, default=None)
    external_term: Mapped[str | None] = mapped_column(String, default=None)
    web_url: Mapped[str | None] = mapped_column(String, default=None)
    sync_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(default=None)
    last_error_code: Mapped[str | None] = mapped_column(String, default=None)


class LmsImportedRef(Base, OwnedMixin):
    """An assignment or event that was imported, to skip it next time and detect updates."""

    __tablename__ = "lms_imported_refs"
    __table_args__ = (
        UniqueConstraint(
            "link_id",
            "external_kind",
            "external_id",
            "target_kind",
            name="uq_lms_imported_refs_target",
        ),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    link_id: Mapped[str] = mapped_column(
        String, ForeignKey("lms_course_links.id", ondelete="CASCADE"), index=True
    )
    external_kind: Mapped[str] = mapped_column(String)  # 'assignment' | 'calendar_event'
    external_id: Mapped[str] = mapped_column(String)
    target_kind: Mapped[str] = mapped_column(String)  # 'assessment' | 'task' | 'event'
    target_id: Mapped[str] = mapped_column(String, index=True)
    # What the item looked like when imported: {title, due_at, points} (update detection).
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    external_updated_at: Mapped[datetime | None] = mapped_column(default=None)
    imported_at: Mapped[datetime] = mapped_column()


class LmsCache(Base, OwnedMixin):
    """Second-level read cache (the first is in process); never exported."""

    __tablename__ = "lms_cache"

    key: Mapped[str] = mapped_column(String, primary_key=True)
    connection_id: Mapped[str] = mapped_column(
        String, ForeignKey("lms_connections.id", ondelete="CASCADE"), index=True
    )
    payload: Mapped[Any] = mapped_column(JSON)
    expires_at: Mapped[datetime] = mapped_column()
