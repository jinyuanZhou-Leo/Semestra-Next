from datetime import datetime
from typing import Any

from sqlalchemy import JSON, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from semestra.core.db import Base, OwnedMixin, new_id


class NotificationsDevice(Base, OwnedMixin):
    """A browser's Web Push subscription (M18 §3). It belongs to the sign-in session it was made
    in: signing out or revoking the session stops the pushes, and the row goes with the session."""

    __tablename__ = "notifications_devices"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    session_id: Mapped[str] = mapped_column(
        String, ForeignKey("auth_sessions.id", ondelete="CASCADE"), index=True
    )
    # The push service URL the browser gave; one row per browser profile.
    endpoint: Mapped[str] = mapped_column(String, unique=True)
    p256dh: Mapped[str] = mapped_column(String)
    auth: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime]
    last_seen_at: Mapped[datetime]


class NotificationsReminder(Base, OwnedMixin):
    """A reminder planned for the next hours (M18 §4): sent by the minute tick at `fire_at`.
    Sent rows stay until their occurrence is past, so planning again does not repeat them."""

    __tablename__ = "notifications_reminders"
    __table_args__ = (
        UniqueConstraint("user_id", "key", name="uq_notifications_reminders_key"),
        Index("ix_notifications_reminders_status_fire_at", "status", "fire_at"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    # `<occurrence id>:<lead minutes>` or `digest:<program>:<date>`.
    key: Mapped[str] = mapped_column(String)
    kind: Mapped[str] = mapped_column(String)  # class | event | task | digest
    program_id: Mapped[str] = mapped_column(
        String, ForeignKey("academics_programs.id", ondelete="CASCADE"), index=True
    )
    fire_at: Mapped[datetime]
    # When the occurrence starts (or the digest's day ends): sent rows are deleted after it.
    expires_at: Mapped[datetime]
    params: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String, default="pending")  # pending | sent | skipped
