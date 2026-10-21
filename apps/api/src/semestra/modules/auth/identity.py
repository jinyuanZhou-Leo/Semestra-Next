"""Resolving who is calling: Bearer (JWT or PAT) first, then the session cookie (M01 §3)."""

import hmac
from datetime import datetime, timedelta

from fastapi import Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from semestra.core.auth_schemes import SESSION_COOKIE
from semestra.core.config import Settings
from semestra.core.context import AuthInfo, Identity
from semestra.core.errors import AppError
from semestra.modules.auth import crypto
from semestra.modules.auth.models import AuthPersonalAccessToken, AuthSession, AuthUser

CSRF_COOKIE = "semestra_csrf"
CSRF_HEADER = "x-semestra-csrf"
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})

_RENEW_AFTER = timedelta(days=1)
_PAT_TOUCH_AFTER = timedelta(minutes=5)


def set_session_cookies(
    response: Response, settings: Settings, session_token: str, expires_at: datetime, now: datetime
) -> None:
    max_age = max(0, int((expires_at - now).total_seconds()))
    common = {
        "max_age": max_age,
        "domain": settings.cookie_domain,
        "path": "/",
        "secure": settings.use_secure_cookies,
        "samesite": "lax",
    }
    response.set_cookie(SESSION_COOKIE, session_token, httponly=True, **common)  # pyright: ignore[reportArgumentType]
    response.set_cookie(
        CSRF_COOKIE,
        crypto.csrf_token_for(settings, session_token),
        httponly=False,
        **common,  # pyright: ignore[reportArgumentType]
    )


def clear_session_cookies(response: Response, settings: Settings) -> None:
    for name in (SESSION_COOKIE, CSRF_COOKIE):
        response.delete_cookie(
            name, domain=settings.cookie_domain, path="/", secure=settings.use_secure_cookies
        )


async def _active_user(db: AsyncSession, user_id: str) -> AuthUser | None:
    user = await db.get(AuthUser, user_id)
    return user if user is not None and user.deleted_at is None else None


def _session_alive(session: AuthSession, now: datetime) -> bool:
    return session.revoked_at is None and session.expires_at > now


def _check_csrf(request: Request, settings: Settings, session_token: str) -> None:
    if request.method in SAFE_METHODS:
        return
    expected = crypto.csrf_token_for(settings, session_token)
    header = request.headers.get(CSRF_HEADER, "")
    cookie = request.cookies.get(CSRF_COOKIE, "")
    if not (hmac.compare_digest(header, expected) and hmac.compare_digest(cookie, expected)):
        raise AppError("auth.csrf_failed", 403)


async def _from_pat(db: AsyncSession, token: str, now: datetime) -> Identity | None:
    pat = (
        await db.execute(
            select(AuthPersonalAccessToken).where(
                AuthPersonalAccessToken.token_hash == crypto.hash_token(token)
            )
        )
    ).scalar_one_or_none()
    if pat is None or pat.revoked_at is not None:
        return None
    if pat.expires_at is not None and pat.expires_at <= now:
        return None
    user = await _active_user(db, pat.user_id)
    if user is None:
        return None
    if pat.last_used_at is None or now - pat.last_used_at >= _PAT_TOUCH_AFTER:
        pat.last_used_at = now
    scopes = tuple(str(s) for s in pat.scopes)
    return Identity(user, AuthInfo(kind="pat", token_id=pat.id, scopes=scopes))


async def _from_jwt(
    db: AsyncSession, settings: Settings, token: str, now: datetime
) -> Identity | None:
    decoded = crypto.decode_access_token(settings, token, now)
    if decoded is None:
        return None
    user_id, session_id = decoded
    session = await db.get(AuthSession, session_id)
    if session is None or session.user_id != user_id or not _session_alive(session, now):
        return None
    user = await _active_user(db, user_id)
    if user is None:
        return None
    return Identity(
        user, AuthInfo(kind="jwt", session_id=session.id, session_created_at=session.created_at)
    )


async def _from_cookie(
    request: Request, db: AsyncSession, settings: Settings, token: str, now: datetime
) -> Identity | None:
    session = (
        await db.execute(
            select(AuthSession).where(
                AuthSession.refresh_token_hash == crypto.hash_token(token),
                AuthSession.kind == "web",
            )
        )
    ).scalar_one_or_none()
    if session is None or not _session_alive(session, now):
        return None
    user = await _active_user(db, session.user_id)
    if user is None:
        return None
    _check_csrf(request, settings, token)

    renewed: str | None = None
    if now - session.last_used_at >= _RENEW_AFTER:  # sliding expiry, at most one write per day
        session.last_used_at = now
        session.expires_at = now + timedelta(days=settings.session_ttl_days)
        renewed = token
    return Identity(
        user,
        AuthInfo(kind="cookie", session_id=session.id, session_created_at=session.created_at),
        cookie_token=renewed,
    )


async def authenticate(
    request: Request, response: Response, db: AsyncSession, now: datetime
) -> Identity | None:
    settings: Settings = request.app.state.settings
    authorization = request.headers.get("authorization", "")
    scheme, _, bearer = authorization.partition(" ")
    if scheme.lower() == "bearer" and bearer:
        # An explicit Bearer credential never falls back to the cookie.
        bearer = bearer.strip()
        if bearer.startswith(crypto.PAT_PREFIX):
            return await _from_pat(db, bearer, now)
        return await _from_jwt(db, settings, bearer, now)

    cookie = request.cookies.get(SESSION_COOKIE)
    if not cookie:
        return None
    identity = await _from_cookie(request, db, settings, cookie, now)
    if identity is not None and identity.cookie_token is not None:
        session = await db.get(AuthSession, identity.auth.session_id)
        if session is not None:
            set_session_cookies(response, settings, cookie, session.expires_at, now)
    return identity
