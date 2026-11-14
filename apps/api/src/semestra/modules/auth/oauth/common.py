"""What the OAuth server and the rest of the app share (M12 §5.3): its addresses, and the two
signed things it hands out, the pending request the consent page shows and the access token
`/mcp` accepts. Pure functions apart from the access-token lookup; no MCP SDK import, so the
consent capabilities load without it."""

import ipaddress
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import urlencode, urlsplit

import jwt
from sqlalchemy.ext.asyncio import AsyncSession

from semestra.core.config import Settings
from semestra.core.context import Identity
from semestra.modules.auth.identity import connection_identity
from semestra.modules.auth.models import AuthPersonalAccessToken
from semestra.modules.auth.schemas import TokenScope

SCOPES = ("read", "write")
REQUEST_TTL = timedelta(minutes=10)
CODE_TTL = timedelta(minutes=1)
ACCESS_TTL = timedelta(hours=1)
# A connection nobody refreshed for this long is over; the app has to sign in again.
REFRESH_IDLE = timedelta(days=90)
CONSENT_PATH = "/oauth/consent"

_REQUEST = "oauth_request"
_ACCESS = "mcp_access"


def issuer(settings: Settings) -> str:
    return settings.public_api_origin.rstrip("/")


def available(settings: Settings) -> bool:
    """OAuth needs https (RFC 8414), except on this computer: a self-hosted server on a plain
    http LAN address keeps to pasted tokens."""
    parts = urlsplit(issuer(settings))
    return parts.scheme == "https" or parts.hostname in ("localhost", "127.0.0.1", "::1")


def resource(settings: Settings) -> str:
    """The MCP server's canonical URL: what users paste into their app, and every token's
    audience."""
    return f"{issuer(settings)}/mcp"


def resource_metadata_url(settings: Settings) -> str:
    return f"{issuer(settings)}/.well-known/oauth-protected-resource/mcp"


def accepts_resource(settings: Settings, value: str | None) -> bool:
    """Apps name the MCP URL or, some of them, just its origin (RFC 8707 leaves this open)."""
    return value is None or value.rstrip("/") in (resource(settings), issuer(settings))


def canonical_scopes(scopes: Sequence[str]) -> list[TokenScope]:
    """`write` implies `read`, as for pasted tokens."""
    return ["read", "write"] if "write" in scopes else ["read"]


def host_of(uri: str) -> str:
    return urlsplit(uri).hostname or ""


def is_loopback(uri: str) -> bool:
    host = urlsplit(uri).hostname or ""
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def redirect_with(uri: str, **params: str | None) -> str:
    """`uri` with `params` added to its query, keeping the query it already has."""
    parts = urlsplit(uri)
    extra = urlencode({k: v for k, v in params.items() if v is not None})
    query = f"{parts.query}&{extra}" if parts.query else extra
    return parts._replace(query=query).geturl()


# --- the pending request --------------------------------------------------------------------


@dataclass(frozen=True)
class PendingRequest:
    """An authorization request the SDK checked (client, redirect URI, PKCE), waiting for the
    user's answer on the consent page."""

    client_id: str
    client_name: str
    redirect_uri: str
    redirect_uri_explicit: bool
    scopes: list[TokenScope]  # what the app asked for; empty: it did not say
    code_challenge: str
    state: str | None
    resource: str


def sign_request(settings: Settings, req: PendingRequest, now: datetime) -> str:
    claims: dict[str, Any] = {
        "typ": _REQUEST,
        "cid": req.client_id,
        "cname": req.client_name,
        "ruri": req.redirect_uri,
        "rexp": req.redirect_uri_explicit,
        "scope": " ".join(req.scopes),
        "cc": req.code_challenge,
        "st": req.state,
        "res": req.resource,
        "exp": int((now + REQUEST_TTL).timestamp()),
    }
    return jwt.encode(claims, settings.secret_key, algorithm="HS256")


def read_request(
    settings: Settings, token: str, now: datetime, *, allow_expired: bool = False
) -> PendingRequest | None:
    try:
        claims = jwt.decode(
            token, settings.secret_key, algorithms=["HS256"], options={"verify_exp": False}
        )
    except jwt.PyJWTError:
        return None
    if claims.get("typ") != _REQUEST:
        return None
    if not allow_expired and int(claims.get("exp", 0)) <= int(now.timestamp()):
        return None
    return PendingRequest(
        client_id=str(claims["cid"]),
        client_name=str(claims["cname"]),
        redirect_uri=str(claims["ruri"]),
        redirect_uri_explicit=bool(claims["rexp"]),
        scopes=[s for s in ("read", "write") if s in str(claims["scope"]).split()],
        code_challenge=str(claims["cc"]),
        state=claims.get("st"),
        resource=str(claims["res"]),
    )


# --- access tokens --------------------------------------------------------------------------


@dataclass(frozen=True)
class AccessClaims:
    user_id: str
    token_id: str
    client_id: str
    scopes: list[str]
    expires_at: int


def issue_access_token(
    settings: Settings,
    *,
    user_id: str,
    token_id: str,
    client_id: str,
    scopes: list[str],
    now: datetime,
) -> str:
    claims = {
        "typ": _ACCESS,
        "iss": issuer(settings),
        "aud": resource(settings),
        "sub": user_id,
        "tid": token_id,
        "client_id": client_id,
        "scope": " ".join(scopes),
        "iat": int(now.timestamp()),
        "exp": int((now + ACCESS_TTL).timestamp()),
    }
    return jwt.encode(claims, settings.secret_key, algorithm="HS256")


def read_access_token(settings: Settings, token: str, now: datetime) -> AccessClaims | None:
    """The claims of an access token issued for this server's `/mcp`, if it has not expired."""
    try:
        claims = jwt.decode(
            token,
            settings.secret_key,
            algorithms=["HS256"],
            audience=resource(settings),
            issuer=issuer(settings),
            options={"verify_exp": False, "require": ["sub", "tid", "exp", "aud", "iss"]},
        )
    except jwt.PyJWTError:
        return None
    if claims.get("typ") != _ACCESS or int(claims["exp"]) <= int(now.timestamp()):
        return None
    return AccessClaims(
        user_id=str(claims["sub"]),
        token_id=str(claims["tid"]),
        client_id=str(claims.get("client_id", "")),
        scopes=str(claims.get("scope", "")).split(),
        expires_at=int(claims["exp"]),
    )


async def authenticate_access_token(
    db: AsyncSession, settings: Settings, token: str, now: datetime
) -> Identity | None:
    """`/mcp`'s check for an OAuth access token: valid, for this server, and its connection still
    live (disconnecting in settings takes effect at once, not when the token expires)."""
    claims = read_access_token(settings, token, now)
    if claims is None:
        return None
    row = await db.get(AuthPersonalAccessToken, claims.token_id)
    if row is None or row.kind != "oauth" or row.user_id != claims.user_id:
        return None
    return await connection_identity(db, row, now)
