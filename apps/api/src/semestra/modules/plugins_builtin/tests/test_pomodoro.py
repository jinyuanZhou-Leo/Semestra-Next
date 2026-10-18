"""Pomodoro session records and statistics (M14 §3)."""

from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from httpx import AsyncClient

from semestra.core.events import Event, events
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


async def course(client: AsyncClient, program_id: str, code: str) -> str:
    term = await client.post(
        f"/programs/{program_id}/terms",
        json={"name": "Winter", "start_date": "2026-01-05", "end_date": "2026-04-30"},
    )
    r = await client.post(
        f"/programs/{program_id}/courses",
        json={"title": code, "code": code, "term_ids": [term.json()["term"]["id"]]},
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


def session(started: str, ended: str, seconds: int, **extra: Any) -> dict[str, Any]:
    return {"started_at": started, "ended_at": ended, "duration_sec": seconds, **extra}


# The clock starts at 2026-01-15 12:00 UTC (07:00 in Toronto).


async def test_record_is_idempotent_and_validated(
    client: AsyncClient, user: UserHandle, cards: FakeCards
):
    timer = cards.add(user.id, "pomodoro.timer", "program", await program(client))
    body = {"instance_id": timer, **session("2026-01-15T10:00:00Z", "2026-01-15T10:25:00Z", 1500)}
    first = await client.post("/pomodoro/sessions", json=body)
    assert first.status_code == 200
    assert first.json()["duplicate"] is False
    again = await client.post("/pomodoro/sessions", json=body)
    assert again.json() == {"id": first.json()["id"], "duplicate": True}

    bad = [
        session("2026-01-15T10:25:00Z", "2026-01-15T10:00:00Z", 60),  # ends before it starts
        session("2026-01-15T10:00:00Z", "2026-01-15T10:10:00Z", 1500),  # longer than the interval
        session("2026-01-15T12:30:00Z", "2026-01-15T12:55:00Z", 1500),  # ends in the future
        session("2026-01-15T10:00:00", "2026-01-15T10:25:00", 1500),  # naive times
    ]
    for item in bad:
        r = await client.post("/pomodoro/sessions", json={"instance_id": timer, **item})
        assert r.status_code == 422, item
    other = cards.add(user.id, "sticky.note", "program", "x")
    r = await client.post("/pomodoro/sessions", json={"instance_id": other, **bad[0]})
    assert r.status_code == 404


async def test_stats_group_focus_time_by_day_and_course(
    client: AsyncClient, user: UserHandle, cards: FakeCards
):
    pid = await program(client)
    timer = cards.add(user.id, "pomodoro.timer", "program", pid)
    aps = await course(client, pid, "APS105")
    mat = await course(client, pid, "MAT188")
    for started, ended, course_id in (
        ("2026-01-14T14:00:00Z", "2026-01-14T14:25:00Z", aps),
        ("2026-01-15T03:00:00Z", "2026-01-15T03:25:00Z", aps),  # 22:00 on Jan 14 in Toronto
        ("2026-01-15T10:00:00Z", "2026-01-15T10:25:00Z", mat),
        ("2026-01-15T11:00:00Z", "2026-01-15T11:25:00Z", None),
    ):
        r = await client.post(
            "/pomodoro/sessions",
            json={"instance_id": timer, "course_id": course_id, **session(started, ended, 1500)},
        )
        assert r.status_code == 200, r.text
    # Breaks are never counted.
    await client.post(
        "/pomodoro/sessions",
        json={
            "instance_id": timer,
            "mode": "short_break",
            **session("2026-01-15T11:30:00Z", "2026-01-15T11:35:00Z", 300),
        },
    )

    stats = (await client.get("/pomodoro/stats")).json()
    assert stats["today"] == "2026-01-15"
    assert stats["timezone"] == "America/Toronto"
    assert (stats["total_sessions"], stats["total_focus_sec"]) == (4, 6000)
    assert [(d["date"], d["sessions"]) for d in stats["days"]] == [
        ("2026-01-14", 2),
        ("2026-01-15", 2),
    ]
    by_course = [(c["course_id"], c["focus_sec"]) for c in stats["by_course"]]
    assert by_course[0] == (aps, 3000)
    assert sorted(by_course[1:], key=lambda c: c[0] or "") == sorted(
        [(None, 1500), (mat, 1500)], key=lambda c: c[0] or ""
    )

    only_aps = (await client.get("/pomodoro/stats", params={"course_id": aps})).json()
    assert only_aps["total_sessions"] == 2
    today = (
        await client.get(
            "/pomodoro/stats", params={"from_date": "2026-01-15", "to_date": "2026-01-15"}
        )
    ).json()
    assert today["total_sessions"] == 2


async def test_stats_defaults_to_utc_without_a_program_and_validates_the_range(
    client: AsyncClient, user: UserHandle
):
    stats = (await client.get("/pomodoro/stats")).json()
    assert stats["timezone"] == "UTC"
    assert stats["total_sessions"] == 0
    assert (stats["from_date"], stats["to_date"]) == ("2026-01-09", "2026-01-15")
    r = await client.get("/pomodoro/stats", params={"from_date": "2024-01-01"})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "pomodoro.range_invalid"
    r = await client.get("/pomodoro/stats", params={"course_id": "nope"})
    assert r.status_code == 404


async def test_purge_removes_sessions_but_card_deletion_keeps_them(
    app: Any, client: AsyncClient, user: UserHandle, cards: FakeCards
):
    timer = cards.add(user.id, "pomodoro.timer", "program", await program(client))
    await client.post(
        "/pomodoro/sessions",
        json={
            "instance_id": timer,
            **session("2026-01-15T10:00:00Z", "2026-01-15T10:25:00Z", 1500),
        },
    )
    await events.dispatch(
        app.state,
        Event("layouts.card.deleted", {"instance_id": timer, "card_id": "pomodoro.timer"}, user.id),
    )
    assert (await client.get("/pomodoro/stats")).json()["total_sessions"] == 1
    await events.dispatch(app.state, Event("plugins.purge", {"plugin_id": "pomodoro"}, user.id))
    assert (await client.get("/pomodoro/stats")).json()["total_sessions"] == 0


async def test_course_statistics_follow_the_courses_program_zone(
    client: AsyncClient, user: UserHandle
):
    first = await program(client, "America/Toronto")
    second = await program(client, "Pacific/Auckland")
    aps = await course(client, second, "APS105")
    # The first Program is the fallback zone, but the course sits in the Auckland one.
    stats = (await client.get("/pomodoro/stats", params={"course_id": aps})).json()
    assert stats["timezone"] == "Pacific/Auckland"
    assert stats["today"] == "2026-01-16"  # 01:00 on Jan 16 there
    assert first != second
