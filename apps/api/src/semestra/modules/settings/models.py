from datetime import datetime
from typing import Any

from sqlalchemy import JSON, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from semestra.core.db import Base, OwnedMixin, TimestampMixin, UTCDateTime, new_id, utcnow


class SettingsPreferences(Base):
    """Personal preferences, one row per user, created on the first change (M11 §2)."""

    __tablename__ = "settings_preferences"

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("auth_users.id", ondelete="CASCADE"), primary_key=True
    )
    locale: Mapped[str | None] = mapped_column(String, default=None)  # null = follow the browser
    theme: Mapped[str] = mapped_column(String, default="system")
    accent: Mapped[str] = mapped_column(String, default="blue")
    time_format: Mapped[str] = mapped_column(String, default="auto")
    week_start: Mapped[int] = mapped_column(default=0)  # 0 = follow the locale, 1 = Mon, 7 = Sun
    reduce_motion: Mapped[str] = mapped_column(String, default="system")
    # The Program the user is looking at; owned by M02, deliberately not a foreign key.
    active_program_id: Mapped[str | None] = mapped_column(String, default=None)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)


class SettingsValue(Base, OwnedMixin, TimestampMixin):
    """Module and plugin configuration: only the keys set explicitly at one scope level."""

    __tablename__ = "settings_values"
    __table_args__ = (UniqueConstraint("user_id", "namespace", "scope_type", "scope_id"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    namespace: Mapped[str] = mapped_column(String, index=True)
    scope_type: Mapped[str] = mapped_column(String)  # 'account' | 'program' | 'term' | 'course'
    # '' for the account level: SQLite treats NULLs as distinct, which would defeat the UNIQUE.
    scope_id: Mapped[str] = mapped_column(String, default="")
    data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class SettingsUiState(Base):
    """Backing store of `useUiPref`: sort orders, collapsed panels, last views."""

    __tablename__ = "settings_ui_state"

    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("auth_users.id", ondelete="CASCADE"), primary_key=True
    )
    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    value: Mapped[Any] = mapped_column(JSON, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
