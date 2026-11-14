"""What the OAuth server and the rest of the app share (M12 §5.3): its addresses, who a client
is, the signed pending request the consent page shows, and the access tokens `/mcp` accepts.
Pure functions apart from the access-token lookup; no MCP SDK import, so the consent
capabilities load without it."""

import hashlib
import hmac
import ipaddress
from collections.abc import Sequence
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import urlencode, urlsplit

import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from semestra.core.config import Settings
from semestra.core.context import Identity
from semestra.modules.auth import crypto
from semestra.modules.auth.identity import connection_identity
from semestra.modules.auth.models import AuthOAuthGrant, AuthPersonalAccessToken
from semestra.modules.auth.schemas import KnownApp, TokenScope

SCOPES = ("read", "write")
REQUEST_TTL = timedelta(minutes=10)
CODE_TTL = timedelta(minutes=1)
ACCESS_TTL = timedelta(hours=1)
# A connection nobody refreshed for this long is over; the app has to sign in again.
REFRESH_IDLE = timedelta(days=90)
CONSENT_PATH = "/oauth/consent"

ACCESS_PREFIX = "soat_"
# Sites whose metadata documents identify an app: only that site can serve a document under
# its own address, so a client id there is the app itself, not a name it gave itself.
KNOWN_APPS: dict[str, KnownApp] = {"chatgpt.com": "chatgpt", "claude.ai": "claude"}
APP_NAMES: dict[KnownApp, str] = {"chatgpt": "ChatGPT", "claude": "Claude"}

_REQUEST = "oauth_request"

# The address an OAuth request came from, for limits deep in the SDK's handlers (set by
# `semestra.modules.auth.oauth.LazyRoutes`).
request_ip: ContextVar[str] = ContextVar("oauth_request_ip", default="unknown")


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


def known_app(client_id: str, redirect_uri: str) -> KnownApp | None:
    """The app a client is, when its id is a metadata document on that app's site and the codes
    go back there; none for registered clients, whose names are only what they say, and none for
    a redirect to this computer: any program here can use a public client id with it (and the
    same site serves other apps' documents, such as Claude Code's)."""
    parts = urlsplit(client_id)
    if parts.scheme != "https" or is_loopback(redirect_uri):
        return None
    host = parts.hostname or ""
    for site, app in KNOWN_APPS.items():
        if host == site or host.endswith(f".{site}"):
            return app
    return None


def client_host(client_id: str, redirect_uri: str) -> str:
    """Who a client is, as far as can be checked: the site its metadata document is on (its
    redirects must be on that site too), or else where it sends the browser back to."""
    if client_id.startswith("https://"):
        return host_of(client_id)
    return host_of(redirect_uri)


def connection_name(client_id: str, client_name: str, redirect_uri: str) -> str:
    """What a connection is listed and recorded as: a known app by its own name; an app on this
    computer by the name it gave; any other by that name and its site, since the name alone
    could be anyone's."""
    app = known_app(client_id, redirect_uri)
    if app is not None:
        return APP_NAMES[app]
    host = client_host(client_id, redirect_uri)
    if is_loopback(redirect_uri) or client_name == host:
        return client_name
    return f"{client_name} ({host})"


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
    return jwt.encode(claims, _request_key(settings), algorithm="HS256")


def _request_key(settings: Settings) -> bytes:
    """A key of its own for pending requests, so nothing else signed with the secret key reads
    as one."""
    return hmac.new(settings.secret_key.encode(), b"oauth-request", hashlib.sha256).digest()


def read_request(
    settings: Settings, token: str, now: datetime, *, allow_expired: bool = False
) -> PendingRequest | None:
    try:
        claims = jwt.decode(
            token, _request_key(settings), algorithms=["HS256"], options={"verify_exp": False}
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


async def authenticate_access_token(db: AsyncSession, token: str, now: datetime) -> Identity | None:
    """`/mcp`'s check for an access token an app got by signing in: random like a pasted token,
    found by its hash, current, and its connection still live (disconnecting in settings takes
    effect at once, not when the token expires)."""
    grant = await db.scalar(
        select(AuthOAuthGrant).where(AuthOAuthGrant.access_token_hash == crypto.hash_token(token))
    )
    if (
        grant is None
        or grant.token_id is None
        or grant.access_expires_at is None
        or grant.access_expires_at <= now
    ):
        return None
    row = await db.get(AuthPersonalAccessToken, grant.token_id)
    if row is None or row.kind != "oauth":
        return None
    return await connection_identity(db, row, now)
