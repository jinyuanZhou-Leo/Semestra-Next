"""Plugin catalog, installation and capability gating (M10 §3, §4, §7)."""

from collections.abc import Awaitable, Callable

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from pydantic import BaseModel, Field

from semestra.core.capability import Http, Registry, capability, mount_http, registry
from semestra.core.context import Ctx, system_ctx
from semestra.core.events import Event, events
from semestra.modules.plugins import catalog
from semestra.modules.plugins.service import installed_ids
from semestra.testing import MakeUser, UserHandle, collect_events

LoginAs = Callable[[AsyncClient, UserHandle], Awaitable[str]]


@pytest.fixture
async def user(client: AsyncClient, make_user: MakeUser, login_as: LoginAs) -> UserHandle:
    handle = await make_user()
    await login_as(client, handle)
    return handle


async def catalog_by_id(client: AsyncClient) -> dict[str, dict]:
    r = await client.get("/plugins/catalog")
    assert r.status_code == 200, r.text
    return {p["id"]: p for p in r.json()["items"]}


async def test_catalog_lists_modules_with_defaults_installed(client: AsyncClient, user: UserHandle):
    items = await catalog_by_id(client)
    assert list(items) == ["academics", "notes", "solo"]
    assert items["academics"]["kind"] == "core"
    assert items["academics"]["installed"]
    assert items["notes"]["installed"]
    assert items["notes"]["default_installed"]
    assert not items["solo"]["installed"]
    assert items["notes"]["name_key"] == "notes_name"
    assert items["notes"]["provides"]["cards"] == ["notes.note"]
    assert items["notes"]["provides"]["pages"] == ["notes"]


async def test_install_uninstall_and_default_not_reinstalled(
    app: FastAPI, client: AsyncClient, user: UserHandle
):
    with collect_events(app, user.id) as seen:
        r = await client.put("/plugins/solo/installation")
        assert r.status_code == 200
        assert r.json()["installed"]
        r = await client.delete("/plugins/notes/installation")
        assert r.status_code == 200
        assert not r.json()["installed"]
    assert [e["type"] for e in seen] == ["plugins.installed", "plugins.uninstalled"]
    # The default plugin stays uninstalled on later reads.
    items = await catalog_by_id(client)
    assert items["solo"]["installed"]
    assert not items["notes"]["installed"]
    # Installing twice is fine and publishes nothing new.
    with collect_events(app, user.id) as seen:
        assert (await client.put("/plugins/solo/installation")).status_code == 200
    assert seen == []


async def test_new_default_plugin_reaches_existing_users(
    app: FastAPI, client: AsyncClient, user: UserHandle
):
    await catalog_by_id(client)
    catalog.register_plugin(catalog.PluginInfo(id="solo-2", default_installed=True))
    try:
        items = await catalog_by_id(client)
        assert items["solo-2"]["installed"]
    finally:
        catalog._plugins.pop("solo-2")  # pyright: ignore[reportPrivateUsage]
        catalog.reload()


async def test_core_modules_cannot_be_removed_and_unknown_is_not_found(
    client: AsyncClient, user: UserHandle
):
    r = await client.delete("/plugins/academics/installation")
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "plugins.core_not_removable"
    r = await client.put("/plugins/nope/installation")
    assert r.status_code == 404


async def test_purge_publishes_purge_event(app: FastAPI, client: AsyncClient, user: UserHandle):
    with collect_events(app, user.id) as seen:
        r = await client.delete("/plugins/notes/installation", params={"purge_data": True})
        assert r.status_code == 200
    assert [e["type"] for e in seen] == ["plugins.uninstalled", "plugins.purged"]
    assert seen[1]["data"] == {"plugin_id": "notes"}


async def test_a_failing_purge_keeps_the_plugin_installed(
    app: FastAPI, client: AsyncClient, user: UserHandle
):
    async def broken(ctx: Ctx, event: Event) -> None:
        raise RuntimeError("cleanup failed")

    events.subscribe("plugins.purge", in_transaction=True)(broken)
    try:
        with pytest.raises(RuntimeError):
            await client.delete("/plugins/notes/installation", params={"purge_data": True})
    finally:
        events._in_transaction["plugins.purge"].remove(broken)
    assert (await catalog_by_id(client))["notes"]["installed"]


class Echo(BaseModel):
    text: str = Field(description="Text")


async def test_plugin_capabilities_are_gated(app: FastAPI, client: AsyncClient, user: UserHandle):
    reg = Registry()
    reg.set_plugin_gate(installed_ids)

    @capability(
        name="solo.echo",
        summary="Echo.",
        description="Test.",
        effect="read",
        http=Http("POST", "/solo-echo"),
        plugin_id="solo",
        target=reg,
    )
    async def echo(ctx: Ctx, inp: Echo) -> Echo:
        return inp

    mount_http(app, reg)
    r = await client.post("/solo-echo", json={"text": "hi"})
    assert r.status_code == 403
    assert r.json()["error"] == {
        "code": "plugins.not_installed",
        "params": {"plugin_id": "solo"},
        "request_id": r.json()["error"]["request_id"],
    }
    async with system_ctx(app.state, user.id) as ctx:
        assert [c.name for c in await reg.available(ctx, "agent")] == []
    await client.put("/plugins/solo/installation")
    r = await client.post("/solo-echo", json={"text": "hi"})
    assert r.status_code == 200
    assert r.json() == {"text": "hi"}
    async with system_ctx(app.state, user.id) as ctx:
        assert [c.name for c in await reg.available(ctx, "agent")] == ["solo.echo"]


async def test_gate_is_installed_on_the_core_registry(app: FastAPI):
    assert registry._plugin_gate is installed_ids  # pyright: ignore[reportPrivateUsage]


async def test_catalog_requires_login(client: AsyncClient):
    assert (await client.get("/plugins/catalog")).status_code == 401
