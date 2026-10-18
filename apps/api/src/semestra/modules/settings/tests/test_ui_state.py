from collections.abc import Awaitable, Callable

from httpx import AsyncClient

from semestra.testing import MakeUser, UserHandle

LoginAs = Callable[[AsyncClient, UserHandle], Awaitable[str]]


async def test_set_and_read_back(client: AsyncClient, make_user: MakeUser, login_as: LoginAs):
    await login_as(client, await make_user())
    r = await client.put("/me/ui-state/calendar.view.T1", json={"value": {"view": "week", "n": 3}})
    assert r.status_code == 200
    assert r.json() == {"key": "calendar.view.T1", "value": {"view": "week", "n": 3}}

    r = await client.post("/me/ui-state:get", json={"keys": ["calendar.view.T1", "missing.key"]})
    assert r.json() == {"items": {"calendar.view.T1": {"view": "week", "n": 3}}}

    await client.put("/me/ui-state/calendar.view.T1", json={"value": "month"})
    r = await client.post("/me/ui-state:get", json={"keys": ["calendar.view.T1"]})
    assert r.json()["items"] == {"calendar.view.T1": "month"}


async def test_any_json_value_including_null_and_false(
    client: AsyncClient, make_user: MakeUser, login_as: LoginAs
):
    await login_as(client, await make_user())
    for key, value in [("a.null", None), ("a.false", False), ("a.zero", 0), ("a.list", [1, "x"])]:
        assert (await client.put(f"/me/ui-state/{key}", json={"value": value})).status_code == 200
    r = await client.post("/me/ui-state:get", json={"prefixes": ["a."]})
    assert r.json()["items"] == {"a.null": None, "a.false": False, "a.zero": 0, "a.list": [1, "x"]}


async def test_prefix_read_is_literal(client: AsyncClient, make_user: MakeUser, login_as: LoginAs):
    await login_as(client, await make_user())
    for key in ("layout.nav", "layout.board.P1", "layoutXnav", "calendar.view"):
        await client.put(f"/me/ui-state/{key}", json={"value": 1})
    r = await client.post("/me/ui-state:get", json={"prefixes": ["layout."]})
    assert set(r.json()["items"]) == {"layout.nav", "layout.board.P1"}
    # `_` is a LIKE wildcard in SQL; here it must only match a literal underscore.
    await client.put("/me/ui-state/a_b.x", json={"value": 1})
    await client.put("/me/ui-state/aXb.x", json={"value": 1})
    r = await client.post("/me/ui-state:get", json={"prefixes": ["a_b."]})
    assert set(r.json()["items"]) == {"a_b.x"}
    r = await client.post("/me/ui-state:get", json={})
    assert r.json() == {"items": {}}


async def test_key_rules(client: AsyncClient, make_user: MakeUser, login_as: LoginAs):
    await login_as(client, await make_user())
    assert (await client.put(f"/me/ui-state/{'a' * 128}", json={"value": 1})).status_code == 200
    for bad in ("a" * 129, ".hidden", "has space"):
        r = await client.put(f"/me/ui-state/{bad}", json={"value": 1})
        assert r.status_code == 422, bad
        assert r.json()["error"]["code"] == "common.validation"


async def test_value_size_limit(client: AsyncClient, make_user: MakeUser, login_as: LoginAs):
    await login_as(client, await make_user())
    ok = await client.put("/me/ui-state/big.ok", json={"value": "x" * (16 * 1024 - 2)})
    assert ok.status_code == 200
    r = await client.put("/me/ui-state/big.no", json={"value": "x" * (16 * 1024)})
    assert r.status_code == 413
    assert r.json()["error"]["code"] == "settings.ui_state_too_large"
    got = await client.post("/me/ui-state:get", json={"keys": ["big.no"]})
    assert got.json()["items"] == {}


async def test_ui_state_is_per_user(client: AsyncClient, make_user: MakeUser, login_as: LoginAs):
    await login_as(client, await make_user())
    await client.put("/me/ui-state/sidebar.collapsed", json={"value": True})
    async with AsyncClient(transport=client._transport, base_url=str(client.base_url)) as other:
        await login_as(other, await make_user("b@example.com"))
        r = await other.post("/me/ui-state:get", json={"keys": ["sidebar.collapsed"]})
        assert r.json()["items"] == {}


async def test_requires_login(client: AsyncClient):
    assert (await client.put("/me/ui-state/x", json={"value": 1})).status_code == 401
    assert (await client.post("/me/ui-state:get", json={"keys": ["x"]})).status_code == 401
