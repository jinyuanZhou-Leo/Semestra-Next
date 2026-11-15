from datetime import datetime
from typing import Any

from sqlalchemy import JSON, ForeignKey, Index, Integer, LargeBinary, String, UniqueConstraint
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
    # Hash of the refresh token rotated out last; presenting it again means it was stolen.
    previous_refresh_token_hash: Mapped[str | None] = mapped_column(String, index=True)
    user_agent: Mapped[str | None] = mapped_column(String, default=None)
    ip: Mapped[str | None] = mapped_column(String, default=None)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    # Last sign-in or re-authentication; sensitive actions need it to be recent (M01 §4.5).
    verified_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    last_used_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)


class AuthEmailChallenge(Base):
    __tablename__ = "auth_email_challenges"
    __table_args__ = (Index("ix_auth_email_challenges_email_purpose", "email", "purpose"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    email: Mapped[str] = mapped_column(String)
    purpose: Mapped[str] = mapped_column(
        String
    )  # 'continue' | 'reset_password' | 'change_email' | 'reauth'
    # For 'change_email' and 'reauth': the signed-in user who asked for the code.
    user_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("auth_users.id", ondelete="CASCADE"), default=None, index=True
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
    """An MCP client's way in (M12 §5): a token the user pasted into it (`token`), or one the
    client got by signing in through OAuth (`oauth`, see `AuthOAuthGrant`). Both are listed,
    limited and revoked the same way; only a pasted token has a secret of its own."""

    __tablename__ = "auth_personal_access_tokens"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("auth_users.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String, default="token")  # 'token' | 'oauth'
    # OAuth only: the app this is known to be ('chatgpt' | 'claude'), see `oauth.common.known_app`.
    app: Mapped[str | None] = mapped_column(String, default=None)
    name: Mapped[str] = mapped_column(String)
    token_hash: Mapped[str | None] = mapped_column(String, unique=True, default=None)
    prefix: Mapped[str | None] = mapped_column(String, default=None)  # first 8 chars, for the UI
    scopes: Mapped[list[Any]] = mapped_column(JSON)  # ['read'] | ['read', 'write']
    last_used_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class AuthOAuthClient(Base):
    """An MCP client that registered itself (RFC 7591). Clients that publish a Client ID
    Metadata Document are not stored: their document is fetched and cached (M12 §5.3)."""

    __tablename__ = "auth_oauth_clients"

    id: Mapped[str] = mapped_column(String, primary_key=True)  # the client_id
    info: Mapped[dict[str, Any]] = mapped_column(JSON)  # the registration response
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class AuthOAuthGrant(Base):
    """The OAuth side of a connection (M12 §5.3): the authorization code the user approved,
    then, once the client redeemed it, its connection (`token_id`) and rotating refresh token."""

    __tablename__ = "auth_oauth_grants"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("auth_users.id", ondelete="CASCADE"), index=True
    )
    token_id: Mapped[str | None] = mapped_column(
        String,
        ForeignKey("auth_personal_access_tokens.id", ondelete="CASCADE"),
        unique=True,
        default=None,
    )
    client_id: Mapped[str] = mapped_column(String)
    client_name: Mapped[str] = mapped_column(String)
    scopes: Mapped[list[Any]] = mapped_column(JSON)  # ['read'] | ['read', 'write']
    resource: Mapped[str] = mapped_column(String)
    redirect_uri: Mapped[str] = mapped_column(String)
    redirect_uri_explicit: Mapped[bool] = mapped_column(default=True)
    # Until the client redeems it (once, within a minute).
    code_hash: Mapped[str | None] = mapped_column(String, unique=True, default=None)
    code_challenge: Mapped[str | None] = mapped_column(String, default=None)
    code_expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    # Rotated on every refresh. The one rotated out last, presented again well after the
    # rotation, means it was copied: the connection is revoked.
    refresh_token_hash: Mapped[str | None] = mapped_column(String, unique=True, default=None)
    previous_refresh_token_hash: Mapped[str | None] = mapped_column(
        String, index=True, default=None
    )
    refreshed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    # The current access token (random, like a pasted token); a new one with each refresh.
    access_token_hash: Mapped[str | None] = mapped_column(String, unique=True, default=None)
    access_expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class AuthPasskey(Base):
    """A WebAuthn credential (passkey) the user registered for signing in (M01 §4.9)."""

    __tablename__ = "auth_passkeys"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("auth_users.id", ondelete="CASCADE"), index=True
    )
    # The authenticator's credential id, base64url without padding (what the browser reports).
    credential_id: Mapped[str] = mapped_column(String, unique=True)
    public_key: Mapped[bytes] = mapped_column(LargeBinary)
    sign_count: Mapped[int] = mapped_column(Integer, default=0)
    transports: Mapped[list[Any]] = mapped_column(JSON, default=list)
    aaguid: Mapped[str] = mapped_column(String)
    # Given by the user; without one the client names it after its provider (by `aaguid`) or
    # the browser and system it was added on (`device`, as the client reported them).
    name: Mapped[str | None] = mapped_column(String, default=None)
    device: Mapped[str | None] = mapped_column(String, default=None)
    backed_up: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    last_used_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)


class AuthUsedWebAuthnChallenge(Base):
    """A WebAuthn challenge that has been answered, kept until it expires so it is not answered
    twice (M01 §4.9). Challenges themselves are signed, not stored."""

    __tablename__ = "auth_webauthn_used_challenges"

    id: Mapped[str] = mapped_column(String, primary_key=True)  # SHA-256 of the challenge
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
