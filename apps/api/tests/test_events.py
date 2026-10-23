import asyncio
import json

import pytest
from fastapi import FastAPI
from httpx import AsyncClient

from semestra.core import realtime
from semestra.core.context import Ctx, run_after_commit, system_ctx
from semestra.core.events import Event, drain, events
from semestra.core.realtime import Broadcaster, stream
from semestra.testing import MakeUser, collect_events

seen: list[tuple[str, str | None, dict[str, object]]] = []


@events.subscribe("test.thing.happened")
async def _broken(ctx: Ctx, event: Event) -> None:
    raise RuntimeError("subscriber bug")


@events.subscribe("test.thing.happened")
async def _record(ctx: Ctx, event: Event) -> None:
    seen.append((ctx.actor, ctx.user.email if ctx.user else None, event.data))


async def test_events_are_dispatched_after_commit_to_subscribers_and_sse(
    app: FastAPI, make_user: MakeUser
):
    seen.clear()
    user, other = await make_user(), await make_user(email="other@example.com")
    with collect_events(app, user.id) as mine, collect_events(app, other.id) as theirs:
        async with system_ctx(app.state, user.id) as ctx:
            await events.publish(ctx, "test.thing.happened", {"n": 1})
            assert seen == []  # nothing before commit
            await ctx.db.commit()
        await run_after_commit(ctx)
        assert seen == []  # the publisher does not wait for the subscribers
        await drain(app.state)

    assert seen == [("system", user.email, {"n": 1})]  # the failing subscriber did not stop it
    assert mine == [{"type": "test.thing.happened", "data": {"n": 1}}]
    assert theirs == []


async def test_slow_listener_gets_a_resync_instead_of_a_backlog():
    broadcaster = Broadcaster(queue_size=2)
    with broadcaster.listen("u") as queue:
        for n in range(3):
            broadcaster.send("u", {"type": "x", "data": {"n": n}})
        assert queue.get_nowait()[1]["type"] == realtime.RESYNC_TYPE
        assert queue.empty()


async def test_a_reconnecting_listener_gets_what_it_missed():
    broadcaster = Broadcaster(replay_size=3)
    with broadcaster.listen("u") as queue:
        broadcaster.send("u", {"type": "a", "data": {}})
        last_id, _ = queue.get_nowait()
    for kind in ("b", "c"):
        broadcaster.send("u", {"type": kind, "data": {}})
    broadcaster.send("other", {"type": "theirs", "data": {}})
    with broadcaster.listen("u", last_id) as queue:
        assert [queue.get_nowait()[1]["type"] for _ in range(2)] == ["b", "c"]
        assert queue.empty()
    # A new connection replays nothing; an id from before the buffer or a restart resyncs.
    with broadcaster.listen("u") as queue:
        assert queue.empty()
    for kind in ("d", "e", "f"):
        broadcaster.send("u", {"type": kind, "data": {}})
    for stale in (last_id, "restarted-1", "garbage"):
        with broadcaster.listen("u", stale) as queue:
            assert queue.get_nowait()[1]["type"] == realtime.RESYNC_TYPE
            assert queue.empty()


async def test_stream_yields_messages_and_ends_after_max_time():
    broadcaster = Broadcaster()
    received: list[dict[str, str]] = []

    async def consume() -> None:
        async for item in stream(broadcaster, "u", max_seconds=0.2):
            received.append(item)

    task = asyncio.create_task(consume())
    await asyncio.sleep(0.05)
    broadcaster.send("u", {"type": "x", "data": {}})
    await asyncio.wait_for(task, 1)
    assert received[0] == {"id": broadcaster.current_id("u").replace("-1", "-0")}
    assert [json.loads(r["data"]) for r in received[1:]] == [{"type": "x", "data": {}}]
    assert received[1]["id"].endswith("-1")


async def test_a_stream_that_received_nothing_still_resumes_where_it_left_off():
    broadcaster = Broadcaster()
    first = stream(broadcaster, "u", max_seconds=60)
    opening = await anext(first)
    assert "data" not in opening  # sets the EventSource's last id, fires no message
    await first.aclose()
    broadcaster.send("u", {"type": "x", "data": {}})  # while reconnecting
    with broadcaster.listen("u", opening["id"]) as queue:
        assert queue.get_nowait()[1]["type"] == "x"
        assert queue.empty()


async def test_a_replay_keeps_only_the_latest_progress_of_each_job():
    broadcaster = Broadcaster(replay_size=3)
    start = broadcaster.current_id("u")
    for job, n in (("a", 1), ("b", 1), ("a", 2), ("a", 3)):
        broadcaster.send("u", {"type": "core.job.progress", "data": {"job_id": job, "n": n}})
    broadcaster.send("u", {"type": "x", "data": {}})
    with broadcaster.listen("u", start) as queue:
        got = [queue.get_nowait()[1] for _ in range(queue.qsize())]
    assert got == [
        {"type": "core.job.progress", "data": {"job_id": "b", "n": 1}},
        {"type": "core.job.progress", "data": {"job_id": "a", "n": 3}},
        {"type": "x", "data": {}},
    ]


async def test_a_user_without_connections_is_forgotten_after_a_while():
    now = 0.0
    broadcaster = Broadcaster(keep_idle_seconds=60, clock=lambda: now)
    with broadcaster.listen("u"):
        broadcaster.send("u", {"type": "x", "data": {}})
        last_id = broadcaster.current_id("u")
        now = 120.0
        broadcaster.send("other", {"type": "y", "data": {}})  # still connected: kept
    with broadcaster.listen("u", last_id) as queue:
        assert queue.empty()  # nothing missed, nothing resynced
    now = 240.0
    broadcaster.send("other", {"type": "y", "data": {}})
    assert set(broadcaster._logs) == {"other"}  # pyright: ignore[reportPrivateUsage]
    # An id from the dropped log can't say what was missed: refetch everything.
    with broadcaster.listen("u", last_id) as queue:
        assert queue.get_nowait()[1]["type"] == realtime.RESYNC_TYPE


async def test_events_carry_the_tab_that_caused_them(
    app: FastAPI, client: AsyncClient, make_user: MakeUser, login_as: object
):
    user = await make_user()
    await login_as(client, user)  # pyright: ignore[reportCallIssue]
    url, body = "/me/settings/calendar", {"values": {"default_view": "month"}}
    with collect_events(app, user.id) as mine:
        r = await client.patch(url, json=body, headers={"X-Semestra-Client": "tab-1"})
        assert r.status_code == 200, r.text
        await client.patch(url, json=body)
        await client.patch(url, json=body, headers={"X-Semestra-Client": "not a tab id!"})
    assert [m.get("origin") for m in mine] == ["tab-1", None, None]


async def test_events_stream_requires_login(client: AsyncClient):
    r = await client.get("/events/stream")
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "common.unauthenticated"


async def test_events_stream_opens_for_signed_in_user(
    client: AsyncClient, make_user: MakeUser, login_as: object, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(realtime, "STREAM_MAX_SECONDS", 0.05)
    await login_as(client, await make_user())  # pyright: ignore[reportCallIssue]
    r = await client.get("/events/stream")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/event-stream")
