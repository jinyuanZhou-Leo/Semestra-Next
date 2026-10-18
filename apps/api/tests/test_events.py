import asyncio
import json

import pytest
from fastapi import FastAPI
from httpx import AsyncClient

from semestra.core import realtime
from semestra.core.context import Ctx, run_after_commit, system_ctx
from semestra.core.events import Event, events
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

    assert seen == [("system", user.email, {"n": 1})]  # the failing subscriber did not stop it
    assert mine == [{"type": "test.thing.happened", "data": {"n": 1}}]
    assert theirs == []


async def test_slow_listener_gets_a_resync_instead_of_a_backlog():
    broadcaster = Broadcaster(queue_size=2)
    with broadcaster.listen("u") as queue:
        for n in range(3):
            broadcaster.send("u", {"type": "x", "data": {"n": n}})
        assert queue.get_nowait() == realtime.RESYNC
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
    assert [json.loads(r["data"]) for r in received] == [{"type": "x", "data": {}}]


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
