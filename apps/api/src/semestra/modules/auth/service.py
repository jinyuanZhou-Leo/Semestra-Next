"""Business logic for sign-in, registration, sessions and account security (M01 §4)."""

import hmac
import math
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

import structlog
from sqlalchemy import select, update
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from semestra.core.context import Ctx
from semestra.core.db import new_id
from semestra.core.errors import AppError, not_found
from semestra.core.i18n import render_email
from semestra.modules.auth import crypto, ratelimit
from semestra.modules.auth.google import GoogleClaims, GoogleVerifier
from semestra.modules.auth.mailer import Mailer, OutgoingEmail
from semestra.modules.auth.models import (
    AuthEmailChallenge,
    AuthIdentity,
    AuthPersonalAccessToken,
    AuthSession,
    AuthUser,
)
from semestra.modules.auth.schemas import (
    EmailStartResult,
    IdentityOut,
    SessionOut,
    TokenCreated,
    TokenOut,
    TokenPair,
    TokenScope,
    UserOut,
)

log = structlog.get_logger()

CODE_TTL = timedelta(minutes=10)
RESEND_INTERVAL = timedelta(seconds=60)
REGISTRATION_TTL = timedelta(minutes=15)
REAUTH_WINDOW = timedelta(minutes=10)
EMAIL_START_PER_EMAIL = (10, timedelta(hours=1))
EMAIL_START_PER_IP = (30, timedelta(hours=1))
LOGIN_PER_EMAIL = (10, timedelta(minutes=15))
LOGIN_PER_IP = (50, timedelta(minutes=15))
CHANGE_EMAIL_PER_USER = (10, timedelta(hours=1))

Client = Literal["web", "native"]


@dataclass(frozen=True)
class RequestMeta:
    ip: str | None
    user_agent: str | None


@dataclass
class AuthRuntime:
    """Per-app collaborators, kept on `app.state.auth_runtime` so tests can swap them."""

    mailer: Mailer
    google: GoogleVerifier


@dataclass
class SignedIn:
    user: AuthUser
    session: AuthSession
    token: str  # cookie value (web) or refresh token (native)
    client: Client


# --- users ----------------------------------------------------------------------------------


async def user_by_email(db: AsyncSession, email: str) -> AuthUser | None:
    return (
        await db.execute(
            select(AuthUser).where(AuthUser.email == email, AuthUser.deleted_at.is_(None))
        )
    ).scalar_one_or_none()


async def user_out(db: AsyncSession, user: AuthUser) -> UserOut:
    identities = (
        (
            await db.execute(
                select(AuthIdentity)
                .where(AuthIdentity.user_id == user.id)
                .order_by(AuthIdentity.created_at)
            )
        )
        .scalars()
        .all()
    )
    return UserOut(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        avatar_url=user.avatar_url,
        locale=user.locale,
        has_password=user.password_hash is not None,
        identities=[
            IdentityOut(provider="google", email=i.email, created_at=i.created_at)
            for i in identities
        ],
        created_at=user.created_at,
    )


async def _create_user(
    ctx: Ctx,
    *,
    email: str,
    display_name: str,
    password: str | None = None,
    avatar_url: str | None = None,
) -> AuthUser:
    if password is not None:
        crypto.validate_password(password, email)
    if await user_by_email(ctx.db, email) is not None:
        raise AppError("auth.email_in_use", 409)
    user = AuthUser(
        email=email,
        email_verified_at=ctx.now,
        display_name=display_name,
        avatar_url=avatar_url,
        password_hash=await crypto.hash_password(password) if password is not None else None,
        locale=ctx.locale,
        created_at=ctx.now,
        updated_at=ctx.now,
    )
    ctx.db.add(user)
    await ctx.db.flush()
    return user


# --- email challenges -----------------------------------------------------------------------


async def _send_later(
    ctx: Ctx,
    to: str,
    template: str,
    locale: str,
    params: dict[str, object],
    challenge_id: str | None = None,
) -> None:
    """Queues an email to go out once the request's transaction has committed."""
    runtime: AuthRuntime = ctx.state.auth_runtime
    category = "auth_verification" if template.startswith("verification_code") else "auth_notice"
    message = OutgoingEmail(
        to,
        render_email(template, locale, params),
        idempotency_key=challenge_id,
        tags=(("category", category), ("purpose", template)),
    )
    session_factory = ctx.state.session_factory

    async def deliver() -> None:
        try:
            message_id = await runtime.mailer.send(message)
            if challenge_id is not None and message_id:
                async with session_factory() as db:
                    await db.execute(
                        update(AuthEmailChallenge)
                        .where(AuthEmailChallenge.id == challenge_id)
                        .values(provider_message_id=message_id)
                    )
                    await db.commit()
        except Exception:
            log.exception("email_send_failed", template=template)

    ctx.after_commit.append(deliver)


async def start_challenge(
    ctx: Ctx,
    *,
    email: str,
    purpose: Literal["continue", "reset_password", "change_email"],
    meta: RequestMeta,
    user_id: str | None = None,
) -> EmailStartResult:
    """Creates and (after commit) emails a code. Same response whether or not the account exists."""
    s, db = ctx.settings, ctx.db
    count, window = EMAIL_START_PER_EMAIL
    await ratelimit.hit(db, s, ctx.now, "email_start_email", email, limit=count, window=window)
    if meta.ip:
        count, window = EMAIL_START_PER_IP
        await ratelimit.hit(db, s, ctx.now, "email_start_ip", meta.ip, limit=count, window=window)

    stmt = select(AuthEmailChallenge).where(
        AuthEmailChallenge.email == email,
        AuthEmailChallenge.purpose == purpose,
        AuthEmailChallenge.consumed_at.is_(None),
    )
    if purpose == "change_email":
        # Another account asking for the same target address must not touch this user's code.
        stmt = stmt.where(AuthEmailChallenge.user_id == user_id)
    live = (await db.execute(stmt.order_by(AuthEmailChallenge.last_sent_at.desc()))).scalars().all()
    if live and live[0].last_sent_at + RESEND_INTERVAL > ctx.now:
        wait = (live[0].last_sent_at + RESEND_INTERVAL - ctx.now).total_seconds()
        raise AppError("common.rate_limited", 429, retry_after_seconds=math.ceil(wait))
    for old in live:
        old.consumed_at = ctx.now  # only the newest code is valid

    existing = await user_by_email(db, email)
    code = crypto.new_code()
    challenge = AuthEmailChallenge(
        id=new_id(),
        email=email,
        purpose=purpose,
        user_id=user_id,
        attempts=0,
        max_attempts=5,
        expires_at=ctx.now + CODE_TTL,
        last_sent_at=ctx.now,
        request_ip=meta.ip,
        user_agent=(meta.user_agent or "")[:512] or None,
        code_hash="",
    )
    challenge.code_hash = crypto.code_hash(s, challenge.id, code)
    db.add(challenge)

    locale = existing.locale if existing and existing.locale else ctx.locale
    await _send_later(
        ctx,
        email,
        f"verification_code_{purpose}",
        locale,
        {
            "code": code,
            "minutes": int(CODE_TTL.total_seconds() // 60),
            "email": email,
        },
        challenge_id=challenge.id,
    )
    return EmailStartResult(
        resend_in_seconds=int(RESEND_INTERVAL.total_seconds()),
        expires_in_seconds=int(CODE_TTL.total_seconds()),
    )


async def _check_code(
    ctx: Ctx,
    *,
    email: str,
    purpose: Literal["continue", "reset_password", "change_email"],
    code: str,
    user_id: str | None = None,
) -> AuthEmailChallenge:
    """Validates a code against the newest open challenge; counts wrong attempts."""
    stmt = select(AuthEmailChallenge).where(
        AuthEmailChallenge.email == email,
        AuthEmailChallenge.purpose == purpose,
        AuthEmailChallenge.consumed_at.is_(None),
        AuthEmailChallenge.verified_at.is_(None),
    )
    if user_id is not None:
        stmt = stmt.where(AuthEmailChallenge.user_id == user_id)
    challenge = (
        (await ctx.db.execute(stmt.order_by(AuthEmailChallenge.last_sent_at.desc())))
        .scalars()
        .first()
    )
    if challenge is None:
        raise AppError("auth.invalid_code", 400)
    if challenge.expires_at <= ctx.now:
        raise AppError("auth.code_expired", 400)
    # Every guess is counted by one atomic UPDATE *before* the code is compared, so a burst of
    # parallel guesses cannot get more than `max_attempts` comparisons.
    claimed = (
        await ctx.db.execute(
            update(AuthEmailChallenge)
            .where(
                AuthEmailChallenge.id == challenge.id,
                AuthEmailChallenge.attempts < AuthEmailChallenge.max_attempts,
                AuthEmailChallenge.consumed_at.is_(None),
            )
            .values(attempts=AuthEmailChallenge.attempts + 1)
            .returning(AuthEmailChallenge.attempts)
            .execution_options(synchronize_session=False)
        )
    ).first()
    if claimed is None:
        raise AppError("auth.too_many_attempts", 429)
    await ctx.db.commit()  # the attempt counts even if the request fails later
    expected = crypto.code_hash(ctx.settings, challenge.id, code)
    if not hmac.compare_digest(challenge.code_hash, expected):
        used_up = claimed.attempts >= challenge.max_attempts
        if used_up:
            challenge.consumed_at = ctx.now  # the code is void after the last miss
            await ctx.db.commit()
        raise AppError(
            "auth.too_many_attempts" if used_up else "auth.invalid_code", 429 if used_up else 400
        )
    return challenge


# --- sessions -------------------------------------------------------------------------------


async def create_session(ctx: Ctx, user: AuthUser, client: Client, meta: RequestMeta) -> SignedIn:
    s = ctx.settings
    web = client == "web"
    token = crypto.new_token(crypto.SESSION_PREFIX if web else crypto.REFRESH_PREFIX)
    ttl = timedelta(days=s.session_ttl_days if web else s.refresh_token_ttl_days)
    session = AuthSession(
        user_id=user.id,
        kind=client,
        refresh_token_hash=crypto.hash_token(token),
        user_agent=(meta.user_agent or "")[:512] or None,
        ip=meta.ip,
        created_at=ctx.now,
        last_used_at=ctx.now,
        expires_at=ctx.now + ttl,
    )
    ctx.db.add(session)
    await ctx.db.flush()
    return SignedIn(user, session, token, client)


def token_pair(ctx: Ctx, signed_in: SignedIn) -> TokenPair:
    s = ctx.settings
    return TokenPair(
        access_token=crypto.issue_access_token(s, signed_in.user.id, signed_in.session.id, ctx.now),
        refresh_token=signed_in.token,
        expires_in=s.access_token_ttl_seconds,
    )


async def revoke_sessions(
    db: AsyncSession, user_id: str, now: datetime, *, except_id: str | None = None
) -> None:
    stmt = (
        update(AuthSession)
        .where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    if except_id is not None:
        stmt = stmt.where(AuthSession.id != except_id)
    await db.execute(stmt)


async def revoke_all_for_user(db: AsyncSession, user_id: str, now: datetime) -> None:
    """Revokes every session and personal access token (used by account deletion, M13)."""
    await revoke_sessions(db, user_id, now)
    await db.execute(
        update(AuthPersonalAccessToken)
        .where(
            AuthPersonalAccessToken.user_id == user_id,
            AuthPersonalAccessToken.revoked_at.is_(None),
        )
        .values(revoked_at=now)
    )


# A rotated-out refresh token presented this soon after its rotation is a concurrent request
# that lost the race; later reuse means the token was copied and revokes the session.
REFRESH_REUSE_GRACE = timedelta(seconds=10)


async def refresh_native(ctx: Ctx, refresh_token: str, meta: RequestMeta) -> SignedIn:
    """Rotates a native refresh token. Reusing a rotated token revokes the whole session."""
    digest = crypto.hash_token(refresh_token)
    expired = AppError("auth.session_expired", 401)
    session = (
        await ctx.db.execute(
            select(AuthSession).where(
                AuthSession.refresh_token_hash == digest, AuthSession.kind == "native"
            )
        )
    ).scalar_one_or_none()
    if session is None:
        replayed = (
            await ctx.db.execute(
                select(AuthSession).where(AuthSession.previous_refresh_token_hash == digest)
            )
        ).scalar_one_or_none()
        if replayed is not None and replayed.revoked_at is None:
            if ctx.now - replayed.last_used_at < REFRESH_REUSE_GRACE:
                # Sent together with the refresh that rotated it (several app requests at once):
                # a lost race, not a stolen token.
                raise expired
            replayed.revoked_at = ctx.now
            await ctx.db.commit()
            log.warning("refresh_token_replay", session_id=replayed.id, user_id=replayed.user_id)
        raise expired
    user = await ctx.db.get(AuthUser, session.user_id)
    if session.revoked_at is not None or session.expires_at <= ctx.now:
        raise expired
    if user is None or user.deleted_at is not None:
        raise expired

    new_token = crypto.new_token(crypto.REFRESH_PREFIX)
    # Claim the current token atomically: of several concurrent refreshes with the same token,
    # exactly one rotates it; the rest lose here and get a plain 401 (not a replay revocation).
    try:
        claimed = (
            await ctx.db.execute(
                update(AuthSession)
                .where(AuthSession.id == session.id, AuthSession.refresh_token_hash == digest)
                .values(
                    refresh_token_hash=crypto.hash_token(new_token),
                    previous_refresh_token_hash=digest,
                    last_used_at=ctx.now,
                    expires_at=ctx.now + timedelta(days=ctx.settings.refresh_token_ttl_days),
                    user_agent=meta.user_agent[:512] if meta.user_agent else session.user_agent,
                )
                .returning(AuthSession.id)
                .execution_options(synchronize_session=False)
            )
        ).first()
    except OperationalError:  # SQLite refuses the write when a concurrent rotation committed first
        await ctx.db.rollback()
        raise expired from None
    if claimed is None:
        raise expired
    await ctx.db.refresh(session)
    return SignedIn(user, session, new_token, "native")


# --- flows ----------------------------------------------------------------------------------


async def _notify_new_sign_in(ctx: Ctx, user: AuthUser, meta: RequestMeta) -> None:
    if not ctx.settings.notify_new_sign_in:
        return
    await _send_later(
        ctx,
        user.email,
        "new_sign_in",
        user.locale or ctx.locale,
        {
            "name": user.display_name,
            "time": ctx.now.strftime("%Y-%m-%d %H:%M"),
            "device": meta.user_agent or "-",
            "ip": meta.ip or "-",
            "settings_url": f"{ctx.settings.public_web_origin}/settings/account",
        },
    )


async def verify_email_code(
    ctx: Ctx, email: str, code: str, client: Client, meta: RequestMeta
) -> tuple[SignedIn | None, str | None]:
    """§4.1 step 2: (signed_in, None) for an existing account, (None, token) for a new one."""
    challenge = await _check_code(ctx, email=email, purpose="continue", code=code)
    challenge.verified_at = ctx.now
    user = await user_by_email(ctx.db, email)
    if user is not None:
        challenge.consumed_at = ctx.now
        if user.email_verified_at is None:
            user.email_verified_at = ctx.now
        signed_in = await create_session(ctx, user, client, meta)
        await _notify_new_sign_in(ctx, user, meta)
        return signed_in, None
    token = crypto.new_token(crypto.REGISTRATION_PREFIX)
    challenge.verification_token_hash = crypto.hash_token(token)
    return None, token


async def complete_registration(
    ctx: Ctx,
    registration_token: str,
    display_name: str,
    password: str | None,
    client: Client,
    meta: RequestMeta,
) -> SignedIn:
    challenge = (
        await ctx.db.execute(
            select(AuthEmailChallenge).where(
                AuthEmailChallenge.verification_token_hash == crypto.hash_token(registration_token),
                AuthEmailChallenge.consumed_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if (
        challenge is None
        or challenge.verified_at is None
        or challenge.verified_at + REGISTRATION_TTL <= ctx.now
    ):
        raise AppError("auth.registration_expired", 400)
    user = await _create_user(
        ctx, email=challenge.email, display_name=display_name, password=password
    )
    challenge.consumed_at = ctx.now
    return await create_session(ctx, user, client, meta)


async def login_with_password(
    ctx: Ctx, email: str, password: str, client: Client, meta: RequestMeta
) -> SignedIn:
    s, db = ctx.settings, ctx.db
    count, window = LOGIN_PER_EMAIL
    await ratelimit.hit(db, s, ctx.now, "login_email", email, limit=count, window=window)
    if meta.ip:
        count, window = LOGIN_PER_IP
        await ratelimit.hit(db, s, ctx.now, "login_ip", meta.ip, limit=count, window=window)
    user = await user_by_email(db, email)
    ok = await crypto.verify_password(password, user.password_hash if user else None)
    if not ok or user is None or user.password_hash is None:
        raise AppError("auth.invalid_credentials", 401)
    if crypto.needs_rehash(user.password_hash):
        user.password_hash = await crypto.hash_password(password)
    signed_in = await create_session(ctx, user, client, meta)
    await _notify_new_sign_in(ctx, user, meta)
    return signed_in


async def _after_password_change(ctx: Ctx, user: AuthUser) -> None:
    await _send_later(
        ctx,
        user.email,
        "password_changed",
        user.locale or ctx.locale,
        {
            "name": user.display_name,
            "reset_url": f"{ctx.settings.public_web_origin}/login/reset",
        },
    )


async def reset_password(
    ctx: Ctx, email: str, code: str, new_password: str, client: Client, meta: RequestMeta
) -> SignedIn:
    crypto.validate_password(new_password, email)
    challenge = await _check_code(ctx, email=email, purpose="reset_password", code=code)
    user = await user_by_email(ctx.db, email)
    if user is None:
        # A code was checked for an address with no account: indistinguishable from a bad code.
        challenge.consumed_at = ctx.now
        await ctx.db.commit()
        raise AppError("auth.invalid_code", 400)
    challenge.verified_at = challenge.consumed_at = ctx.now
    user.password_hash = await crypto.hash_password(new_password)
    if user.email_verified_at is None:
        user.email_verified_at = ctx.now
    await revoke_sessions(ctx.db, user.id, ctx.now)
    await _after_password_change(ctx, user)
    return await create_session(ctx, user, client, meta)


async def login_with_google(
    ctx: Ctx, claims: GoogleClaims, client: Client, meta: RequestMeta
) -> SignedIn:
    """§4.3: by identity subject, else by verified email (auto-link), else a new account."""
    db = ctx.db
    identity = (
        await db.execute(
            select(AuthIdentity).where(
                AuthIdentity.provider == "google", AuthIdentity.subject == claims.subject
            )
        )
    ).scalar_one_or_none()
    user = await db.get(AuthUser, identity.user_id) if identity else None
    if user is not None and user.deleted_at is not None:
        # The Google account belongs to a deleted user: never fall through to provisioning.
        raise AppError("auth.invalid_credentials", 401)
    if user is None:
        user = await user_by_email(db, claims.email)
        if user is None:
            user = await _create_user(
                ctx,
                email=claims.email,
                display_name=claims.name or claims.email.split("@")[0],
                avatar_url=claims.picture,
            )
        if identity is None:
            db.add(
                AuthIdentity(
                    user_id=user.id,
                    provider="google",
                    subject=claims.subject,
                    email=claims.email,
                    created_at=ctx.now,
                )
            )
        if user.email_verified_at is None:
            user.email_verified_at = ctx.now  # Google verified this address
    elif identity is not None:
        identity.email = claims.email  # the Google account's address may have changed
    signed_in = await create_session(ctx, user, client, meta)
    await _notify_new_sign_in(ctx, user, meta)
    return signed_in


async def logout(ctx: Ctx) -> None:
    if ctx.auth and ctx.auth.session_id:
        await ctx.db.execute(
            update(AuthSession)
            .where(AuthSession.id == ctx.auth.session_id, AuthSession.revoked_at.is_(None))
            .values(revoked_at=ctx.now)
        )


# --- account management (capabilities) ------------------------------------------------------


async def update_profile(
    ctx: Ctx, display_name: str | None, avatar_url: str | None, *, set_avatar: bool
) -> UserOut:
    user = _require_user(ctx)
    if display_name is not None:
        user.display_name = display_name
    if set_avatar:
        user.avatar_url = avatar_url
    await ctx.db.flush()
    return await user_out(ctx.db, user)


def set_locale_cache(ctx: Ctx, locale: str | None) -> None:
    """Keep `auth_users.locale` (read for emails and request locale) equal to the M11 preference."""
    _require_user(ctx).locale = locale


def _require_user(ctx: Ctx) -> AuthUser:
    if ctx.user is None:
        raise AppError("common.unauthenticated", 401)
    return ctx.user


async def change_password(ctx: Ctx, current_password: str | None, new_password: str) -> UserOut:
    user = _require_user(ctx)
    s = ctx.settings
    if user.password_hash is not None:
        await ratelimit.hit(
            ctx.db,
            s,
            ctx.now,
            "password_change_user",
            user.id,
            limit=10,
            window=timedelta(minutes=15),
        )
        if current_password is None or not await crypto.verify_password(
            current_password, user.password_hash
        ):
            raise AppError("auth.invalid_credentials", 401)
    else:
        created = ctx.auth.session_created_at if ctx.auth else None
        if created is None or ctx.now - created > REAUTH_WINDOW:
            raise AppError("auth.reauth_required", 403)
    crypto.validate_password(new_password, user.email)
    user.password_hash = await crypto.hash_password(new_password)
    await revoke_sessions(
        ctx.db, user.id, ctx.now, except_id=ctx.auth.session_id if ctx.auth else None
    )
    await _after_password_change(ctx, user)
    await ctx.db.flush()
    return await user_out(ctx.db, user)


async def change_email_start(ctx: Ctx, new_email: str, meta: RequestMeta) -> EmailStartResult:
    user = _require_user(ctx)
    if new_email == user.email:
        raise AppError("auth.email_in_use", 409)
    if await user_by_email(ctx.db, new_email) is not None:
        raise AppError("auth.email_in_use", 409)
    # Capabilities carry no client IP, so cap the signed-in user instead: otherwise one account
    # could mail arbitrarily many different addresses.
    count, window = CHANGE_EMAIL_PER_USER
    await ratelimit.hit(
        ctx.db, ctx.settings, ctx.now, "change_email_user", user.id, limit=count, window=window
    )
    return await start_challenge(
        ctx, email=new_email, purpose="change_email", meta=meta, user_id=user.id
    )


async def change_email_confirm(ctx: Ctx, code: str) -> UserOut:
    user = _require_user(ctx)
    pending = (
        (
            await ctx.db.execute(
                select(AuthEmailChallenge)
                .where(
                    AuthEmailChallenge.user_id == user.id,
                    AuthEmailChallenge.purpose == "change_email",
                    AuthEmailChallenge.consumed_at.is_(None),
                    AuthEmailChallenge.verified_at.is_(None),
                )
                .order_by(AuthEmailChallenge.last_sent_at.desc())
            )
        )
        .scalars()
        .first()
    )
    if pending is None:
        raise AppError("auth.invalid_code", 400)
    challenge = await _check_code(
        ctx, email=pending.email, purpose="change_email", code=code, user_id=user.id
    )
    if await user_by_email(ctx.db, challenge.email) is not None:
        raise AppError("auth.email_in_use", 409)
    challenge.verified_at = challenge.consumed_at = ctx.now
    user.email = challenge.email
    user.email_verified_at = ctx.now
    await ctx.db.flush()
    return await user_out(ctx.db, user)


async def link_google(ctx: Ctx, claims: GoogleClaims) -> UserOut:
    user = _require_user(ctx)
    identity = (
        await ctx.db.execute(
            select(AuthIdentity).where(
                AuthIdentity.provider == "google", AuthIdentity.subject == claims.subject
            )
        )
    ).scalar_one_or_none()
    if identity is not None and identity.user_id != user.id:
        raise AppError("auth.identity_in_use", 409)
    if identity is None:
        ctx.db.add(
            AuthIdentity(
                user_id=user.id,
                provider="google",
                subject=claims.subject,
                email=claims.email,
                created_at=ctx.now,
            )
        )
    if user.avatar_url is None and claims.picture:
        user.avatar_url = claims.picture
    await ctx.db.flush()
    return await user_out(ctx.db, user)


async def unlink_google(ctx: Ctx) -> UserOut:
    """Always allowed: the email code is a login method that cannot be removed."""
    user = _require_user(ctx)
    identities = (
        (
            await ctx.db.execute(
                select(AuthIdentity).where(
                    AuthIdentity.user_id == user.id, AuthIdentity.provider == "google"
                )
            )
        )
        .scalars()
        .all()
    )
    for identity in identities:
        await ctx.db.delete(identity)
    await ctx.db.flush()
    return await user_out(ctx.db, user)


async def list_sessions(ctx: Ctx) -> list[SessionOut]:
    user = _require_user(ctx)
    rows = (
        (
            await ctx.db.execute(
                select(AuthSession)
                .where(
                    AuthSession.user_id == user.id,
                    AuthSession.revoked_at.is_(None),
                    AuthSession.expires_at > ctx.now,
                )
                .order_by(AuthSession.last_used_at.desc())
            )
        )
        .scalars()
        .all()
    )
    current = ctx.auth.session_id if ctx.auth else None
    return [
        SessionOut(
            id=r.id,
            kind="web" if r.kind == "web" else "native",
            user_agent=r.user_agent,
            ip=r.ip,
            created_at=r.created_at,
            last_used_at=r.last_used_at,
            expires_at=r.expires_at,
            current=r.id == current,
        )
        for r in rows
    ]


async def revoke_session(ctx: Ctx, session_id: str) -> None:
    user = _require_user(ctx)
    session = await ctx.db.get(AuthSession, session_id)
    if session is None or session.user_id != user.id:
        raise not_found()
    if session.revoked_at is None:
        session.revoked_at = ctx.now


async def revoke_other_sessions(ctx: Ctx) -> None:
    user = _require_user(ctx)
    await revoke_sessions(
        ctx.db, user.id, ctx.now, except_id=ctx.auth.session_id if ctx.auth else None
    )


def _token_out(row: AuthPersonalAccessToken) -> TokenOut:
    return TokenOut(
        id=row.id,
        name=row.name,
        prefix=row.prefix,
        scopes=[s for s in row.scopes if s in ("read", "write")],
        created_at=row.created_at,
        last_used_at=row.last_used_at,
        expires_at=row.expires_at,
    )


async def list_tokens(ctx: Ctx) -> list[TokenOut]:
    user = _require_user(ctx)
    rows = (
        (
            await ctx.db.execute(
                select(AuthPersonalAccessToken)
                .where(
                    AuthPersonalAccessToken.user_id == user.id,
                    AuthPersonalAccessToken.revoked_at.is_(None),
                )
                .order_by(AuthPersonalAccessToken.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return [_token_out(r) for r in rows]


async def create_token(
    ctx: Ctx, name: str, scopes: list[TokenScope], expires_in_days: int | None
) -> TokenCreated:
    user = _require_user(ctx)
    plaintext = crypto.new_token(crypto.PAT_PREFIX)
    # `write` implies `read`; store the canonical set.
    canonical: list[TokenScope] = ["read", "write"] if "write" in scopes else ["read"]
    row = AuthPersonalAccessToken(
        user_id=user.id,
        name=name,
        token_hash=crypto.hash_token(plaintext),
        prefix=plaintext[:8],
        scopes=list(canonical),
        expires_at=ctx.now + timedelta(days=expires_in_days) if expires_in_days else None,
        created_at=ctx.now,
    )
    ctx.db.add(row)
    await ctx.db.flush()
    return TokenCreated(**_token_out(row).model_dump(), token=plaintext)


async def revoke_token(ctx: Ctx, token_id: str) -> None:
    user = _require_user(ctx)
    row = await ctx.db.get(AuthPersonalAccessToken, token_id)
    if row is None or row.user_id != user.id:
        raise not_found()
    if row.revoked_at is None:
        row.revoked_at = ctx.now
