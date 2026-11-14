"""The storage behind the MCP SDK's OAuth server (M12 §5.3). The SDK's handlers check the
protocol (client, redirect URI, PKCE, grant types); this module decides who the clients are,
keeps codes and refresh tokens, and turns a redeemed code into a connection: a row beside the
user's pasted tokens, limited, listed and revoked the same way.

Clients are known two ways: by a Client ID Metadata Document, an https `client_id` whose JSON
we fetch (ChatGPT and Claude prefer this), or by registering (RFC 7591), stored in
`auth_oauth_clients`."""

import json
import time
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import urlsplit

import structlog
from cachetools import TTLCache
from mcp.server.auth.provider import (
    AccessToken,
    AuthorizationCode,
    AuthorizationParams,
    AuthorizeError,
    IdentityAssertionParams,
    RefreshToken,
    RegistrationError,
    TokenError,
)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from pydantic import AnyUrl, ValidationError
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.datastructures import State

from semestra.core.config import Settings
from semestra.core.http import safe_client
from semestra.modules.auth import crypto
from semestra.modules.auth.models import AuthOAuthClient, AuthOAuthGrant, AuthPersonalAccessToken
from semestra.modules.auth.oauth import common

log = structlog.get_logger()

REFRESH_PREFIX = "sort_"
# A refresh token rotated out this long ago and presented again was copied, not raced.
REUSE_GRACE = timedelta(minutes=1)
# Client ID Metadata Documents: small, fetched quickly, kept as the server says (within bounds).
CIMD_MAX_BYTES = 5_000
CIMD_TIMEOUT = 5.0
CIMD_TTL = (300, 86_400)  # seconds: least and most
CIMD_FAILED_TTL = 60


def _scopes() -> str:
    return " ".join(common.SCOPES)


def _redirect_allowed(uri: str) -> bool:
    """https anywhere, or plain http back to this computer (a desktop app's loopback listener)."""
    parts = urlsplit(uri)
    if parts.fragment:
        return False
    return parts.scheme == "https" or (parts.scheme == "http" and common.is_loopback(uri))


class Client(OAuthClientInformationFull):
    """An MCP client as the SDK's handlers see it, with two rules of our own."""

    def validate_redirect_uri(self, redirect_uri: AnyUrl | None) -> AnyUrl:
        # RFC 8252 §7.3: a loopback redirect matches whatever port the app listens on today.
        if redirect_uri is not None and common.is_loopback(str(redirect_uri)):
            asked = urlsplit(str(redirect_uri))
            for registered in self.redirect_uris or []:
                known = urlsplit(str(registered))
                if (known.scheme, known.hostname, known.path) == (
                    asked.scheme,
                    asked.hostname,
                    asked.path,
                ):
                    return redirect_uri
        return super().validate_redirect_uri(redirect_uri)

    def validate_scope(self, requested_scope: str | None) -> list[str] | None:
        # Apps add scopes of their own (`offline_access`, `openid`); ours are kept, the rest
        # ignored rather than refused. The user picks the access on the consent page anyway.
        if requested_scope is None:
            return None
        return [s for s in requested_scope.split() if s in common.SCOPES] or None


def _max_age(cache_control: str | None) -> int:
    for part in (cache_control or "").split(","):
        name, _, value = part.strip().partition("=")
        if name.lower() == "max-age" and value.isdigit():
            return min(max(int(value), CIMD_TTL[0]), CIMD_TTL[1])
    return 3600


def _client_from_document(url: str, doc: Any) -> Client | None:
    """A Client ID Metadata Document's client, if the document is one: it names itself by
    exactly the URL it was fetched from, and redirects only where we allow."""
    if not isinstance(doc, dict) or doc.get("client_id") != url:
        return None
    redirects = doc.get("redirect_uris")
    if not isinstance(redirects, list) or not redirects:
        return None
    if not all(isinstance(r, str) and _redirect_allowed(r) for r in redirects):
        return None
    # A public client: we hold no key to check a signed assertion with.
    methods = doc.get("token_endpoint_auth_methods_supported") or [
        doc.get("token_endpoint_auth_method") or "none"
    ]
    if "none" not in methods:
        return None
    name = doc.get("client_name")
    try:
        return Client(
            client_id=url,
            client_name=name if isinstance(name, str) and name.strip() else urlsplit(url).hostname,
            redirect_uris=redirects,
            token_endpoint_auth_method="none",  # noqa: S106  (a method, not a secret)
            grant_types=["authorization_code", "refresh_token"],
            response_types=["code"],
            scope=_scopes(),
        )
    except ValidationError:
        return None


class Provider:
    """`OAuthAuthorizationServerProvider` for Semestra. Each call opens its own database session:
    the SDK's handlers run outside the request context the capabilities use."""

    def __init__(self, state: State) -> None:
        self.state = state
        self._documents = TTLCache[str, tuple[float, Client | None]](maxsize=256, ttl=CIMD_TTL[1])

    @property
    def settings(self) -> Settings:
        return self.state.settings

    def _now(self) -> datetime:
        return self.state.now()

    def _db(self) -> AsyncSession:
        return self.state.session_factory()

    # --- clients --------------------------------------------------------------------------

    async def get_client(self, client_id: str) -> Client | None:
        if client_id.startswith("https://"):
            return await self._document_client(client_id)
        async with self._db() as db:
            row = await db.get(AuthOAuthClient, client_id)
        return Client.model_validate(row.info) if row is not None else None

    async def _document_client(self, url: str) -> Client | None:
        parts = urlsplit(url)
        if parts.path in ("", "/") or parts.fragment or parts.username or parts.password:
            return None
        cached = self._documents.get(url)
        if cached is not None and cached[0] > time.monotonic():
            return cached[1]
        client, ttl = await self._fetch_document(url)
        self._documents[url] = (time.monotonic() + ttl, client)
        return client

    async def _fetch_document(self, url: str) -> tuple[Client | None, int]:
        try:
            async with (
                safe_client(self.settings, timeout=CIMD_TIMEOUT) as http,
                http.stream("GET", url, headers={"Accept": "application/json"}) as response,
            ):
                if response.status_code != 200:
                    return None, CIMD_FAILED_TTL
                body = b""
                async for chunk in response.aiter_bytes():
                    body += chunk
                    if len(body) > CIMD_MAX_BYTES:
                        return None, CIMD_FAILED_TTL
                ttl = _max_age(response.headers.get("cache-control"))
            client = _client_from_document(url, json.loads(body))
        except Exception:
            log.warning("oauth_client_document_failed", url=url, exc_info=True)
            return None, CIMD_FAILED_TTL
        return client, ttl if client is not None else CIMD_FAILED_TTL

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        uris = [str(u) for u in client_info.redirect_uris or []]
        if not uris or not all(_redirect_allowed(u) for u in uris):
            raise RegistrationError(
                "invalid_redirect_uri", "redirect URIs must be https or http://localhost"
            )
        async with self._db() as db:
            db.add(
                AuthOAuthClient(
                    id=client_info.client_id,
                    info=client_info.model_dump(mode="json", exclude_none=True),
                    created_at=self._now(),
                )
            )
            await db.commit()

    # --- authorization --------------------------------------------------------------------

    async def authorize(
        self, client: OAuthClientInformationFull, params: AuthorizationParams
    ) -> str:
        if not common.accepts_resource(self.settings, params.resource):
            raise AuthorizeError("invalid_target", "this server only issues tokens for its /mcp")
        redirect = str(params.redirect_uri)
        request = common.PendingRequest(
            client_id=client.client_id,
            client_name=(client.client_name or "").strip() or common.host_of(redirect),
            redirect_uri=redirect,
            redirect_uri_explicit=params.redirect_uri_provided_explicitly,
            scopes=common.canonical_scopes(params.scopes) if params.scopes else [],
            code_challenge=params.code_challenge,
            state=params.state,
            resource=common.resource(self.settings),
        )
        token = common.sign_request(self.settings, request, self._now())
        origin = self.settings.public_web_origin.rstrip("/")
        return common.redirect_with(f"{origin}{common.CONSENT_PATH}", request=token)

    async def load_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: str
    ) -> AuthorizationCode | None:
        async with self._db() as db:
            grant = await db.scalar(
                select(AuthOAuthGrant).where(
                    AuthOAuthGrant.code_hash == crypto.hash_token(authorization_code)
                )
            )
        if (
            grant is None
            or grant.client_id != client.client_id
            or grant.code_expires_at is None
            or grant.code_expires_at <= self._now()
            or grant.code_challenge is None
        ):
            return None
        return AuthorizationCode(
            code=authorization_code,
            scopes=list(grant.scopes),
            # Checked above against our clock, which tests control; the SDK compares wall time.
            expires_at=float("inf"),
            client_id=grant.client_id,
            code_challenge=grant.code_challenge,
            redirect_uri=AnyUrl(grant.redirect_uri),
            redirect_uri_provided_explicitly=grant.redirect_uri_explicit,
            resource=grant.resource,
            subject=grant.user_id,
        )

    async def exchange_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: AuthorizationCode
    ) -> OAuthToken:
        now = self._now()
        async with self._db() as db:
            # Claimed in one statement, so a code is redeemed once even when sent twice at once.
            grant_id = await db.scalar(
                update(AuthOAuthGrant)
                .where(
                    AuthOAuthGrant.code_hash == crypto.hash_token(authorization_code.code),
                    AuthOAuthGrant.code_expires_at > now,
                )
                .values(code_hash=None, code_challenge=None, code_expires_at=None)
                .returning(AuthOAuthGrant.id)
            )
            grant = await db.get(AuthOAuthGrant, grant_id) if grant_id else None
            if grant is None:
                raise TokenError("invalid_grant", "authorization code does not exist")
            await self._replace_earlier(db, grant, now)
            row = AuthPersonalAccessToken(
                user_id=grant.user_id,
                kind="oauth",
                name=grant.client_name,
                scopes=list(grant.scopes),
                created_at=now,
            )
            db.add(row)
            await db.flush()
            refresh = crypto.new_token(REFRESH_PREFIX)
            grant.token_id = row.id
            grant.refresh_token_hash = crypto.hash_token(refresh)
            grant.refreshed_at = now
            token = self._tokens(grant, row.id, list(grant.scopes), refresh, now)
            await db.commit()
        return token

    async def _replace_earlier(
        self, db: AsyncSession, grant: AuthOAuthGrant, now: datetime
    ) -> None:
        """Connecting an app again replaces its earlier connection, so the list has one row per
        app. Apps that register anew each time get a new client id, so this goes by name."""
        earlier = select(AuthOAuthGrant.token_id).where(
            AuthOAuthGrant.user_id == grant.user_id,
            AuthOAuthGrant.client_name == grant.client_name,
            AuthOAuthGrant.token_id.is_not(None),
        )
        await db.execute(
            update(AuthPersonalAccessToken)
            .where(
                AuthPersonalAccessToken.id.in_(earlier),
                AuthPersonalAccessToken.revoked_at.is_(None),
            )
            .values(revoked_at=now)
            .execution_options(synchronize_session=False)
        )

    def _tokens(
        self, grant: AuthOAuthGrant, token_id: str, scopes: list[str], refresh: str, now: datetime
    ) -> OAuthToken:
        access = common.issue_access_token(
            self.settings,
            user_id=grant.user_id,
            token_id=token_id,
            client_id=grant.client_id,
            scopes=scopes,
            now=now,
        )
        return OAuthToken(
            access_token=access,
            token_type="Bearer",  # noqa: S106
            expires_in=int(common.ACCESS_TTL.total_seconds()),
            scope=" ".join(scopes),
            refresh_token=refresh,
        )

    # --- refresh --------------------------------------------------------------------------

    async def load_refresh_token(
        self, client: OAuthClientInformationFull, refresh_token: str
    ) -> RefreshToken | None:
        digest = crypto.hash_token(refresh_token)
        now = self._now()
        async with self._db() as db:
            grant = await db.scalar(
                select(AuthOAuthGrant).where(AuthOAuthGrant.refresh_token_hash == digest)
            )
            if grant is None:
                await self._check_reuse(db, digest, now)
                return None
            row = await db.get(AuthPersonalAccessToken, grant.token_id) if grant.token_id else None
        if (
            row is None
            or row.revoked_at is not None
            or grant.client_id != client.client_id
            or grant.refreshed_at is None
            or now - grant.refreshed_at > common.REFRESH_IDLE
        ):
            return None
        return RefreshToken(
            token=refresh_token,
            client_id=grant.client_id,
            scopes=list(row.scopes),
            resource=grant.resource,
            subject=grant.user_id,
        )

    async def _check_reuse(self, db: AsyncSession, digest: str, now: datetime) -> None:
        """A refresh token already rotated out, presented again after the grace an app's own
        retry needs, was copied: the connection ends."""
        grant = await db.scalar(
            select(AuthOAuthGrant).where(AuthOAuthGrant.previous_refresh_token_hash == digest)
        )
        if grant is None or grant.token_id is None or grant.refreshed_at is None:
            return
        if now - grant.refreshed_at <= REUSE_GRACE:
            return
        await db.execute(
            update(AuthPersonalAccessToken)
            .where(
                AuthPersonalAccessToken.id == grant.token_id,
                AuthPersonalAccessToken.revoked_at.is_(None),
            )
            .values(revoked_at=now)
        )
        await db.commit()
        log.warning("oauth_refresh_token_reused", grant_id=grant.id)

    async def exchange_refresh_token(
        self, client: OAuthClientInformationFull, refresh_token: RefreshToken, scopes: list[str]
    ) -> OAuthToken:
        now = self._now()
        old = crypto.hash_token(refresh_token.token)
        new = crypto.new_token(REFRESH_PREFIX)
        async with self._db() as db:
            grant_id = await db.scalar(
                update(AuthOAuthGrant)
                .where(AuthOAuthGrant.refresh_token_hash == old)
                .values(
                    refresh_token_hash=crypto.hash_token(new),
                    previous_refresh_token_hash=old,
                    refreshed_at=now,
                )
                .returning(AuthOAuthGrant.id)
            )
            grant = await db.get(AuthOAuthGrant, grant_id) if grant_id else None
            if grant is None or grant.token_id is None:
                raise TokenError("invalid_grant", "refresh token does not exist")
            token = self._tokens(grant, grant.token_id, scopes, new, now)
            await db.commit()
        return token

    async def exchange_identity_assertion(
        self, client: OAuthClientInformationFull, params: IdentityAssertionParams
    ) -> OAuthToken:
        raise TokenError("unsupported_grant_type", "enterprise identity assertions are not used")

    # --- access tokens and revocation -----------------------------------------------------

    async def load_access_token(self, token: str) -> AccessToken | None:
        claims = common.read_access_token(self.settings, token, self._now())
        if claims is None:
            return None
        return AccessToken(
            token=token,
            client_id=claims.client_id,
            scopes=claims.scopes,
            expires_at=claims.expires_at,
            resource=common.resource(self.settings),
            subject=claims.user_id,
            claims={"tid": claims.token_id},
        )

    async def revoke_token(self, token: AccessToken | RefreshToken) -> None:
        async with self._db() as db:
            if isinstance(token, AccessToken):
                token_id = (token.claims or {}).get("tid")
            else:
                token_id = await db.scalar(
                    select(AuthOAuthGrant.token_id).where(
                        AuthOAuthGrant.refresh_token_hash == crypto.hash_token(token.token)
                    )
                )
            if not token_id:
                return
            await db.execute(
                update(AuthPersonalAccessToken)
                .where(
                    AuthPersonalAccessToken.id == token_id,
                    AuthPersonalAccessToken.kind == "oauth",
                    AuthPersonalAccessToken.revoked_at.is_(None),
                )
                .values(revoked_at=self._now())
            )
            await db.commit()
