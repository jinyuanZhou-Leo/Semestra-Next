"""Canvas school-page sign-in (self-hosting): mobile_verify, code paste, refresh (M09 §2.3)."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import cast

import pytest
import respx
from httpx import Response
from pydantic import SecretStr

from semestra.core.config import Settings
from semestra.core.context import system_ctx
from semestra.core.errors import AppError
from semestra.core.http import safe_client
from semestra.modules.lms import reads, service
from semestra.modules.lms.models import LmsConnection, LmsCourseLink
from semestra.modules.lms.providers import Io
from semestra.modules.lms.providers.canvas import CanvasProvider
from semestra.modules.lms.providers.canvas import sign_in as canvas_sign_in
from semestra.modules.lms.providers.canvas.config import CanvasConfig, CanvasCredentials
from semestra.modules.lms.schemas.dto import FileMeta
from semestra.modules.lms.tests.conftest import CANVAS, TOKEN, Api, canvas_api

MOBILE = "https://sso.canvaslms.com/api/v1/mobile_verify.json"
CLIENT_ID = "10000000000001"
CLIENT_SECRET = "mobile-secret"
NOW = datetime(2026, 11, 2, 12, 0, tzinfo=UTC)


@pytest.fixture
async def io(settings: Settings):
    async with safe_client(settings) as client:
        yield Io(client=client, settings=settings)


def _mobile_ok(mock: respx.MockRouter) -> None:
    mock.get(MOBILE).mock(
        return_value=Response(
            200,
            json={
                "authorized": True,
                "client_id": CLIENT_ID,
                "client_secret": CLIENT_SECRET,
                "base_url": CANVAS,
            },
        )
    )


def test_code_from_url_or_raw():
    assert (
        canvas_sign_in.code_from("https://sso.canvaslms.com/canvas/login?code=abc.DEF-123")
        == "abc.DEF-123"
    )
    assert canvas_sign_in.code_from("abc.DEF-123") == "abc.DEF-123"
    with pytest.raises(AppError) as exc:
        canvas_sign_in.code_from("https://sso.canvaslms.com/canvas/login?error=access_denied")
    assert exc.value.code == "lms.sign_in_failed"
    assert exc.value.params["reason"] == "denied"
    with pytest.raises(AppError) as exc:
        canvas_sign_in.code_from("https://sso.canvaslms.com/canvas/login")
    assert exc.value.params["reason"] == "no_code"


def test_authorize_url_shape():
    url = canvas_sign_in.authorize_url(CanvasConfig(base_url=CANVAS), CLIENT_ID)
    assert url.startswith(f"{CANVAS}/login/oauth2/auth?")
    assert "client_id=10000000000001" in url
    assert "mobile=1" in url
    assert "purpose=Semestra" in url
    assert "redirect_uri=https%3A%2F%2Fsso.canvaslms.com%2Fcanvas%2Flogin" in url


async def test_mobile_client_unavailable(io: Io, mock: respx.MockRouter):
    mock.get(MOBILE).mock(return_value=Response(200, json={"authorized": False}))
    with pytest.raises(AppError) as exc:
        await canvas_sign_in.mobile_client(io, CanvasConfig(base_url=CANVAS))
    assert exc.value.code == "lms.sign_in_unavailable"


async def test_exchange_and_refresh(io: Io, mock: respx.MockRouter, settings: Settings):
    _mobile_ok(mock)
    mock.post(f"{CANVAS}/login/oauth2/token").mock(
        side_effect=[
            Response(
                200,
                json={
                    "access_token": "access-1",
                    "refresh_token": "refresh-1",
                    "expires_in": 3600,
                    "token_type": "Bearer",
                },
            ),
            Response(
                200,
                json={"access_token": "access-2", "expires_in": 3600, "token_type": "Bearer"},
            ),
            Response(401, json={"error": "invalid_grant"}),
        ]
    )
    cfg = CanvasConfig(base_url=CANVAS)
    creds = await canvas_sign_in.exchange(
        io, cfg, "https://sso.canvaslms.com/canvas/login?code=the-code", NOW
    )
    assert creds.access_token.get_secret_value() == "access-1"
    assert creds.refresh_token is not None
    assert creds.refresh_token.get_secret_value() == "refresh-1"
    assert creds.client_id == CLIENT_ID
    assert creds.expires_at == NOW + timedelta(seconds=3600)
    assert canvas_sign_in.refreshable(creds)
    assert canvas_sign_in.stale(creds, NOW + timedelta(minutes=56))
    assert not canvas_sign_in.stale(creds, NOW)

    renewed = await canvas_sign_in.refresh(io, cfg, creds, NOW + timedelta(hours=1))
    assert renewed.access_token.get_secret_value() == "access-2"
    assert renewed.refresh_token is not None
    assert renewed.refresh_token.get_secret_value() == "refresh-1"

    with pytest.raises(AppError) as exc:
        await canvas_sign_in.refresh(io, cfg, renewed, NOW + timedelta(hours=2))
    assert exc.value.code == "lms.invalid_credentials"

    p = CanvasProvider()
    assert p.mask_credentials(creds) == {"method": "sign_in"}
    assert p.sign_in_enabled(settings.model_copy(update={"lms_canvas_sign_in": True}))
    assert not p.sign_in_enabled(settings)


async def test_sign_in_start_disabled(api: Api):
    err = await api.call(
        "POST",
        "/lms/connections:sign-in",
        403,
        json={"provider": "canvas", "config": {"base_url": CANVAS}},
    )
    assert err["error"]["code"] == "lms.sign_in_disabled"


async def test_sign_in_flow_end_to_end(
    api: Api, mock: respx.MockRouter, settings: Settings, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(settings, "lms_canvas_sign_in", True)
    _mobile_ok(mock)
    canvas_api(mock)
    mock.post(f"{CANVAS}/login/oauth2/token").mock(
        return_value=Response(
            200,
            json={
                "access_token": TOKEN,
                "refresh_token": "refresh-keep",
                "expires_in": 3600,
                "token_type": "Bearer",
                "user": {"id": 1, "name": "Ada"},
            },
        )
    )
    revoked = mock.delete(f"{CANVAS}/login/oauth2/token").mock(return_value=Response(200, json={}))

    started = await api.call(
        "POST",
        "/lms/connections:sign-in",
        json={"provider": "canvas", "config": {"base_url": CANVAS}},
    )
    assert started["authorize_url"].startswith(f"{CANVAS}/login/oauth2/auth?")

    providers = await api.call("GET", "/lms/providers")
    canvas = next(p for p in providers["items"] if p["kind"] == "canvas")
    assert canvas["sign_in"] is True

    created = await api.call(
        "POST",
        "/lms/connections",
        json={
            "provider": "canvas",
            "config": {"base_url": CANVAS},
            "sign_in": "https://sso.canvaslms.com/canvas/login?code=pasted",
        },
    )
    assert created["credentials_hint"] == {"method": "sign_in"}
    assert created["account_name"]
    assert created["status"] == "connected"

    done = await api.call("DELETE", f"/lms/connections/{created['id']}?detach_all=true")
    assert done["id"] == created["id"]
    assert revoked.called


async def test_create_with_sign_in_when_disabled(api: Api):
    err = await api.call(
        "POST",
        "/lms/connections",
        403,
        json={
            "provider": "canvas",
            "config": {"base_url": CANVAS},
            "sign_in": "https://sso.canvaslms.com/canvas/login?code=x",
        },
    )
    assert err["error"]["code"] == "lms.sign_in_disabled"


async def test_sign_in_needs_https(api: Api, settings: Settings, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "lms_canvas_sign_in", True)
    monkeypatch.setattr(settings, "allow_private_egress", True)
    err = await api.call(
        "POST",
        "/lms/connections:sign-in",
        422,
        json={"provider": "canvas", "config": {"base_url": "http://canvas.example.edu"}},
    )
    assert err["error"]["code"] == "lms.sign_in_https_required"


async def _saved_sign_in(api: Api, app, expires_in: timedelta = timedelta(minutes=1)) -> str:
    """A saved sign-in; by default its access token is about to expire."""
    me = await api.call("GET", "/account/me")
    async with system_ctx(app.state, me["id"]) as ctx:
        p = CanvasProvider()
        cfg = p.normalize_config({"base_url": CANVAS}, ctx.settings)
        row = LmsConnection(
            user_id=me["id"],
            provider="canvas",
            display_name="School",
            config_json=cfg.model_dump(mode="json"),
            credentials_encrypted=service._seal(
                ctx,
                CanvasCredentials(
                    access_token=SecretStr("old-access"),
                    refresh_token=SecretStr("refresh-keep"),
                    client_id=CLIENT_ID,
                    client_secret=SecretStr(CLIENT_SECRET),
                    expires_at=ctx.now + expires_in,
                ),
            ),
            credentials_hint_json={"method": "sign_in"},
            account_name="Ada",
            status="connected",
            last_checked_at=ctx.now,
            created_at=ctx.now,
            updated_at=ctx.now,
        )
        ctx.db.add(row)
        await ctx.db.flush()
        connection_id = row.id
        await ctx.db.commit()
    return connection_id


async def test_revoke_renews_an_expired_token_first(api: Api, app, mock: respx.MockRouter):
    mock.post(f"{CANVAS}/login/oauth2/token").mock(
        return_value=Response(200, json={"access_token": "new-access", "expires_in": 3600})
    )
    revoked = mock.delete(f"{CANVAS}/login/oauth2/token").mock(return_value=Response(200, json={}))
    connection_id = await _saved_sign_in(api, app)

    await api.call("DELETE", f"/lms/connections/{connection_id}?detach_all=true")

    assert revoked.call_count == 1
    assert revoked.calls[0].request.headers["Authorization"] == "Bearer new-access"


async def test_revoke_retries_when_canvas_refuses_the_token(io: Io, mock: respx.MockRouter):
    mock.post(f"{CANVAS}/login/oauth2/token").mock(
        return_value=Response(200, json={"access_token": "new-access", "expires_in": 3600})
    )
    revoked = mock.delete(f"{CANVAS}/login/oauth2/token").mock(
        side_effect=[Response(401), Response(200, json={})]
    )
    creds = CanvasCredentials(
        access_token=SecretStr("old-access"),
        refresh_token=SecretStr("refresh-keep"),
        client_id=CLIENT_ID,
        client_secret=SecretStr(CLIENT_SECRET),
        expires_at=NOW + timedelta(hours=1),
    )

    await canvas_sign_in.revoke(io, CanvasConfig(base_url=CANVAS), creds, NOW)

    assert revoked.calls[-1].request.headers["Authorization"] == "Bearer new-access"


async def test_new_sign_in_revokes_the_old_one(
    api: Api, app, mock: respx.MockRouter, settings: Settings, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(settings, "lms_canvas_sign_in", True)
    _mobile_ok(mock)
    canvas_api(mock)
    mock.post(f"{CANVAS}/login/oauth2/token").mock(
        return_value=Response(
            200, json={"access_token": TOKEN, "refresh_token": "refresh-new", "expires_in": 3600}
        )
    )
    revoked = mock.delete(f"{CANVAS}/login/oauth2/token").mock(return_value=Response(200, json={}))
    connection_id = await _saved_sign_in(api, app)

    await api.call(
        "PATCH",
        f"/lms/connections/{connection_id}",
        json={"sign_in": "https://sso.canvaslms.com/canvas/login?code=again"},
    )

    assert revoked.called


async def test_turning_sign_in_off_stops_renewals(api: Api, app, mock: respx.MockRouter):
    renewal = mock.post(f"{CANVAS}/login/oauth2/token").mock(return_value=Response(400))
    mock.get(f"{CANVAS}/api/v1/users/self/profile").mock(
        return_value=Response(401, headers={"WWW-Authenticate": 'Bearer realm="canvas-lms"'})
    )
    connection_id = await _saved_sign_in(api, app)

    check = await api.call(
        "POST", "/lms/connections:validate", json={"connection_id": connection_id}
    )

    assert check["ok"] is False
    assert check["error_code"] == "lms.invalid_credentials"
    assert not renewal.called


async def test_opening_a_file_renews_a_refused_token(
    api: Api, app, mock: respx.MockRouter, settings: Settings, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(settings, "lms_canvas_sign_in", True)
    mock.post(f"{CANVAS}/login/oauth2/token").mock(
        return_value=Response(200, json={"access_token": "new-access", "expires_in": 3600})
    )
    download = mock.get(f"{CANVAS}/files/1/download").mock(
        side_effect=[
            Response(401, headers={"WWW-Authenticate": 'Bearer realm="canvas-lms"'}),
            Response(200, content=b"hello"),
        ]
    )
    connection_id = await _saved_sign_in(api, app, expires_in=timedelta(hours=1))
    me = await api.call("GET", "/account/me")

    async with system_ctx(app.state, me["id"]) as ctx:
        row = await ctx.db.get_one(LmsConnection, connection_id)
        link = SimpleNamespace(external_course_id="101")
        _, chunks = await reads.open_file(
            ctx,
            "course",
            "1",
            meta=FileMeta(external_id="1", name="a.pdf", download_url=f"{CANVAS}/files/1/download"),
            linked=(cast(LmsCourseLink, link), await service.bound(ctx, row)),
        )
        assert b"".join([chunk async for chunk in chunks]) == b"hello"

    assert download.calls[-1].request.headers["Authorization"] == "Bearer new-access"


async def test_fresh_renews_stale_credentials(
    api: Api, app, mock: respx.MockRouter, settings: Settings, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(settings, "lms_canvas_sign_in", True)
    canvas_api(mock)
    mock.post(f"{CANVAS}/login/oauth2/token").mock(
        return_value=Response(
            200,
            json={"access_token": TOKEN, "expires_in": 3600, "token_type": "Bearer"},
        )
    )
    connection_id = await _saved_sign_in(api, app)

    check = await api.call(
        "POST", "/lms/connections:validate", json={"connection_id": connection_id}
    )
    assert check["ok"] is True
