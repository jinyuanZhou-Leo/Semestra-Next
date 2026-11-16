from datetime import datetime

from sqlalchemy import ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from semestra.core.db import Base, OwnedMixin, UTCDateTime, new_id


class CaldavConnection(Base, OwnedMixin):
    """A device that syncs a Program's to-do lists over CalDAV (Apple Reminders, ...). It signs in
    with its own password: looked up by hash, also kept encrypted so it can be shown again (like a
    calendar subscription link, it reaches nothing but the to-dos and is revoked by deleting)."""

    __tablename__ = "caldav_connections"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    program_id: Mapped[str] = mapped_column(
        String, ForeignKey("academics_programs.id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(String, unique=True)
    token_encrypted: Mapped[str] = mapped_column(String)
    # What the device said it is on its first request ("ios" | "macos" | "other").
    client: Mapped[str | None] = mapped_column(String, default=None)
    last_seen_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime)


class CaldavItem(Base, OwnedMixin):
    """How a task looks to CalDAV clients when a client made it or changed it: the name it was
    stored under, its UID, and the client's last iCalendar text, whose properties Semestra does
    not use (repeat rules, other alerts, X-APPLE-*) are sent back unchanged. Tasks without a row
    are `<task id>.ics` with that id as UID."""

    __tablename__ = "caldav_items"
    __table_args__ = (
        Index("uq_caldav_items_uid", "user_id", "uid", unique=True),
        Index("uq_caldav_items_name", "user_id", "name", unique=True),
    )

    task_id: Mapped[str] = mapped_column(
        String, ForeignKey("tasks_items.id", ondelete="CASCADE"), primary_key=True
    )
    uid: Mapped[str] = mapped_column(String)
    name: Mapped[str] = mapped_column(String)
    ical: Mapped[str] = mapped_column(Text)
