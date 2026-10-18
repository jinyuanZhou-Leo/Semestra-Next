"""Scoped configuration: inheritance, validation, cleanup (M11 §3, §7)."""

from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import select

from semestra.core.capability import registry
from semestra.core.context import run_as_system
from semestra.core.events import Event, events
from semestra.modules.settings.models import SettingsValue
from semestra.testing import MakeUser, UserHandle, collect_events

LoginAs = Callable[[AsyncClient, UserHandle], Awaitable[str]]
NS = "/settings/demo_calendar"


async def signed_in(client: AsyncClient, make_user: MakeUser, login_as: LoginAs) -> UserHandle:
    user = await make_user()
    await login_as(client, user)
    return user


async def patch(client: AsyncClient, scope: tuple[str, str | None], values: dict[str, Any]):
    body: dict[str, Any] = {"scope_type": scope[0], "values": values}
    if scope[1]:
        body["scope_id"] = scope[1]
    return await client.patch(NS, json=body)


async def get(client: AsyncClient, scope: tuple[str, str | None] = ("account", None)):
    params = {"scope_type": scope[0], **({"scope_id": scope[1]} if scope[1] else {})}
    r = await client.get(NS, params=params)
    assert r.status_code == 200, r.text
    return r.json()


async def test_defaults_when_nothing_is_set(
    client: AsyncClient, make_user: MakeUser, login_as: LoginAs
):
    await signed_in(client, make_user, login_as)
    body = await get(client)
    assert body["values"] == {"default_view": "week", "show_weekends": True, "start_hour": 8}
    assert set(body["sources"].values()) == {"default"}


async def test_four_layer_inheritance_and_sources(
    client: AsyncClient, make_user: MakeUser, login_as: LoginAs
):
    await signed_in(client, make_user, login_as)
    assert (await patch(client, ("account", None), {"default_view": "month"})).status_code == 200
    assert (await patch(client, ("program", "P1"), {"show_weekends": False})).status_code == 200
    assert (await patch(client, ("term", "T1"), {"default_view": "day"})).status_code == 200

    # The namespace does not allow course-level values, but a course still *reads* the result.
    course = await get(client, ("course", "C1"))
    assert course["values"] == {"default_view": "day", "show_weekends": False, "start_hour": 8}
    assert course["sources"] == {
        "default_view": "term",
        "show_weekends": "program",
        "start_hour": "default",
    }
    assert course["scope_id"] == "C1"

    # A course without a current term skips the term level.
    no_term = await get(client, ("course", "C2"))
    assert no_term["values"]["default_view"] == "month"
    assert no_term["sources"]["default_view"] == "account"

    # Another program is unaffected by P1's overrides.
    other = await get(client, ("term", "T2"))
    assert other["values"]["show_weekends"] is True
    assert other["sources"]["default_view"] == "account"


async def test_writing_one_level_leaves_the_others_alone(
    client: AsyncClient, make_user: MakeUser, login_as: LoginAs
):
    await signed_in(client, make_user, login_as)
    await patch(client, ("term", "T1"), {"default_view": "day"})
    await patch(client, ("term", "T1"), {"start_hour": 9})
    assert (await get(client, ("term", "T1")))["values"]["default_view"] == "day"
    assert (await get(client))["values"]["default_view"] == "week"


async def test_reset_restores_the_inherited_value(
    client: AsyncClient, make_user: MakeUser, login_as: LoginAs
):
    await signed_in(client, make_user, login_as)
    await patch(client, ("account", None), {"default_view": "month"})
    await patch(client, ("term", "T1"), {"default_view": "day"})

    r = await client.delete(
        f"{NS}/keys/default_view", params={"scope_type": "term", "scope_id": "T1"}
    )
    assert r.status_code == 200
    assert r.json()["values"]["default_view"] == "month"
    assert r.json()["sources"]["default_view"] == "account"

    # Resetting a key that is not set is a no-op, and the emptied row is removed.
    r = await client.delete(
        f"{NS}/keys/default_view", params={"scope_type": "term", "scope_id": "T1"}
    )
    assert r.status_code == 200


async def test_reset_only_removes_the_given_key(
    client: AsyncClient, make_user: MakeUser, login_as: LoginAs, app: FastAPI
):
    await signed_in(client, make_user, login_as)
    await patch(client, ("term", "T1"), {"default_view": "day", "start_hour": 6})
    await client.delete(f"{NS}/keys/default_view", params={"scope_type": "term", "scope_id": "T1"})
    body = await get(client, ("term", "T1"))
    assert body["sources"]["start_hour"] == "term"
    assert body["sources"]["default_view"] == "default"
    await client.delete(f"{NS}/keys/start_hour", params={"scope_type": "term", "scope_id": "T1"})
    async with app.state.session_factory() as db:
        assert (await db.scalars(select(SettingsValue))).all() == []


async def test_invalid_values_are_rejected(
    client: AsyncClient, make_user: MakeUser, login_as: LoginAs
):
    await signed_in(client, make_user, login_as)
    r = await patch(client, ("account", None), {"default_view": "year"})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "settings.invalid_value"
    assert r.json()["error"]["params"]["errors"][0]["loc"] == ["default_view"]

    r = await patch(client, ("account", None), {"start_hour": 30, "show_weekends": "maybe"})
    assert {tuple(e["loc"]) for e in r.json()["error"]["params"]["errors"]} == {
        ("start_hour",),
        ("show_weekends",),
    }

    r = await patch(client, ("account", None), {"not_a_field": 1})
    assert r.status_code == 422
    assert r.json()["error"]["params"]["errors"] == [
        {"loc": ["not_a_field"], "code": "extra_forbidden"}
    ]
    assert (await get(client))["values"]["default_view"] == "week"  # nothing was stored

    r = await patch(client, ("account", None), {})
    assert r.json()["error"]["code"] == "common.validation"


async def test_a_rule_across_fields_sees_inherited_values(
    client: AsyncClient, make_user: MakeUser, login_as: LoginAs
):
    await signed_in(client, make_user, login_as)
    ok = await client.patch(
        "/settings/demo_hours", json={"scope_type": "account", "values": {"end": 10}}
    )
    assert ok.status_code == 200

    # Alone, start=12 would pass against the default end (20); with the inherited end=10 it is not.
    program = {"scope_type": "program", "scope_id": "P1", "values": {"start": 12}}
    r = await client.patch("/settings/demo_hours", json=program)
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "settings.invalid_value"
    after = await client.get(
        "/settings/demo_hours", params={"scope_type": "program", "scope_id": "P1"}
    )
    assert after.json()["values"] == {"start": 8, "end": 10}  # nothing was stored

    program["values"] = {"start": 6}
    assert (await client.patch("/settings/demo_hours", json=program)).status_code == 200


async def test_level_not_allowed_and_unknown_namespace(
    client: AsyncClient, make_user: MakeUser, login_as: LoginAs
):
    await signed_in(client, make_user, login_as)
    r = await patch(client, ("course", "C1"), {"default_view": "day"})
    assert r.status_code == 422
    assert r.json()["error"] == {
        "code": "settings.level_not_allowed",
        "params": {"namespace": "demo_calendar", "level": "course"},
        "request_id": r.json()["error"]["request_id"],
    }
    r = await client.delete(
        f"{NS}/keys/default_view", params={"scope_type": "course", "scope_id": "C1"}
    )
    assert r.json()["error"]["code"] == "settings.level_not_allowed"

    r = await client.get("/settings/nope")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "settings.unknown_namespace"


async def test_scopes_of_other_users_and_missing_ids_are_not_found(
    client: AsyncClient, make_user: MakeUser, login_as: LoginAs
):
    await signed_in(client, make_user, login_as)
    r = await patch(client, ("term", "T3"), {"default_view": "day"})
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "common.not_found"
    r = await client.get(NS, params={"scope_type": "term"})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "common.validation"


async def test_values_are_per_user(client: AsyncClient, make_user: MakeUser, login_as: LoginAs):
    await signed_in(client, make_user, login_as)
    await patch(client, ("account", None), {"default_view": "month"})
    async with AsyncClient(transport=client._transport, base_url=str(client.base_url)) as other:
        await login_as(other, await make_user("b@example.com"))
        assert (await get(other))["values"]["default_view"] == "week"


async def test_requires_login(client: AsyncClient):
    assert (await client.get(NS)).status_code == 401
    assert (await client.get("/settings/schemas")).status_code == 401


async def test_stale_stored_data_falls_back_to_defaults(
    app: FastAPI, client: AsyncClient, make_user: MakeUser, login_as: LoginAs
):
    user = await signed_in(client, make_user, login_as)
    async with app.state.session_factory() as db:
        db.add(
            SettingsValue(
                user_id=user.id,
                namespace="demo_calendar",
                scope_type="account",
                scope_id="",
                # a field removed by a later release, and one whose allowed values changed
                data={"removed_field": 1, "default_view": "agenda", "start_hour": 7},
            )
        )
        await db.commit()
    body = await get(client)
    assert body["values"] == {"default_view": "week", "show_weekends": True, "start_hour": 7}
    assert body["sources"]["default_view"] == "default"
    assert body["sources"]["start_hour"] == "account"


async def test_updates_are_published(
    app: FastAPI, client: AsyncClient, make_user: MakeUser, login_as: LoginAs
):
    user = await signed_in(client, make_user, login_as)
    with collect_events(app, user.id) as messages:
        await patch(client, ("term", "T1"), {"default_view": "day"})
        await client.delete(
            f"{NS}/keys/default_view", params={"scope_type": "term", "scope_id": "T1"}
        )
        await client.get(NS)
    assert [m["data"] for m in messages if m["type"] == "settings.values.updated"] == [
        {"namespace": "demo_calendar", "scope": {"type": "term", "id": "T1"}},
        {"namespace": "demo_calendar", "scope": {"type": "term", "id": "T1"}},
    ]


async def test_schemas_list_describes_every_namespace(
    client: AsyncClient, make_user: MakeUser, login_as: LoginAs
):
    await signed_in(client, make_user, login_as)
    r = await client.get("/settings/schemas")
    assert r.status_code == 200
    by_name = {i["namespace"]: i for i in r.json()["items"]}
    calendar = by_name["demo_calendar"]
    assert calendar["levels"] == ["account", "program", "term"]
    assert calendar["plugin_id"] is None
    assert calendar["json_schema"]["properties"]["default_view"]["enum"] == ["day", "week", "month"]
    assert by_name["plugin.demo-timer"]["plugin_id"] == "demo-timer"


async def test_scope_deletion_and_plugin_purge_remove_values(
    app: FastAPI, client: AsyncClient, make_user: MakeUser, login_as: LoginAs
):
    user = await signed_in(client, make_user, login_as)
    await patch(client, ("account", None), {"default_view": "month"})
    await patch(client, ("program", "P1"), {"show_weekends": False})
    await patch(client, ("term", "T1"), {"default_view": "day"})
    await client.patch(
        "/settings/plugin.demo-timer", json={"scope_type": "account", "values": {"focus_min": 50}}
    )

    async def rows() -> set[tuple[str, str, str]]:
        async with app.state.session_factory() as db:
            found = (await db.scalars(select(SettingsValue))).all()
            return {(r.namespace, r.scope_type, r.scope_id) for r in found}

    assert len(await rows()) == 4
    await events.dispatch(app.state, Event("academics.term.deleted", {"term_id": "T1"}, user.id))
    assert ("demo_calendar", "term", "T1") not in await rows()
    purge = {"plugin_id": "demo-timer"}
    await run_as_system(
        app.state, user.id, lambda ctx: events.publish_in_transaction(ctx, "plugins.purge", purge)
    )
    await events.dispatch(
        app.state, Event("academics.program.deleted", {"program_id": "P1"}, user.id)
    )
    assert await rows() == {("demo_calendar", "account", "")}


async def test_purge_only_touches_the_event_users_data(
    app: FastAPI, client: AsyncClient, make_user: MakeUser, login_as: LoginAs
):
    mine = await signed_in(client, make_user, login_as)
    await patch(client, ("term", "T1"), {"default_view": "day"})
    other = await make_user("b@example.com")
    await events.dispatch(app.state, Event("academics.term.deleted", {"term_id": "T1"}, other.id))
    assert (await get(client, ("term", "T1")))["values"]["default_view"] == "day"
    await events.dispatch(app.state, Event("academics.term.deleted", {"term_id": "T1"}, mine.id))
    assert (await get(client, ("term", "T1")))["values"]["default_view"] == "week"


def test_agent_can_read_and_write_module_settings_only() -> None:
    agent = {c.name for c in registry.list(expose="agent")}
    assert {"settings.values.get", "settings.values.update", "settings.schemas.list"} <= agent
    assert not any(n.startswith("settings.ui_state") for n in agent)
    assert "settings.values.reset" not in agent
    assert registry.get("settings.values.update").effect == "write"


async def test_an_uninstalled_plugins_settings_are_refused(
    client: AsyncClient, make_user: MakeUser, login_as: LoginAs
):
    await signed_in(client, make_user, login_as)
    previous = registry._plugin_gate  # pyright: ignore[reportPrivateUsage]

    async def nothing_installed(ctx: Any) -> set[str]:
        return set()

    registry.set_plugin_gate(nothing_installed)
    try:
        url = "/settings/plugin.demo-timer"
        r = await client.get(url, params={"scope_type": "account"})
        assert r.json()["error"]["code"] == "plugins.not_installed"
        r = await client.patch(url, json={"scope_type": "account", "values": {"focus_min": 5}})
        assert r.json()["error"]["code"] == "plugins.not_installed"
    finally:
        registry.set_plugin_gate(previous)
