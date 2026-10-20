"""Habit check-ins over HTTP (M14 §2)."""

from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import AsyncClient

from semestra.core.capability import registry
from semestra.core.context import system_ctx
from semestra.core.errors import AppError
from semestra.core.events import Event
from semestra.modules.plugins_builtin.tests.conftest import FakeCards
from semestra.testing import MakeUser, UserHandle

LoginAs = Callable[[AsyncClient, UserHandle], Awaitable[str]]


@pytest.fixture
async def user(client: AsyncClient, make_user: MakeUser, login_as: LoginAs) -> UserHandle:
    user = await make_user()
    await login_as(client, user)
    return user


async def program(client: AsyncClient, timezone: str = "America/Toronto") -> str:
    r = await client.post("/programs", json={"name": "BASc", "timezone": timezone})
    assert r.status_code == 200, r.text
    return r.json()["id"]


async def toggle(
    client: AsyncClient, instance_id: str, day: str, status: int = 200
) -> dict[str, Any]:
    r = await client.post(f"/habit/instances/{instance_id}/checkins/toggle", json={"date": day})
    assert r.status_code == status, r.text
    return r.json()


# The clock starts at 2026-01-15 12:00 UTC: 07:00 in Toronto, 01:00 on Jan 16 in Auckland.


async def test_toggle_checks_and_unchecks_and_reports_streaks(
    client: AsyncClient, user: UserHandle, cards: FakeCards
):
    pid = await program(client)
    habit = cards.add(user.id, "habit.board", "program", pid)
    first = await toggle(client, habit, "2026-01-15")
    assert first["checked"] is True
    assert first["stats"]["current_streak"] == 1
    assert first["stats"]["checked_today"] is True
    await toggle(client, habit, "2026-01-14")
    second = await toggle(client, habit, "2026-01-13")
    assert second["stats"]["current_streak"] == 3
    assert second["stats"]["total"] == 3

    undone = await toggle(client, habit, "2026-01-15")
    assert undone["checked"] is False
    # Today is open again, so the streak counts back from yesterday.
    assert undone["stats"]["current_streak"] == 2
    assert undone["stats"]["period_done"] == 0

    listed = await client.get(
        f"/habit/instances/{habit}/checkins",
        params={"from_date": "2026-01-01", "to_date": "2026-01-31"},
    )
    assert listed.json()["items"] == ["2026-01-13", "2026-01-14"]


async def test_the_assistant_sets_a_day_idempotently(
    app: FastAPI, client: AsyncClient, user: UserHandle, cards: FakeCards
):
    pid = await program(client)
    habit = cards.add(user.id, "habit.board", "program", pid)

    async def set_day(checked: bool) -> Any:
        async with system_ctx(app.state, user.id) as ctx:
            return await registry.invoke(
                ctx,
                "habit.checkin.set",
                {"instance_id": habit, "date": "2026-01-15", "checked": checked},
                "agent",
            )

    for _ in range(2):  # a repeated call does not undo the first
        done = await set_day(True)
        assert (done["checked"], done["stats"]["total"]) == (True, 1)
    for _ in range(2):
        undone = await set_day(False)
        assert (undone["checked"], undone["stats"]["total"]) == (False, 0)
    # The card's click stays a toggle, and only over HTTP.
    assert (await toggle(client, habit, "2026-01-15"))["checked"] is True
    async with system_ctx(app.state, user.id) as ctx:
        with pytest.raises(AppError):
            await registry.invoke(
                ctx, "habit.checkin.toggle", {"instance_id": habit, "date": "2026-01-15"}, "agent"
            )


async def test_only_today_and_the_past_week_can_change(
    client: AsyncClient, user: UserHandle, cards: FakeCards
):
    habit = cards.add(user.id, "habit.ring", "program", await program(client))
    await toggle(client, habit, "2026-01-08")  # exactly 7 days ago
    error = await toggle(client, habit, "2026-01-07", status=422)
    assert error["error"]["code"] == "habit.date_out_of_range"
    assert error["error"]["params"]["earliest"] == "2026-01-08"
    await toggle(client, habit, "2026-01-16", status=422)


async def test_today_follows_the_program_time_zone(
    client: AsyncClient, user: UserHandle, cards: FakeCards
):
    auckland = cards.add(
        user.id, "habit.ring", "program", await program(client, "Pacific/Auckland")
    )
    toronto = cards.add(user.id, "habit.ring", "program", await program(client))
    await toggle(client, auckland, "2026-01-16")  # already tomorrow's date in Toronto
    await toggle(client, toronto, "2026-01-16", status=422)
    stats = await client.get(f"/habit/instances/{auckland}/stats")
    assert stats.json()["today"] == "2026-01-16"


async def test_recorded_days_stay_when_the_program_time_zone_changes(
    client: AsyncClient, user: UserHandle, cards: FakeCards
):
    pid = await program(client)
    habit = cards.add(user.id, "habit.board", "program", pid)
    await toggle(client, habit, "2026-01-15")
    r = await client.patch(f"/programs/{pid}", json={"timezone": "Asia/Tokyo"})
    assert r.status_code == 200, r.text
    listed = await client.get(
        f"/habit/instances/{habit}/checkins",
        params={"from_date": "2026-01-10", "to_date": "2026-01-20"},
    )
    assert listed.json()["items"] == ["2026-01-15"]


async def test_weekly_goal_counts_weeks_reaching_the_target(
    client: AsyncClient, user: UserHandle, cards: FakeCards
):
    habit = cards.add(
        user.id,
        "habit.board",
        "program",
        await program(client),
        {"goal": "weekly", "weekly_target": 2},
    )
    # 2026-01-15 is a Thursday; the user's language is English, so weeks start on Sunday.
    for day in ("2026-01-11", "2026-01-13", "2026-01-15"):
        result = await toggle(client, habit, day)
    stats = result["stats"]
    assert stats["goal"] == "weekly"
    assert stats["week_start"] == 7
    assert (stats["period_done"], stats["period_target"]) == (3, 2)
    assert stats["current_streak"] == 1
    assert stats["longest_streak"] == 1


async def test_cards_of_other_users_and_other_plugins_are_not_found(
    client: AsyncClient, user: UserHandle, cards: FakeCards, make_user: MakeUser
):
    pid = await program(client)
    other = await make_user(email="other@example.com")
    foreign = cards.add(other.id, "habit.board", "program", pid)
    not_habit = cards.add(user.id, "sticky.note", "program", pid)
    for instance in (foreign, not_habit, "missing"):
        error = await toggle(client, instance, "2026-01-15", status=404)
        assert error["error"]["code"] == "common.not_found"
        assert (await client.get(f"/habit/instances/{instance}/stats")).status_code == 404


async def test_list_range_is_validated(client: AsyncClient, user: UserHandle, cards: FakeCards):
    habit = cards.add(user.id, "habit.board", "program", await program(client))
    r = await client.get(
        f"/habit/instances/{habit}/checkins",
        params={"from_date": "2024-01-01", "to_date": "2026-01-31"},
    )
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "habit.range_invalid"


async def test_card_deletion_and_purge_remove_the_check_ins(
    app: Any, client: AsyncClient, user: UserHandle, cards: FakeCards
):
    from semestra.core.events import events

    pid = await program(client)
    kept = cards.add(user.id, "habit.board", "program", pid)
    removed = cards.add(user.id, "habit.ring", "program", pid)
    for instance in (kept, removed):
        await toggle(client, instance, "2026-01-15")

    await events.dispatch(
        app.state,
        Event("layouts.card.deleted", {"instance_id": removed, "card_id": "habit.ring"}, user.id),
    )
    assert (await client.get(f"/habit/instances/{removed}/stats")).json()["total"] == 0
    assert (await client.get(f"/habit/instances/{kept}/stats")).json()["total"] == 1

    r = await client.request(
        "DELETE", "/plugins/habit-streak/installation", params={"purge_data": "true"}
    )
    assert r.status_code == 200, r.text
    # Reinstalled, the plugin starts without any data.
    assert (await client.put("/plugins/habit-streak/installation")).status_code == 200
    assert (await client.get(f"/habit/instances/{kept}/stats")).json()["total"] == 0
