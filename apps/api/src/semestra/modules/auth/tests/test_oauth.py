"""MCP clients that connect by signing in (M12 §5.3), driven by the MCP SDK's own OAuth client
over the ASGI app: discovery, registration or a metadata document, the consent page's answer,
tokens, refresh and disconnecting."""

import base64
import hashlib
import secrets
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import parse_qs, urlsplit

import httpx2
import pytest
import respx
from fastapi import FastAPI
from httpx import AsyncClient, Response
from mcp import ClientSession
from mcp.client.auth import OAuthClientProvider
from mcp.client.streamable_http import streamable_http_client
from mcp.shared.auth import (
    AuthorizationCodeResult,
    OAuthClientInformationFull,
    OAuthClientMetadata,
    OAuthToken,
)
from pydantic import AnyUrl

from semestra.testing import TEST_ORIGIN, Clock

pytestmark = pytest.mark.usefixtures("signed_in")

MCP_URL = f"{TEST_ORIGIN}/mcp"
DOCUMENT_URL = "https://app.example/oauth/client.json"
REDIRECT = "https://app.example/callback"


@pytest.fixture
async def signed_in(client: AsyncClient, make_user: Any, login_as: Any) -> None:
    await login_as(client, await make_user())


@dataclass
class Storage:
    tokens: OAuthToken | None = None
    client_info: OAuthClientInformationFull | None = None

    async def get_tokens(self) -> OAuthToken | None:
        return self.tokens

    async def set_tokens(self, tokens: OAuthToken) -> None:
        self.tokens = tokens

    async def get_client_info(self) -> OAuthClientInformationFull | None:
        return self.client_info

    async def set_client_info(self, client_info: OAuthClientInformationFull) -> None:
        self.client_info = client_info


@dataclass
class Consent:
    """The browser's part: follows `/authorize` to the consent page and answers there as the
    signed-in user."""

    app: FastAPI
    client: AsyncClient
    scopes: list[str] = field(default_factory=lambda: ["read"])
    seen: list[dict[str, Any]] = field(default_factory=list)
    redirect_url: str = ""

    async def redirect(self, authorization_url: str) -> None:
        async with httpx2.AsyncClient(
            transport=httpx2.ASGITransport(app=self.app), base_url=TEST_ORIGIN
        ) as browser:
            r = await browser.get(authorization_url)
        assert r.status_code == 302, r.text
        consent = urlsplit(r.headers["location"])
        assert (
            f"{consent.scheme}://{consent.netloc}{consent.path}" == "https://web.test/oauth/consent"
        )
        request = parse_qs(consent.query)["request"][0]
        shown = await self.client.get(
            "/account/authorizations/request", params={"request": request}
        )
        assert shown.status_code == 200, shown.text
        self.seen.append(shown.json())
        approved = await self.client.post(
            "/account/authorizations/approve", json={"request": request, "scopes": self.scopes}
        )
        assert approved.status_code == 200, approved.text
        self.redirect_url = approved.json()["redirect_url"]

    async def callback(self) -> AuthorizationCodeResult:
        query = parse_qs(urlsplit(self.redirect_url).query)
        return AuthorizationCodeResult(code=query["code"][0], state=query.get("state", [None])[0])


def _metadata(redirect: str = REDIRECT) -> OAuthClientMetadata:
    return OAuthClientMetadata(
        client_name="Example AI",
        redirect_uris=[AnyUrl(redirect)],
        token_endpoint_auth_method="none",  # noqa: S106
        application_type="web",
    )


Connect = Callable[..., Any]


@pytest.fixture
def connect(app: FastAPI, client: AsyncClient) -> Connect:
    @asynccontextmanager
    async def _connect(
        consent: Consent | None = None,
        storage: Storage | None = None,
        document: str | None = None,
        redirect: str = REDIRECT,
    ) -> AsyncIterator[ClientSession]:
        consent = consent or Consent(app, client)
        auth = OAuthClientProvider(
            MCP_URL,
            _metadata(redirect),
            storage or Storage(),
            redirect_handler=consent.redirect,
            callback_handler=consent.callback,
            client_metadata_url=document,
        )
        async with (
            httpx2.AsyncClient(
                transport=httpx2.ASGITransport(app=app), base_url=TEST_ORIGIN, auth=auth
            ) as http,
            streamable_http_client(MCP_URL, http_client=http) as streams,
            ClientSession(streams[0], streams[1]) as session,
        ):
            await session.initialize()
            yield session

    return _connect


async def _connections(client: AsyncClient) -> list[dict[str, Any]]:
    r = await client.get("/account/tokens")
    assert r.status_code == 200
    return r.json()["items"]


async def test_a_registered_app_signs_in_and_gets_the_chosen_access(
    app: FastAPI, client: AsyncClient, connect: Connect
):
    consent = Consent(app, client, scopes=["read"])
    async with connect(consent) as mcp:
        names = {t.name for t in (await mcp.list_tools()).tools}
    assert "academics__program__list" in names
    assert "academics__program__create" not in names  # read only, as chosen
    assert consent.seen == [
        {
            "client_name": "Example AI",
            "redirect_host": "app.example",
            "local": False,
            "scopes": ["read", "write"],
        }
    ]
    [row] = await _connections(client)
    assert (row["kind"], row["name"], row["scopes"], row["prefix"]) == (
        "oauth",
        "Example AI",
        ["read"],
        None,
    )
    assert row["last_used_at"] is not None  # what "connected" in settings waits for


async def test_disconnecting_ends_access_at_once(
    app: FastAPI, client: AsyncClient, connect: Connect
):
    storage = Storage()
    consent = Consent(app, client, scopes=["read", "write"])
    async with connect(consent, storage) as mcp:
        assert {t.name for t in (await mcp.list_tools()).tools} >= {"academics__program__create"}
    [row] = await _connections(client)
    assert (await client.delete(f"/account/tokens/{row['id']}")).status_code == 200

    assert storage.tokens is not None
    for token in (storage.tokens.access_token, "not-a-token"):
        r = await client.post(
            "/mcp",
            json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 401
    refreshed = await _refresh(client, storage)
    assert refreshed.status_code == 400
    assert refreshed.json()["error"] == "invalid_grant"


async def test_a_metadata_document_identifies_the_app(
    app: FastAPI, client: AsyncClient, connect: Connect
):
    document = {
        "client_id": DOCUMENT_URL,
        "client_name": "Doc App",
        "redirect_uris": ["http://localhost/callback"],
        "token_endpoint_auth_method": "none",
    }
    consent = Consent(app, client)
    with respx.mock(assert_all_mocked=False) as mock:
        fetched = mock.get(DOCUMENT_URL).mock(return_value=Response(200, json=document))
        # A desktop app listens on whatever port is free: loopback redirects match on any port.
        async with connect(
            consent, document=DOCUMENT_URL, redirect="http://localhost:3118/callback"
        ) as mcp:
            await mcp.list_tools()
    assert fetched.called
    assert consent.seen[0]["client_name"] == "Doc App"
    assert consent.seen[0]["local"] is True
    r = await client.get(
        "/authorize",
        params={
            "client_id": DOCUMENT_URL,
            "redirect_uri": "https://elsewhere.example/callback",
            "response_type": "code",
            "code_challenge": "x" * 43,
            "code_challenge_method": "S256",
        },
    )
    assert r.status_code == 400  # not a redirect the document lists: no redirect at all


async def _refresh(client: AsyncClient, storage: Storage) -> Response:
    assert storage.tokens is not None and storage.client_info is not None
    return await client.post(
        "/token",
        data={
            "grant_type": "refresh_token",
            "refresh_token": storage.tokens.refresh_token or "",
            "client_id": storage.client_info.client_id,
        },
    )


async def test_refresh_tokens_rotate_and_a_copied_one_ends_the_connection(
    app: FastAPI, client: AsyncClient, connect: Connect, clock: Clock
):
    storage = Storage()
    async with connect(storage=storage) as mcp:
        await mcp.list_tools()  # a call finishes the handshake before closing
    assert storage.tokens is not None
    first = storage.tokens.refresh_token
    r = await _refresh(client, storage)
    assert r.status_code == 200, r.text
    second = r.json()["refresh_token"]
    assert second != first

    # The app's own retry right after a rotation is refused, not punished.
    storage.tokens = OAuthToken(access_token="x", refresh_token=first)
    assert (await _refresh(client, storage)).status_code == 400
    assert (await _connections(client))[0]["id"]

    clock.advance(minutes=5)
    assert (await _refresh(client, storage)).status_code == 400
    assert await _connections(client) == []  # someone else had a copy
    storage.tokens = OAuthToken(access_token="x", refresh_token=second)
    assert (await _refresh(client, storage)).status_code == 400


async def test_connecting_an_app_again_replaces_its_connection(
    app: FastAPI, client: AsyncClient, connect: Connect
):
    async with connect() as mcp:
        await mcp.list_tools()  # a call finishes the handshake before closing
    async with connect(Consent(app, client, scopes=["read", "write"])) as mcp:
        await mcp.list_tools()  # a call finishes the handshake before closing
    [row] = await _connections(client)
    assert row["scopes"] == ["read", "write"]


def _pkce() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(48)
    digest = hashlib.sha256(verifier.encode()).digest()
    return verifier, base64.urlsafe_b64encode(digest).decode().rstrip("=")


async def _pending(client: AsyncClient, scope: str | None = None) -> tuple[str, str]:
    """Registers an app and starts its sign-in: (client id, consent request)."""
    registered = await client.post(
        "/register", json=_metadata().model_dump(mode="json", exclude_none=True)
    )
    assert registered.status_code == 201, registered.text
    client_id = registered.json()["client_id"]
    _, challenge = _pkce()
    params = {
        "client_id": client_id,
        "redirect_uri": REDIRECT,
        "response_type": "code",
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "state": "s1",
        "resource": MCP_URL,
    }
    if scope:
        params["scope"] = scope
    r = await client.get("/authorize", params=params)
    assert r.status_code == 302, r.text
    return client_id, parse_qs(urlsplit(r.headers["location"]).query)["request"][0]


async def test_consent_rules(client: AsyncClient, clock: Clock):
    _, request = await _pending(client, scope="read offline_access")
    shown = await client.get("/account/authorizations/request", params={"request": request})
    assert shown.json()["scopes"] == ["read"]  # what the app asked for; unknown scopes ignored
    r = await client.post(
        "/account/authorizations/approve", json={"request": request, "scopes": ["read", "write"]}
    )
    assert r.status_code == 422

    denied = await client.post("/account/authorizations/deny", json={"request": request})
    query = parse_qs(urlsplit(denied.json()["redirect_url"]).query)
    assert query == {"error": ["access_denied"], "state": ["s1"]}

    # Handing out a way in needs a recent sign-in, like creating an API token.
    clock.advance(minutes=9)
    _, request = await _pending(client)
    clock.advance(minutes=2)
    r = await client.post(
        "/account/authorizations/approve", json={"request": request, "scopes": ["read"]}
    )
    assert r.json()["error"]["code"] == "auth.reauth_required"

    clock.advance(minutes=10)
    r = await client.get("/account/authorizations/request", params={"request": request})
    assert r.json()["error"]["code"] == "auth.authorization_expired"


async def test_metadata_points_apps_at_signing_in(client: AsyncClient):
    r = await client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    assert r.status_code == 401
    assert r.headers["www-authenticate"] == (
        f'Bearer resource_metadata="{TEST_ORIGIN}/.well-known/oauth-protected-resource/mcp", '
        'scope="read write"'
    )
    resource = (await client.get("/.well-known/oauth-protected-resource/mcp")).json()
    assert resource["resource"] == MCP_URL
    assert resource["authorization_servers"] == [TEST_ORIGIN]
    server = (await client.get("/.well-known/oauth-authorization-server")).json()
    assert server["issuer"] == TEST_ORIGIN
    assert server["client_id_metadata_document_supported"] is True
    assert "none" in server["token_endpoint_auth_methods_supported"]
    assert server["code_challenge_methods_supported"] == ["S256"]


async def test_only_tokens_issued_for_this_server_are_accepted(
    app: FastAPI, client: AsyncClient, connect: Connect
):
    import jwt

    storage = Storage()
    async with connect(storage=storage) as mcp:
        await mcp.list_tools()  # a call finishes the handshake before closing
    assert storage.tokens is not None
    claims = jwt.decode(storage.tokens.access_token, options={"verify_signature": False})
    elsewhere = jwt.encode(
        {**claims, "aud": "https://other.example/mcp"},
        app.state.settings.secret_key,
        algorithm="HS256",
    )
    r = await client.post(
        "/mcp",
        json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
        headers={"Authorization": f"Bearer {elsewhere}"},
    )
    assert r.status_code == 401
