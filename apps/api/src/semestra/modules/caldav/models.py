from datetime import datetime

from sqlalchemy import ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from semestra.core.db import Base, OwnedMixin, UTCDateTime, new_id


class CaldavConnection(Base, OwnedMixin):
    """A device that syncs a Program's to-do lists over CalDAV (Apple Reminders, ...). It signs in
    with its own password, shown once when the connection is made and stored as a hash for HTTP
    Basic and as the encrypted Digest `HA1` (`connections._set_password`) for servers on plain http,
    where Apple devices will not send a Basic password."""

    __tablename__ = "caldav_connections"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    program_id: Mapped[str] = mapped_column(
        String, ForeignKey("academics_programs.id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(String, unique=True)
    # The user name the device was given (the account's email when the password was made), and
    # MD5(username:realm:password) for HTTP Digest, encrypted (`core.security.encrypt`). Empty on
    # connections made before Digest.
    username: Mapped[str | None] = mapped_column(String, default=None, index=True)
    digest_ha1: Mapped[str | None] = mapped_column(String, default=None)
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
