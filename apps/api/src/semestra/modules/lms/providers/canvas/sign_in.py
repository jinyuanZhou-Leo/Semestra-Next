"""Signing in to Canvas on the school's own login page (self-hosting only, M09 §2.3).

Canvas hands its mobile apps an OAuth client per school (`mobile_verify`); a sign-in through it
returns a refresh token that lasts until the user revokes it under Settings → Approved
integrations. The user signs in (SSO, MFA) in their own browser tab: Semestra never sees the
password. The client's redirect address belongs to Canvas, so the browser stops on it and the
user pastes that address back, which carries the authorization code. Only over https: the
exchange and every renewal send the client secret and the refresh token.
"""

from datetime import datetime, timedelta
from typing import Any, cast
from urllib.parse import parse_qs, urlencode, urlsplit

import httpx
from pydantic import SecretStr

from semestra.core.errors import AppError
from semestra.modules.lms.errors import lms_error
from semestra.modules.lms.providers.base import Io
from semestra.modules.lms.providers.canvas.config import CanvasConfig, CanvasCredentials

MOBILE_VERIFY_URL = "https://sso.canvaslms.com/api/v1/mobile_verify.json"
# The Android app's own identification: `mobile_verify` answers only to the Canvas apps.
MOBILE_USER_AGENT = "candroid/8.6.1 (289)"
# Registered with the mobile clients; the browser stops here with `?code=…`.
REDIRECT_URI = "https://sso.canvaslms.com/canvas/login"
# Shown in the user's Canvas settings as the name of the integration.
PURPOSE = "Semestra"
# Renew this long before the access token expires, so a slow request does not run past it.
EXPIRY_MARGIN = timedelta(minutes=5)


async def _send(io: Io, method: str, url: str, **kwargs: Any) -> httpx.Response:
    try:
        return await io.client.request(method, url, **kwargs)
    except AppError as exc:
        if exc.code == "common.egress_blocked":
            raise lms_error("lms.blocked_address") from None
        raise
    except httpx.HTTPError:
        raise lms_error("lms.unreachable") from None


def _json(response: httpx.Response) -> dict[str, Any]:
    try:
        data = response.json()
    except ValueError:
        raise lms_error("lms.unreachable", reason="payload") from None
    if not isinstance(data, dict):
        raise lms_error("lms.unreachable", reason="payload")
    return cast(dict[str, Any], data)


async def mobile_client(io: Io, cfg: CanvasConfig) -> tuple[str, str]:
    """The mobile apps' OAuth client for this school: `lms.sign_in_unavailable` when Canvas does
    not know the address (a self-hosted Canvas, a typo). Every sign-in starts here, so this is
    also where a plain-http address stops."""
    if urlsplit(cfg.base_url).scheme != "https":
        raise lms_error("lms.sign_in_https_required")
    response = await _send(
        io,
        "GET",
        MOBILE_VERIFY_URL,
        params={"domain": urlsplit(cfg.base_url).netloc, "user_agent": MOBILE_USER_AGENT},
        headers={"User-Agent": MOBILE_USER_AGENT, "Accept": "application/json"},
    )
    if response.status_code >= 500:
        raise lms_error("lms.unreachable", upstream_status=response.status_code)
    data = _json(response) if response.status_code < 400 else {}
    client_id, secret = data.get("client_id"), data.get("client_secret")
    if data.get("authorized") is False or not client_id or not secret:
        raise lms_error("lms.sign_in_unavailable")
    return str(client_id), str(secret)


def authorize_url(cfg: CanvasConfig, client_id: str) -> str:
    query = urlencode(
        {
            "client_id": client_id,
            "response_type": "code",
            "mobile": "1",
            "purpose": PURPOSE,
            "redirect_uri": REDIRECT_URI,
        }
    )
    return f"{cfg.base_url}/login/oauth2/auth?{query}"


def code_from(pasted: str) -> str:
    """The authorization code from the pasted address (or the code itself)."""
    text = pasted.strip()
    if not text:
        raise lms_error("lms.sign_in_failed", reason="no_code")
    if "://" not in text and "=" not in text and "?" not in text:
        return text
    query = parse_qs(urlsplit(text).query or text.lstrip("?"))
    if query.get("error"):
        raise lms_error("lms.sign_in_failed", reason="denied")
    code = (query.get("code") or [""])[0].strip()
    if not code:
        raise lms_error("lms.sign_in_failed", reason="no_code")
    return code


def _expiry(data: dict[str, Any], now: datetime) -> datetime | None:
    seconds = data.get("expires_in")
    return now + timedelta(seconds=float(seconds)) if isinstance(seconds, int | float) else None


async def exchange(io: Io, cfg: CanvasConfig, pasted: str, now: datetime) -> CanvasCredentials:
    code = code_from(pasted)
    client_id, secret = await mobile_client(io, cfg)
    response = await _send(
        io,
        "POST",
        f"{cfg.base_url}/login/oauth2/token",
        data={
            "grant_type": "authorization_code",
            "client_id": client_id,
            "client_secret": secret,
            "redirect_uri": REDIRECT_URI,
            "code": code,
        },
        headers={"Accept": "application/json"},
    )
    if response.status_code in (400, 401):
        # A code is single use and lives a few minutes: the user signs in again.
        raise lms_error("lms.sign_in_failed", reason="expired")
    if response.status_code >= 300:
        raise lms_error("lms.unreachable", upstream_status=response.status_code)
    data = _json(response)
    if not data.get("access_token") or not data.get("refresh_token"):
        raise lms_error("lms.sign_in_failed", reason="no_token")
    return CanvasCredentials(
        access_token=SecretStr(str(data["access_token"])),
        refresh_token=SecretStr(str(data["refresh_token"])),
        client_id=client_id,
        client_secret=SecretStr(secret),
        expires_at=_expiry(data, now),
    )


def refreshable(creds: CanvasCredentials) -> bool:
    return bool(creds.refresh_token and creds.client_id and creds.client_secret)


def stale(creds: CanvasCredentials, now: datetime) -> bool:
    return (
        refreshable(creds)
        and creds.expires_at is not None
        and creds.expires_at - now < EXPIRY_MARGIN
    )


async def refresh(
    io: Io, cfg: CanvasConfig, creds: CanvasCredentials, now: datetime
) -> CanvasCredentials:
    """A new access token; `lms.invalid_credentials` once the user revoked the sign-in."""
    assert creds.refresh_token
    assert creds.client_id
    assert creds.client_secret
    response = await _send(
        io,
        "POST",
        f"{cfg.base_url}/login/oauth2/token",
        data={
            "grant_type": "refresh_token",
            "client_id": creds.client_id,
            "client_secret": creds.client_secret.get_secret_value(),
            "refresh_token": creds.refresh_token.get_secret_value(),
        },
        headers={"Accept": "application/json"},
    )
    if response.status_code in (400, 401):
        raise lms_error("lms.invalid_credentials")
    if response.status_code >= 300:
        raise lms_error("lms.unreachable", upstream_status=response.status_code)
    data = _json(response)
    if not data.get("access_token"):
        raise lms_error("lms.invalid_credentials")
    rotated = data.get("refresh_token")
    return creds.model_copy(
        update={
            "access_token": SecretStr(str(data["access_token"])),
            "refresh_token": SecretStr(str(rotated)) if rotated else creds.refresh_token,
            "expires_at": _expiry(data, now),
        }
    )


async def _delete_token(io: Io, cfg: CanvasConfig, creds: CanvasCredentials) -> httpx.Response:
    return await _send(
        io,
        "DELETE",
        f"{cfg.base_url}/login/oauth2/token",
        headers={"Authorization": f"Bearer {creds.access_token.get_secret_value()}"},
    )


async def revoke(io: Io, cfg: CanvasConfig, creds: CanvasCredentials, now: datetime) -> None:
    """Ends the sign-in on Canvas (it leaves Approved integrations). Only a live access token may,
    so an expired one is renewed first, and once more if Canvas still refuses it. A refresh token
    Canvas no longer accepts means the user already ended the sign-in there."""
    try:
        if stale(creds, now):
            creds = await refresh(io, cfg, creds, now)
        response = await _delete_token(io, cfg, creds)
        if response.status_code == 401:
            creds = await refresh(io, cfg, creds, now)
            response = await _delete_token(io, cfg, creds)
    except AppError as exc:
        if exc.code == "lms.invalid_credentials":
            return
        raise
    if response.status_code >= 300:
        raise lms_error("lms.unreachable", upstream_status=response.status_code)
