"""CSRF, native tokens, PATs, sessions and account management (M01 §3, §5, §10)."""

import asyncio
from collections.abc import Awaitable, Callable

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic import BaseModel, Field

from semestra.core.capability import Http, capability, registry
from semestra.core.context import Ctx
from semestra.modules.auth.mailer import MemoryMailer
from semestra.testing import Clock, MakeUser, UserHandle, last_code

PASSWORD = "correct horse battery"
LoginAs = Callable[[AsyncClient, UserHandle], Awaitable[str]]
BearerFor = Callable[[UserHandle], Awaitable[dict[str, str]]]


class _Echo(BaseModel):
    text: str = Field(description="Anything")


class _NoArgs(BaseModel):
    pass


@capability(
    name="test.echo.write",
    summary="Test-only write capability.",
    description="Exists so PAT scope enforcement can be tested.",
    effect="write",
    http=Http("POST", "/test/echo"),
)
async def _echo_write(ctx: Ctx, inp: _Echo) -> _Echo:
    return inp


@capability(
    name="test.echo.read",
    summary="Test-only read capability.",
    description="Exists so PAT scope enforcement can be tested.",
    effect="read",
    http=Http("GET", "/test/echo"),
)
async def _echo_read(ctx: Ctx, inp: _Echo) -> _Echo:
    return inp


async def second_device(app: FastAPI, login_as: LoginAs, user: UserHandle) -> AsyncClient:
    c = AsyncClient(transport=ASGITransport(app), base_url="https://test")
    await login_as(c, user)
    return c


# --- identity resolution ----------------------------------------------------------------------


async def test_unauthenticated_requests_get_the_error_envelope(client: AsyncClient) -> None:
    r = await client.get("/account/me")
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "common.unauthenticated"


async def test_cookie_writes_require_the_csrf_header(
    client: AsyncClient, make_user: MakeUser, login_as: LoginAs
) -> None:
    user = await make_user()
    await login_as(client, user)
    good = dict(client.headers)
    del client.headers["x-semestra-csrf"]

    r = await client.patch("/account/profile", json={"display_name": "New"})
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "auth.csrf_failed"

    client.headers["x-semestra-csrf"] = "forged"
    assert (await client.patch("/account/profile", json={"display_name": "New"})).status_code == 403

    client.headers.update(good)
    assert (await client.patch("/account/profile", json={"display_name": "New"})).status_code == 200


async def test_reads_do_not_need_csrf_and_bearer_is_exempt(
    client: AsyncClient, make_user: MakeUser, login_as: LoginAs, bearer_for: BearerFor, app: FastAPI
) -> None:
    user = await make_user()
    await login_as(client, user)
    del client.headers["x-semestra-csrf"]
    assert (await client.get("/account/me")).status_code == 200

    async with AsyncClient(transport=ASGITransport(app), base_url="https://test") as native:
        r = await native.patch(
            "/account/profile", json={"display_name": "Via bearer"}, headers=await bearer_for(user)
        )
        assert r.status_code == 200
        assert r.json()["display_name"] == "Via bearer"


async def test_bearer_wins_over_cookie_and_bad_bearer_does_not_fall_back(
    client: AsyncClient, make_user: MakeUser, login_as: LoginAs
) -> None:
    user = await make_user()
    await login_as(client, user)
    r = await client.get("/account/me", headers={"Authorization": "Bearer not-a-token"})
    assert r.status_code == 401


async def test_session_cookie_slides_once_a_day(
    client: AsyncClient, make_user: MakeUser, login_as: LoginAs, clock: Clock
) -> None:
    user = await make_user()
    await login_as(client, user)
    r = await client.get("/account/me")
    assert "set-cookie" not in r.headers  # fresh session: nothing to renew

    clock.advance(days=2)
    r = await client.get("/account/me")
    assert any(c.startswith("semestra_session=") for c in r.headers.get_list("set-cookie"))
    again = await client.get("/account/me")
    assert "set-cookie" not in again.headers  # at most once a day

    clock.advance(days=29)  # 31 days after login, but renewed 29 days ago
    assert (await client.get("/account/me")).status_code == 200
    clock.advance(days=31)
    assert (await client.get("/account/me")).status_code == 401


async def test_logout_revokes_the_session_and_clears_cookies(
    client: AsyncClient, make_user: MakeUser, login_as: LoginAs
) -> None:
    user = await make_user()
    await login_as(client, user)
    r = await client.post("/auth/logout")
    assert r.status_code == 200
    assert any(
        "semestra_session=" in c and "Max-Age=0" in c for c in r.headers.get_list("set-cookie")
    )
    # replaying the old cookie must fail: the session is revoked server-side
    assert (await client.get("/account/me")).status_code == 401


# --- native tokens ----------------------------------------------------------------------------


async def test_native_login_returns_tokens_instead_of_cookies(
    client: AsyncClient, make_user: MakeUser
) -> None:
    await make_user(email="ios@example.com", password=PASSWORD)
    r = await client.post(
        "/auth/password/login?client=native",
        json={"email": "ios@example.com", "password": PASSWORD},
    )
    assert r.status_code == 200
    assert "set-cookie" not in r.headers
    tokens = r.json()["tokens"]
    assert tokens["refresh_token"].startswith("srt_")
    assert tokens["expires_in"] == 900
    me = await client.get(
        "/account/me", headers={"Authorization": f"Bearer {tokens['access_token']}"}
    )
    assert me.status_code == 200
    assert me.json()["email"] == "ios@example.com"


async def test_access_token_expires_after_15_minutes(
    client: AsyncClient, make_user: MakeUser, clock: Clock
) -> None:
    await make_user(email="ios@example.com", password=PASSWORD)
    r = await client.post(
        "/auth/password/login?client=native",
        json={"email": "ios@example.com", "password": PASSWORD},
    )
    headers = {"Authorization": f"Bearer {r.json()['tokens']['access_token']}"}
    clock.advance(minutes=14)
    assert (await client.get("/account/me", headers=headers)).status_code == 200
    clock.advance(minutes=2)
    assert (await client.get("/account/me", headers=headers)).status_code == 401


async def test_refresh_token_rotates_and_replay_revokes_the_session(
    client: AsyncClient, make_user: MakeUser, clock: Clock
) -> None:
    await make_user(email="ios@example.com", password=PASSWORD)
    login = await client.post(
        "/auth/password/login?client=native",
        json={"email": "ios@example.com", "password": PASSWORD},
    )
    first = login.json()["tokens"]

    r1 = await client.post("/auth/token/refresh", json={"refresh_token": first["refresh_token"]})
    assert r1.status_code == 200
    second = r1.json()
    assert second["refresh_token"] != first["refresh_token"]
    bearer = {"Authorization": f"Bearer {second['access_token']}"}
    assert (await client.get("/account/me", headers=bearer)).status_code == 200

    # The rotated-out token is presented again (stolen): the whole session dies.
    clock.advance(seconds=11)  # past the grace period for concurrent refreshes
    replay = await client.post(
        "/auth/token/refresh", json={"refresh_token": first["refresh_token"]}
    )
    assert replay.status_code == 401
    assert replay.json()["error"]["code"] == "auth.session_expired"
    assert (await client.get("/account/me", headers=bearer)).status_code == 401
    legit = await client.post(
        "/auth/token/refresh", json={"refresh_token": second["refresh_token"]}
    )
    assert legit.status_code == 401


async def test_concurrent_refreshes_with_one_token_rotate_it_exactly_once(
    client: AsyncClient, make_user: MakeUser
) -> None:
    await make_user(email="ios@example.com", password=PASSWORD)
    login = await client.post(
        "/auth/password/login?client=native",
        json={"email": "ios@example.com", "password": PASSWORD},
    )
    token = login.json()["tokens"]["refresh_token"]
    results = await asyncio.gather(
        *(client.post("/auth/token/refresh", json={"refresh_token": token}) for _ in range(4))
    )
    codes = sorted(r.status_code for r in results)
    assert codes.count(200) == 1
    assert set(codes) <= {200, 401}  # losers get a plain 401, never a 500
    winner = next(r for r in results if r.status_code == 200).json()
    # The session survives the lost races and keeps working with the new token.
    again = await client.post(
        "/auth/token/refresh", json={"refresh_token": winner["refresh_token"]}
    )
    assert again.status_code == 200


async def test_native_logout_revokes_the_access_token(
    client: AsyncClient, make_user: MakeUser, bearer_for: BearerFor
) -> None:
    user = await make_user()
    headers = await bearer_for(user)
    assert (await client.post("/auth/logout", headers=headers)).status_code == 200
    assert (await client.get("/account/me", headers=headers)).status_code == 401


# --- personal access tokens -------------------------------------------------------------------


async def create_pat(client: AsyncClient, **body) -> dict:
    r = await client.post("/account/tokens", json={"name": "Claude Desktop", **body})
    assert r.status_code == 200, r.text
    return r.json()


async def test_pat_lifecycle_and_plaintext_shown_once(
    client: AsyncClient, make_user: MakeUser, login_as: LoginAs
) -> None:
    await login_as(client, await make_user())
    created = await create_pat(client, scopes=["read"])
    assert created["token"].startswith("spat_")
    assert created["prefix"] == created["token"][:8]
    assert created["scopes"] == ["read"]

    listed = (await client.get("/account/tokens")).json()["items"]
    assert [t["id"] for t in listed] == [created["id"]]
    assert "token" not in listed[0]

    assert (await client.delete(f"/account/tokens/{created['id']}")).status_code == 200
    assert (await client.get("/account/tokens")).json()["items"] == []


async def test_pat_read_scope_only_calls_read_capabilities(
    app: FastAPI, client: AsyncClient, make_user: MakeUser, login_as: LoginAs
) -> None:
    await login_as(client, await make_user())
    read_pat = (await create_pat(client, scopes=["read"]))["token"]
    write_pat = (await create_pat(client, scopes=["write"]))["token"]

    async with AsyncClient(transport=ASGITransport(app), base_url="https://test") as mcp:
        auth = {"Authorization": f"Bearer {read_pat}"}
        assert (await mcp.get("/account/me", headers=auth)).status_code == 200
        assert (await mcp.get("/test/echo?text=hi", headers=auth)).status_code == 200
        denied = await mcp.post("/test/echo", json={"text": "hi"}, headers=auth)
        assert denied.status_code == 403
        assert denied.json()["error"]["code"] == "auth.token_scope"

        auth = {"Authorization": f"Bearer {write_pat}"}
        assert (await mcp.post("/test/echo", json={"text": "hi"}, headers=auth)).status_code == 200


async def test_pat_cannot_reach_account_security_or_plain_routes(
    app: FastAPI, client: AsyncClient, make_user: MakeUser, login_as: LoginAs
) -> None:
    await login_as(client, await make_user())
    pat = (await create_pat(client, scopes=["write"]))["token"]
    async with AsyncClient(transport=ASGITransport(app), base_url="https://test") as mcp:
        auth = {"Authorization": f"Bearer {pat}"}
        for method, path in [
            ("GET", "/account/tokens"),
            ("GET", "/account/sessions"),
            ("POST", "/account/tokens"),
            ("POST", "/auth/logout"),
        ]:
            r = await mcp.request(
                method, path, headers=auth, json={"name": "x"} if method == "POST" else None
            )
            assert r.status_code == 403, (method, path)
            assert r.json()["error"]["code"] == "auth.token_scope"


async def test_revoked_and_expired_pats_stop_working(
    app: FastAPI, client: AsyncClient, make_user: MakeUser, login_as: LoginAs, clock: Clock
) -> None:
    await login_as(client, await make_user())
    short = await create_pat(client, expires_in_days=1)
    revoked = await create_pat(client)
    await client.delete(f"/account/tokens/{revoked['id']}")
    async with AsyncClient(transport=ASGITransport(app), base_url="https://test") as mcp:
        assert (
            await mcp.get("/account/me", headers={"Authorization": f"Bearer {revoked['token']}"})
        ).status_code == 401
        auth = {"Authorization": f"Bearer {short['token']}"}
        assert (await mcp.get("/account/me", headers=auth)).status_code == 200
        clock.advance(days=2)
        assert (await mcp.get("/account/me", headers=auth)).status_code == 401


async def test_pat_last_used_is_recorded(
    app: FastAPI, client: AsyncClient, make_user: MakeUser, login_as: LoginAs
) -> None:
    await login_as(client, await make_user())
    pat = await create_pat(client)
    assert (await client.get("/account/tokens")).json()["items"][0]["last_used_at"] is None
    async with AsyncClient(transport=ASGITransport(app), base_url="https://test") as mcp:
        await mcp.get("/account/me", headers={"Authorization": f"Bearer {pat['token']}"})
    assert (await client.get("/account/tokens")).json()["items"][0]["last_used_at"] is not None


async def test_cannot_revoke_someone_elses_token_or_session(
    app: FastAPI, client: AsyncClient, make_user: MakeUser, login_as: LoginAs
) -> None:
    alice = await make_user(email="alice@example.com")
    bob = await make_user(email="bob@example.com")
    await login_as(client, alice)
    token = await create_pat(client)
    async with AsyncClient(transport=ASGITransport(app), base_url="https://test") as other:
        bob_session = await login_as(other, bob)
        for path in (f"/account/tokens/{token['id']}", f"/account/sessions/{bob_session}"):
            r = await other.delete(path) if "tokens" in path else await client.delete(path)
            assert r.status_code == 404, path
            assert r.json()["error"]["code"] == "common.not_found"
        assert (await other.delete(f"/account/tokens/{token['id']}")).status_code == 404


# --- sessions ---------------------------------------------------------------------------------


async def test_sessions_list_and_revoke(
    app: FastAPI, client: AsyncClient, make_user: MakeUser, login_as: LoginAs
) -> None:
    user = await make_user()
    mine = await login_as(client, user)
    async with await second_device(app, login_as, user) as other:
        listed = (await client.get("/account/sessions")).json()["items"]
        assert len(listed) == 2
        assert [s["id"] for s in listed if s["current"]] == [mine]

        other_id = next(s["id"] for s in listed if not s["current"])
        assert (await client.delete(f"/account/sessions/{other_id}")).status_code == 200
        assert (await other.get("/account/me")).status_code == 401
        assert len((await client.get("/account/sessions")).json()["items"]) == 1


async def test_revoke_other_sessions_keeps_the_current_one(
    app: FastAPI, client: AsyncClient, make_user: MakeUser, login_as: LoginAs
) -> None:
    user = await make_user()
    await login_as(client, user)
    async with await second_device(app, login_as, user) as other:
        assert (await client.post("/account/sessions/revoke-others")).status_code == 200
        assert (await client.get("/account/me")).status_code == 200
        assert (await other.get("/account/me")).status_code == 401


# --- profile & password -----------------------------------------------------------------------


async def test_profile_update_and_avatar_clearing(
    client: AsyncClient, make_user: MakeUser, login_as: LoginAs
) -> None:
    await login_as(client, await make_user())
    r = await client.patch(
        "/account/profile", json={"display_name": "  Zed  ", "avatar_url": "https://a/b.png"}
    )
    assert r.json()["display_name"] == "Zed"
    assert r.json()["avatar_url"] == "https://a/b.png"
    r = await client.patch("/account/profile", json={"display_name": "Zed 2"})
    assert r.json()["avatar_url"] == "https://a/b.png"  # absent = unchanged
    r = await client.patch("/account/profile", json={"avatar_url": None})
    assert r.json()["avatar_url"] is None
    assert r.json()["display_name"] == "Zed 2"
    bad = await client.patch("/account/profile", json={"avatar_url": "javascript:alert(1)"})
    assert bad.status_code == 422


async def test_change_password_requires_current_and_signs_out_others(
    app: FastAPI,
    client: AsyncClient,
    make_user: MakeUser,
    login_as: LoginAs,
    mailer: MemoryMailer,
) -> None:
    user = await make_user(password=PASSWORD)
    await login_as(client, user)
    async with await second_device(app, login_as, user) as other:
        wrong = await client.post(
            "/account/password/change",
            json={"current_password": "not it at all", "new_password": "a brand new pass 1"},
        )
        assert wrong.json()["error"]["code"] == "auth.invalid_credentials"
        missing = await client.post(
            "/account/password/change", json={"new_password": "a brand new pass 1"}
        )
        assert missing.json()["error"]["code"] == "auth.invalid_credentials"

        ok = await client.post(
            "/account/password/change",
            json={"current_password": PASSWORD, "new_password": "a brand new pass 1"},
        )
        assert ok.status_code == 200
        assert (await client.get("/account/me")).status_code == 200  # this device stays
        assert (await other.get("/account/me")).status_code == 401  # others are signed out
    assert any("password was changed" in m.content.subject for m in mailer.outbox)


async def test_setting_a_first_password_needs_a_recent_login(
    client: AsyncClient, make_user: MakeUser, login_as: LoginAs, clock: Clock
) -> None:
    await login_as(client, await make_user(password=None))
    clock.advance(minutes=11)
    stale = await client.post("/account/password/change", json={"new_password": "first pass 12345"})
    assert stale.status_code == 403
    assert stale.json()["error"]["code"] == "auth.reauth_required"

    # a fresh sign-in (within 10 minutes) may set it
    fresh = AsyncClient(transport=client._transport, base_url="https://test")
    async with fresh:
        user = await make_user(email="fresh@example.com", password=None)
        await login_as(fresh, user)
        ok = await fresh.post("/account/password/change", json={"new_password": "first pass 12345"})
        assert ok.status_code == 200
        assert ok.json()["has_password"] is True


# --- email change -----------------------------------------------------------------------------


async def test_change_email_start_is_limited_per_user(
    client: AsyncClient, make_user: MakeUser, login_as: LoginAs, mailer: MemoryMailer
) -> None:
    await login_as(client, await make_user(email="old@example.com"))
    for i in range(10):
        ok = await client.post(
            "/account/email/change-start", json={"new_email": f"n{i}@example.com"}
        )
        assert ok.status_code == 200
    blocked = await client.post(
        "/account/email/change-start", json={"new_email": "n11@example.com"}
    )
    assert blocked.status_code == 429
    assert blocked.json()["error"]["code"] == "common.rate_limited"


async def test_change_email_flow(
    client: AsyncClient, make_user: MakeUser, login_as: LoginAs, mailer: MemoryMailer
) -> None:
    await login_as(client, await make_user(email="old@example.com"))
    start = await client.post("/account/email/change-start", json={"new_email": "New@Example.com"})
    assert start.status_code == 200
    code = last_code(mailer, "new@example.com")

    miss = "000000" if code != "000000" else "111111"
    wrong = await client.post("/account/email/change-confirm", json={"code": miss})
    assert wrong.json()["error"]["code"] == "auth.invalid_code"
    done = await client.post("/account/email/change-confirm", json={"code": code})
    assert done.status_code == 200
    assert done.json()["email"] == "new@example.com"
    assert (await client.get("/account/me")).json()["email"] == "new@example.com"


async def test_change_email_to_a_taken_address_is_rejected(
    client: AsyncClient, make_user: MakeUser, login_as: LoginAs
) -> None:
    await make_user(email="taken@example.com")
    await login_as(client, await make_user(email="me@example.com"))
    r = await client.post("/account/email/change-start", json={"new_email": "taken@example.com"})
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "auth.email_in_use"


async def test_email_change_code_belongs_to_the_user_who_asked(
    app: FastAPI, client: AsyncClient, make_user: MakeUser, login_as: LoginAs, mailer: MemoryMailer
) -> None:
    await login_as(client, await make_user(email="a@example.com"))
    await client.post("/account/email/change-start", json={"new_email": "shared@example.com"})
    code = last_code(mailer, "shared@example.com")
    async with AsyncClient(transport=ASGITransport(app), base_url="https://test") as mallory:
        await login_as(mallory, await make_user(email="mallory@example.com"))
        r = await mallory.post("/account/email/change-confirm", json={"code": code})
        assert r.json()["error"]["code"] == "auth.invalid_code"


async def test_a_second_account_cannot_invalidate_anothers_pending_email_change(
    app: FastAPI,
    client: AsyncClient,
    make_user: MakeUser,
    login_as: LoginAs,
    mailer: MemoryMailer,
    clock: Clock,
) -> None:
    await login_as(client, await make_user(email="a@example.com"))
    await client.post("/account/email/change-start", json={"new_email": "shared@example.com"})
    code = last_code(mailer, "shared@example.com")
    clock.advance(minutes=2)  # past the resend cooldown

    async with AsyncClient(transport=ASGITransport(app), base_url="https://test") as mallory:
        await login_as(mallory, await make_user(email="mallory@example.com"))
        again = await mallory.post(
            "/account/email/change-start", json={"new_email": "shared@example.com"}
        )
        assert again.status_code == 200

    done = await client.post("/account/email/change-confirm", json={"code": code})
    assert done.status_code == 200
    assert done.json()["email"] == "shared@example.com"


# --- capability registry ----------------------------------------------------------------------


async def test_only_me_get_is_exposed_to_agents_and_mcp() -> None:
    agent = {c.name for c in registry.list(expose="agent") if c.name.startswith("account.")}
    mcp = {c.name for c in registry.list(expose="mcp") if c.name.startswith("account.")}
    assert agent == mcp == {"account.me.get"}


async def test_agents_only_see_name_email_and_locale(
    app: FastAPI, client: AsyncClient, make_user: MakeUser
) -> None:
    from semestra.core.capability import registry as reg
    from semestra.core.context import Ctx
    from semestra.modules.auth.models import AuthUser

    user = await make_user(email="agent@example.com", display_name="Agent Test")
    async with app.state.session_factory() as db:
        row = await db.get(AuthUser, user.id)
        ctx = Ctx(db, row, "en", app.state.now(), None, "mcp", "req", state=app.state)
        out = await reg.invoke(ctx, "account.me.get", {}, "agent")
    assert out == {"display_name": "Agent Test", "email": "agent@example.com", "locale": "en"}


async def test_capability_routes_have_camel_case_operation_ids(app: FastAPI) -> None:
    ops = {op["operationId"] for path in app.openapi()["paths"].values() for op in path.values()}
    assert {"accountMeGet", "accountTokensCreate", "accountSessionsRevoke", "authEmailStart"} <= ops


# --- uploaded avatars -------------------------------------------------------------------------


def _png(size: tuple[int, int], fmt: str = "PNG") -> bytes:
    import io

    from PIL import Image

    out = io.BytesIO()
    Image.new("RGB", size, (200, 30, 30)).save(out, fmt)
    return out.getvalue()


async def test_avatar_upload_resizes_serves_and_replaces(
    client: AsyncClient, make_user: MakeUser, login_as: LoginAs
) -> None:
    import io

    from PIL import Image

    await login_as(client, await make_user())
    r = await client.post("/account/avatar", files={"file": ("a.png", _png((900, 400)))})
    assert r.status_code == 200, r.text
    first = r.json()["avatar_url"]
    assert first.startswith("/account/avatars/")

    served = await client.get(first)
    assert served.headers["content-type"] == "image/webp"
    image = Image.open(io.BytesIO(served.content))
    assert image.format == "WEBP"
    assert image.size == (256, 256)

    r = await client.post("/account/avatar", files={"file": ("b.jpg", _png((50, 50), "JPEG"))})
    assert r.json()["avatar_url"] != first
    assert (await client.get(first)).status_code == 404  # previous file removed

    current = r.json()["avatar_url"]
    r = await client.patch("/account/profile", json={"avatar_url": None})
    assert r.json()["avatar_url"] is None
    assert (await client.get(current)).status_code == 404


async def test_avatar_upload_rejects_bad_files(
    client: AsyncClient, make_user: MakeUser, login_as: LoginAs
) -> None:
    await login_as(client, await make_user())
    gif = await client.post("/account/avatar", files={"file": ("a.gif", _png((8, 8), "GIF"))})
    assert (gif.status_code, gif.json()["error"]["code"]) == (415, "auth.avatar_invalid")
    junk = await client.post("/account/avatar", files={"file": ("a.png", b"not an image")})
    assert junk.status_code == 415
    big = await client.post(
        "/account/avatar", files={"file": ("a.png", b"0" * (5 * 1024 * 1024 + 1))}
    )
    assert (big.status_code, big.json()["error"]["code"]) == (413, "auth.avatar_too_large")


async def test_avatar_upload_requires_login(client: AsyncClient) -> None:
    r = await client.post("/account/avatar", files={"file": ("a.png", _png((8, 8)))})
    assert r.status_code == 401
