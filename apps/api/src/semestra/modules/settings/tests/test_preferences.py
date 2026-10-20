from collections.abc import Awaitable, Callable

from fastapi import FastAPI
from httpx import AsyncClient

from semestra.core.capability import registry
from semestra.testing import MakeUser, UserHandle, collect_events

LoginAs = Callable[[AsyncClient, UserHandle], Awaitable[str]]


async def test_defaults_before_any_change(
    client: AsyncClient, make_user: MakeUser, login_as: LoginAs
):
    await login_as(client, await make_user())
    r = await client.get("/me/preferences")
    assert r.status_code == 200
    assert r.json() == {
        "locale": None,
        "theme": "system",
        "accent": "blue",
        "time_format": "auto",
        "week_start": 0,
        "reduce_motion": "system",
        "active_program_id": None,
        "updated_at": None,
    }


async def test_requires_login(client: AsyncClient):
    assert (await client.get("/me/preferences")).status_code == 401
    assert (await client.patch("/me/preferences", json={"theme": "dark"})).status_code == 401


async def test_partial_update_keeps_other_fields(
    client: AsyncClient, make_user: MakeUser, login_as: LoginAs
):
    await login_as(client, await make_user())
    r = await client.patch("/me/preferences", json={"theme": "dark", "accent": "violet"})
    assert r.status_code == 200
    r = await client.patch("/me/preferences", json={"week_start": 1})
    body = r.json()
    assert (body["theme"], body["accent"], body["week_start"]) == ("dark", "violet", 1)
    assert body["updated_at"] is not None
    assert (await client.get("/me/preferences")).json() == body


async def test_null_clears_only_nullable_fields(
    client: AsyncClient, make_user: MakeUser, login_as: LoginAs
):
    await login_as(client, await make_user())
    await client.patch("/me/preferences", json={"locale": "zh-CN", "active_program_id": "P1"})
    r = await client.patch("/me/preferences", json={"locale": None, "active_program_id": None})
    assert r.json()["locale"] is None
    assert r.json()["active_program_id"] is None

    r = await client.patch("/me/preferences", json={"theme": None})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "settings.invalid_value"
    assert r.json()["error"]["params"]["errors"][0]["loc"] == ["theme"]


async def test_invalid_choice_is_a_validation_error(
    client: AsyncClient, make_user: MakeUser, login_as: LoginAs
):
    await login_as(client, await make_user())
    for body in ({"theme": "sepia"}, {"week_start": 3}, {"locale": "fr"}, {"accent": "red"}):
        r = await client.patch("/me/preferences", json=body)
        assert r.status_code == 422, body
        assert r.json()["error"]["code"] == "common.validation"


async def test_unchanged_update_does_not_publish(
    app: FastAPI, client: AsyncClient, make_user: MakeUser, login_as: LoginAs
):
    user = await make_user()
    await login_as(client, user)
    with collect_events(app, user.id) as messages:
        await client.patch("/me/preferences", json={"theme": "dark"})
        await client.patch("/me/preferences", json={"theme": "dark"})
        await client.patch("/me/preferences", json={})
    updates = [m for m in messages if m["type"] == "settings.preferences.updated"]
    assert [m["data"] for m in updates] == [{"fields": ["theme"]}]


async def test_locale_preference_drives_the_account_locale(
    client: AsyncClient, make_user: MakeUser, login_as: LoginAs
):
    await login_as(client, await make_user(locale=None))
    assert (await client.get("/account/me")).json()["locale"] is None
    await client.patch("/me/preferences", json={"locale": "zh-CN"})
    assert (await client.get("/account/me")).json()["locale"] == "zh-CN"
    await client.patch("/me/preferences", json={"locale": None})
    assert (await client.get("/account/me")).json()["locale"] is None


async def test_preferences_are_per_user(
    client: AsyncClient, make_user: MakeUser, login_as: LoginAs
):
    await login_as(client, await make_user("a@example.com"))
    await client.patch("/me/preferences", json={"theme": "dark"})
    other = AsyncClient(transport=client._transport, base_url=str(client.base_url))
    async with other:
        await login_as(other, await make_user("b@example.com"))
        assert (await other.get("/me/preferences")).json()["theme"] == "system"


def test_agent_reads_formats_but_cannot_change_preferences() -> None:
    agent = {c.name for c in registry.list(expose="agent")}
    assert "settings.preference.get" in agent
    assert "settings.preference.update" not in agent
    assert registry.get("settings.preference.get").agent_output_fields == (
        "locale",
        "time_format",
        "week_start",
    )


async def test_forgets_a_deleted_active_program(
    app: FastAPI, client: AsyncClient, make_user: MakeUser, login_as: LoginAs
):
    from semestra.core.events import Event, events

    user = await make_user()
    await login_as(client, user)
    await client.patch("/me/preferences", json={"active_program_id": "P1"})
    await events.dispatch(
        app.state, Event("academics.program.deleted", {"program_id": "P2"}, user.id)
    )
    assert (await client.get("/me/preferences")).json()["active_program_id"] == "P1"
    await events.dispatch(
        app.state, Event("academics.program.deleted", {"program_id": "P1"}, user.id)
    )
    assert (await client.get("/me/preferences")).json()["active_program_id"] is None
