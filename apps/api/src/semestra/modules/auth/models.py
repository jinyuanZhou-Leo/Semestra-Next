from datetime import datetime
from typing import Any

from sqlalchemy import JSON, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from semestra.core.db import Base, TimestampMixin, UTCDateTime, new_id, utcnow


class AuthUser(Base, TimestampMixin):
    """Global user table; every other module's `user_id` points here."""

    __tablename__ = "auth_users"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    email: Mapped[str] = mapped_column(String, unique=True)  # stored lower-case
    email_verified_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    display_name: Mapped[str] = mapped_column(String)
    avatar_url: Mapped[str | None] = mapped_column(String, default=None)
    password_hash: Mapped[str | None] = mapped_column(String, default=None)
    # Cached copy; the authoritative value is the preference owned by M11.
    locale: Mapped[str | None] = mapped_column(String, default=None)
    deleted_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)


class AuthIdentity(Base):
    """Third-party identity linked to a user."""

    __tablename__ = "auth_identities"
    __table_args__ = (UniqueConstraint("provider", "subject"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("auth_users.id", ondelete="CASCADE"), index=True
    )
    provider: Mapped[str] = mapped_column(String)  # 'google'
    subject: Mapped[str] = mapped_column(String)
    email: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class AuthSession(Base):
    """Browser sessions and native refresh tokens share this table."""

    __tablename__ = "auth_sessions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("auth_users.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String)  # 'web' | 'native'
    # Hash of the cookie value (web) or of the current refresh token (native).
    refresh_token_hash: Mapped[str] = mapped_column(String, unique=True)
    user_agent: Mapped[str | None] = mapped_column(String, default=None)
    ip: Mapped[str | None] = mapped_column(String, default=None)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    last_used_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)


class AuthUsedRefreshToken(Base):
    """Every refresh token rotated out of a session; presenting one again means it was stolen."""

    __tablename__ = "auth_used_refresh_tokens"

    token_hash: Mapped[str] = mapped_column(String, primary_key=True)
    session_id: Mapped[str] = mapped_column(
        String, ForeignKey("auth_sessions.id", ondelete="CASCADE"), index=True
    )
    used_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class AuthEmailChallenge(Base):
    __tablename__ = "auth_email_challenges"
    __table_args__ = (Index("ix_auth_email_challenges_email_purpose", "email", "purpose"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    email: Mapped[str] = mapped_column(String)
    purpose: Mapped[str] = mapped_column(String)  # 'continue' | 'reset_password' | 'change_email'
    # Only for 'change_email': the signed-in user who asked for the change.
    user_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("auth_users.id", ondelete="CASCADE"), default=None
    )
    code_hash: Mapped[str] = mapped_column(String)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=5)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
    last_sent_at: Mapped[datetime] = mapped_column(UTCDateTime)
    verified_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    consumed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    # Registration token for a verified 'continue' challenge of a not-yet-existing account.
    verification_token_hash: Mapped[str | None] = mapped_column(String, index=True, default=None)
    request_ip: Mapped[str | None] = mapped_column(String, default=None)
    user_agent: Mapped[str | None] = mapped_column(String, default=None)
    provider_message_id: Mapped[str | None] = mapped_column(String, default=None)


class AuthRateLimit(Base):
    __tablename__ = "auth_rate_limits"
    __table_args__ = (UniqueConstraint("scope", "key_hash"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    scope: Mapped[str] = mapped_column(String)
    key_hash: Mapped[str] = mapped_column(String)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    window_started_at: Mapped[datetime] = mapped_column(UTCDateTime)
    blocked_until: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)


class AuthPersonalAccessToken(Base):
    __tablename__ = "auth_personal_access_tokens"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("auth_users.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String)
    token_hash: Mapped[str] = mapped_column(String, unique=True)
    prefix: Mapped[str] = mapped_column(String)  # first 8 chars, shown in the UI
    scopes: Mapped[list[Any]] = mapped_column(JSON)  # ['read'] | ['read', 'write']
    last_used_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
