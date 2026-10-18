"""The plugins on top of the real M10 boards: cards, installation and cleanup (M14 §0, §7)."""

from collections.abc import Awaitable, Callable

import pytest
from httpx import AsyncClient

from semestra.testing import MakeUser, UserHandle

LoginAs = Callable[[AsyncClient, UserHandle], Awaitable[str]]


@pytest.fixture
async def user(client: AsyncClient, make_user: MakeUser, login_as: LoginAs) -> UserHandle:
    user = await make_user()
    await login_as(client, user)
    return user


async def program(client: AsyncClient) -> str:
    r = await client.post("/programs", json={"name": "BASc", "timezone": "America/Toronto"})
    assert r.status_code == 200, r.text
    return r.json()["id"]


async def add_card(
    client: AsyncClient, pid: str, card_id: str, settings: dict[str, object] | None = None
) -> str:
    r = await client.post(
        f"/layouts/boards/program/{pid}/cards", json={"card_id": card_id, "settings": settings}
    )
    assert r.status_code == 200, r.text
    return r.json()["instance_id"]


async def test_habit_checkin_on_a_real_card_and_cleanup_with_the_card(
    client: AsyncClient, user: UserHandle
):
    pid = await program(client)
    habit = await add_card(client, pid, "habit.ring", {"name": "Reading", "goal": "daily"})
    r = await client.post(f"/habit/instances/{habit}/checkins/toggle", json={"date": "2026-01-15"})
    assert r.status_code == 200, r.text
    assert r.json()["stats"]["total"] == 1

    # A card of another plugin is not a habit.
    note = await add_card(client, pid, "sticky.note")
    r = await client.post(f"/habit/instances/{note}/checkins/toggle", json={"date": "2026-01-15"})
    assert r.status_code == 404

    assert (await client.delete(f"/layouts/cards/{habit}")).status_code == 200
    # The card is gone, and so are its check-ins.
    again = await client.get(f"/habit/instances/{habit}/stats")
    assert again.status_code == 404


async def test_sticky_note_is_read_and_written_through_the_card_settings(
    client: AsyncClient, user: UserHandle
):
    pid = await program(client)
    note = await add_card(client, pid, "sticky.note", {"content": "old", "color": "subject-3"})
    r = await client.put(f"/sticky/notes/{note}", json={"content": "old\nnew"})
    assert r.status_code == 200, r.text
    listed = await client.get("/sticky/notes", params={"scope_type": "program", "scope_id": pid})
    assert listed.json()["items"] == [
        {"instance_id": note, "content": "old\nnew", "color": "subject-3"}
    ]
    settings = await client.get(f"/layouts/cards/{note}/settings")
    assert settings.json()["settings"] == {"content": "old\nnew", "color": "subject-3"}


async def test_uninstalling_hides_the_tools_and_keeps_the_data(
    client: AsyncClient, user: UserHandle
):
    pid = await program(client)
    habit = await add_card(client, pid, "habit.ring")
    await client.post(f"/habit/instances/{habit}/checkins/toggle", json={"date": "2026-01-15"})

    assert (await client.delete("/plugins/habit-streak/installation")).status_code == 200
    r = await client.get(f"/habit/instances/{habit}/stats")
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "plugins.not_installed"

    assert (await client.put("/plugins/habit-streak/installation")).status_code == 200
    r = await client.get(f"/habit/instances/{habit}/stats")
    assert r.status_code == 200
    assert r.json()["total"] == 1


async def test_uninstalling_with_data_removes_the_habit_and_pomodoro_rows(
    client: AsyncClient, user: UserHandle
):
    pid = await program(client)
    habit = await add_card(client, pid, "habit.ring")
    timer = await add_card(client, pid, "pomodoro.timer")
    await client.post(f"/habit/instances/{habit}/checkins/toggle", json={"date": "2026-01-15"})
    r = await client.post(
        "/pomodoro/sessions",
        json={
            "instance_id": timer,
            "started_at": "2026-01-15T10:00:00Z",
            "ended_at": "2026-01-15T10:25:00Z",
            "duration_sec": 1500,
            "mode": "focus",
        },
    )
    assert r.status_code == 200, r.text

    for plugin in ("habit-streak", "pomodoro"):
        r = await client.request(
            "DELETE", f"/plugins/{plugin}/installation", params={"purge_data": "true"}
        )
        assert r.status_code == 200, r.text
        assert (await client.put(f"/plugins/{plugin}/installation")).status_code == 200

    assert (await client.get("/pomodoro/stats")).json()["total_sessions"] == 0
    # Purging removed the cards too, so the habit is unknown now.
    assert (await client.get(f"/habit/instances/{habit}/stats")).status_code == 404


async def test_counter_settings_are_checked_across_fields(client: AsyncClient, user: UserHandle):
    pid = await program(client)
    assert (await client.put("/plugins/counter/installation")).status_code == 200
    ok = await client.post(
        f"/layouts/boards/program/{pid}/cards",
        json={"card_id": "counter.counter", "settings": {"label": "Pages", "max": 20, "value": 4}},
    )
    assert ok.status_code == 200, ok.text
    counter = ok.json()["instance_id"]

    async def save(settings: dict[str, object]):
        return await client.put(f"/layouts/cards/{counter}/settings", json={"settings": settings})

    assert (await save({"min": 5, "max": 5})).status_code == 422
    assert (await save({"step": 0})).status_code == 422
    assert (await save({"initial": 11})).status_code == 422
    assert (await save({"value": 11})).status_code == 422
    saved = await save({"max": 20, "value": 7})
    assert saved.status_code == 200
    # A count that was never set stays out of the stored settings.
    fresh = await save({"max": 20})
    assert "value" not in fresh.json()["settings"]


async def test_world_clock_zones_must_be_real_time_zones(client: AsyncClient, user: UserHandle):
    pid = await program(client)
    assert (await client.put("/plugins/world-clock/installation")).status_code == 200
    ok = await client.post(
        f"/layouts/boards/program/{pid}/cards",
        json={"card_id": "clock.world", "settings": {"zones": ["Asia/Tokyo"]}},
    )
    assert ok.status_code == 200, ok.text
    clock = ok.json()["instance_id"]

    async def save(settings: dict[str, object]):
        return await client.put(f"/layouts/cards/{clock}/settings", json={"settings": settings})

    assert (await save({"zones": ["Not/AZone"]})).status_code == 422
    assert (await save({"zones": ["../etc/passwd"]})).status_code == 422
    assert (await save({"zones": ["UTC"] * 4})).status_code == 422
    assert (await save({"zones": ["America/Toronto", "Europe/London"]})).status_code == 200
    # The label is optional and the card may be saved with no zone at all (the local zone).
    assert (await save({"zones": []})).status_code == 200


async def test_sticky_notes_of_a_board_that_follows_the_template_are_listed(
    client: AsyncClient, user: UserHandle
):
    first = await program(client)
    await add_card(client, first, "sticky.note")
    saved = await client.post(
        "/layouts/templates/program:from-board", json={"scope_type": "program", "scope_id": first}
    )
    assert saved.status_code == 200, saved.text
    # A second Program was never edited, so its board is generated from that template.
    second = await program(client)
    board = (await client.get(f"/layouts/boards/program/{second}")).json()
    assert board["customized"] is False
    assert [c["card_id"] for c in board["cards"]].count("sticky.note") == 1

    listed = await client.get("/sticky/notes", params={"scope_type": "program", "scope_id": second})
    assert listed.status_code == 200, listed.text
    notes = listed.json()["items"]
    assert [n["content"] for n in notes] == [""]  # templates carry no settings
    # The note an agent found can be written.
    r = await client.put(f"/sticky/notes/{notes[0]['instance_id']}", json={"content": "edited"})
    assert r.status_code == 200, r.text
