import asyncio
from datetime import timedelta
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from pydantic import BaseModel
from sqlalchemy import event, select, update

from semestra.core import jobs
from semestra.core.context import run_after_commit, system_ctx
from semestra.core.errors import AppError
from semestra.core.jobs import CoreJob, JobCtx, JobRunner, enqueue, job_handler, run_periodic
from semestra.testing import Clock, MakeUser, collect_events

calls: dict[str, int] = {}


class Payload(BaseModel):
    name: str = "x"


class Result(BaseModel):
    ok: bool = True


@job_handler("test.flaky")
async def flaky(ctx: JobCtx, payload: Payload) -> Result:
    calls[payload.name] = calls.get(payload.name, 0) + 1
    if calls[payload.name] == 1:
        raise RuntimeError("transient")
    return Result()


@job_handler("test.always_fails", max_attempts=2)
async def always_fails(ctx: JobCtx, payload: Payload) -> Result:
    raise RuntimeError("boom")


@job_handler("test.bad_input")
async def bad_input(ctx: JobCtx, payload: Payload) -> Result:
    raise AppError("test.bad_input", 422, field="name")


@job_handler("test.cancels_itself")
async def cancels_itself(ctx: JobCtx, payload: Payload) -> Result:
    ctx.db.add(CoreJob(user_id=ctx.user_id, kind="side-effect", payload={}, run_after=ctx.now,
                       created_at=ctx.now))  # fmt: skip
    async with ctx.state.session_factory() as db:
        await db.execute(
            update(CoreJob).where(CoreJob.id == ctx.job_id).values(cancel_requested=True)
        )
        await db.commit()
    await ctx.check_cancelled()
    return Result()


@job_handler("test.ok")
async def ok(ctx: JobCtx, payload: Payload) -> Result:
    assert ctx.user is not None
    assert ctx.actor == "system"
    return Result()


@job_handler("test.staged", stages=[("parsing", 1), ("ocr", 2), ("indexing", 1)])
async def staged(ctx: JobCtx, payload: Payload) -> Result:
    await ctx.stage("parsing", current=1, total=2)  # 1/2 of 1/4
    await ctx.stage("parsing", fraction=1)
    await ctx.skip_stage("ocr")  # remaining weight: parsing 1 + indexing 1
    await ctx.stage("indexing", current=0, total=4)
    await ctx.stage("indexing", current=3, total=4)
    with pytest.raises(ValueError, match="unknown stage"):
        await ctx.stage("nope")
    return Result()


async def start(app: FastAPI, user_id: str, kind: str, **kwargs: Any) -> str:
    async with system_ctx(app.state, user_id) as ctx:
        job = await enqueue(ctx, kind, Payload(name=kwargs.pop("name", kind)), **kwargs)
        await ctx.db.commit()
    await run_after_commit(ctx)
    return job.id


async def get(app: FastAPI, job_id: str) -> CoreJob:
    async with app.state.session_factory() as db:
        job = await db.get(CoreJob, job_id)
        assert job is not None
        return job


async def test_exceptions_retry_with_backoff(app: FastAPI, make_user: MakeUser, clock: Clock):
    user = await make_user()
    job_id = await start(app, user.id, "test.flaky", name="retry")
    await app.state.jobs.run_until_idle()

    job = await get(app, job_id)
    assert (job.status, job.attempts, job.error_code) == ("pending", 1, "common.internal")
    assert job.run_after == clock.now + timedelta(seconds=10)
    await app.state.jobs.run_until_idle()  # not due yet
    assert (await get(app, job_id)).attempts == 1

    clock.advance(seconds=10)
    await app.state.jobs.run_until_idle()
    job = await get(app, job_id)
    assert (job.status, job.attempts, job.error_code) == ("succeeded", 2, None)


async def test_gives_up_after_max_attempts(app: FastAPI, make_user: MakeUser, clock: Clock):
    user = await make_user()
    job_id = await start(app, user.id, "test.always_fails")
    await app.state.jobs.run_until_idle()
    clock.advance(minutes=1)
    await app.state.jobs.run_until_idle()
    job = await get(app, job_id)
    assert (job.status, job.attempts, job.error_code) == ("failed", 2, "common.internal")
    assert job.finished_at == clock.now


async def test_app_errors_fail_without_retry(app: FastAPI, make_user: MakeUser):
    user = await make_user()
    job_id = await start(app, user.id, "test.bad_input")
    await app.state.jobs.run_until_idle()
    job = await get(app, job_id)
    assert (job.status, job.attempts) == ("failed", 1)
    assert (job.error_code, job.error_params) == ("test.bad_input", {"field": "name"})


async def test_cancel_while_running_rolls_back_handler_writes(app: FastAPI, make_user: MakeUser):
    user = await make_user()
    job_id = await start(app, user.id, "test.cancels_itself")
    await app.state.jobs.run_until_idle()
    assert (await get(app, job_id)).status == "cancelled"
    async with app.state.session_factory() as db:
        assert await db.scalar(select(CoreJob).where(CoreJob.kind == "side-effect")) is None


async def test_lapsed_lease_is_retried_by_another_worker(
    app: FastAPI, make_user: MakeUser, clock: Clock
):
    user = await make_user()
    job_id = await start(app, user.id, "test.ok")
    crashed = JobRunner(app.state)
    assert await crashed._claim() is not None  # pyright: ignore[reportPrivateUsage]

    await app.state.jobs.run_until_idle()  # still leased
    assert (await get(app, job_id)).status == "running"
    clock.advance(seconds=61)
    await app.state.jobs.run_until_idle()
    job = await get(app, job_id)
    assert (job.status, job.attempts, job.lease_owner) == ("succeeded", 2, None)


async def test_lapsed_lease_without_attempts_left_fails(
    app: FastAPI, make_user: MakeUser, clock: Clock
):
    user = await make_user()
    job_id = await start(app, user.id, "test.always_fails")  # max_attempts=2
    for _ in range(2):
        assert await JobRunner(app.state)._claim() is not None  # pyright: ignore[reportPrivateUsage]
        clock.advance(seconds=61)
    await app.state.jobs.run_until_idle()
    job = await get(app, job_id)
    assert (job.status, job.error_code, job.attempts) == ("failed", "core.job_lease_expired", 2)


async def test_dedupe_key_returns_unfinished_job(app: FastAPI, make_user: MakeUser):
    user, other = await make_user(), await make_user(email="other@example.com")
    first = await start(app, user.id, "test.ok", dedupe_key="k")
    assert await start(app, user.id, "test.ok", dedupe_key="k") == first
    assert await start(app, other.id, "test.ok", dedupe_key="k") != first
    await app.state.jobs.run_until_idle()
    assert await start(app, user.id, "test.ok", dedupe_key="k") != first


async def test_concurrent_enqueues_with_one_dedupe_key_share_the_job(
    app: FastAPI, make_user: MakeUser
):
    user = await make_user()
    async with system_ctx(app.state, user.id) as a, system_ctx(app.state, user.id) as b:
        first = await enqueue(a, "test.ok", Payload(), dedupe_key="k")  # holds the write lock
        second = asyncio.create_task(enqueue(b, "test.ok", Payload(), dedupe_key="k"))
        await asyncio.sleep(0.05)  # b found nothing committed and waits for the lock
        await a.db.commit()
        assert (await second).id == first.id


async def test_cleanup_removes_old_finished_jobs(app: FastAPI, make_user: MakeUser, clock: Clock):
    user = await make_user()
    old = await start(app, user.id, "test.ok")
    await app.state.jobs.run_until_idle()
    clock.advance(days=8)
    pending = await start(app, user.id, "test.ok")
    await run_periodic(app.state, "core.cleanup")
    async with app.state.session_factory() as db:
        assert await db.get(CoreJob, old) is None
        assert await db.get(CoreJob, pending) is not None


async def test_list_is_paginated_newest_first(
    app: FastAPI, client: AsyncClient, make_user: MakeUser, login_as: Any
):
    user = await make_user()
    await login_as(client, user)
    ids = [await start(app, user.id, "test.ok") for _ in range(3)]
    page = (await client.get("/jobs", params={"limit": 2})).json()
    assert [j["id"] for j in page["items"]] == ids[:0:-1]
    rest = (await client.get("/jobs", params={"limit": 2, "cursor": page["next_cursor"]})).json()
    assert ([j["id"] for j in rest["items"]], rest["next_cursor"]) == ([ids[0]], None)
    filtered = (await client.get("/jobs", params={"status": "succeeded"})).json()
    assert filtered["items"] == []


async def test_worker_runs_jobs_in_the_background(
    app: FastAPI, client: AsyncClient, make_user: MakeUser
):
    user = await make_user()
    runner: JobRunner = app.state.jobs
    runner.start()
    try:
        assert (await client.get("/readyz")).json()["worker"] == "ok"
        job_id = await start(app, user.id, "test.ok")
        for _ in range(100):
            if (await get(app, job_id)).status == "succeeded":
                break
            await asyncio.sleep(0.02)
        assert (await get(app, job_id)).status == "succeeded"
    finally:
        await runner.stop()


def test_stage_declarations_are_validated():
    with pytest.raises(ValueError, match="unique and weights positive"):
        job_handler("test.dup", stages=[("a", 1), ("a", 2)])
    with pytest.raises(ValueError, match="unique and weights positive"):
        job_handler("test.zero", stages=[("a", 0)])


async def test_stages_are_weighted_and_skipped_without_going_back(
    app: FastAPI, make_user: MakeUser, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(jobs, "PROGRESS_THROTTLE_SECONDS", 0)
    user = await make_user()
    with collect_events(app, user.id) as messages:
        job_id = await start(app, user.id, "test.staged")
        await app.state.jobs.run_until_idle()
    running = [m["data"] for m in messages if m["data"].get("step")]
    assert [(u["step"], u["progress"], u["step_current"], u["step_total"]) for u in running] == [
        ("parsing", 12, 1, 2),
        ("parsing", 25, None, None),
        ("indexing", 50, 0, 4),  # ocr skipped: parsing is now half the job
        ("indexing", 87, 3, 4),
        ("indexing", 100, 3, 4),  # succeeded
    ]
    assert (await get(app, job_id)).status == "succeeded"


async def test_progress_within_a_stage_is_throttled(
    app: FastAPI, make_user: MakeUser, monkeypatch: pytest.MonkeyPatch
):
    now = [0.0]
    monkeypatch.setattr(jobs, "_monotonic", lambda: now[0])
    sent: list[dict[str, Any]] = []

    async def hook(values: dict[str, Any]) -> None:
        sent.append(values)

    async with system_ctx(app.state) as base:
        ctx = JobCtx(
            **{f: getattr(base, f) for f in base.__dataclass_fields__},
            stages=(("a", 1), ("b", 1)),
            progress_hook=hook,
        )
    await ctx.stage("a", current=1, total=10)
    await ctx.stage("a", current=2, total=10)  # dropped: same stage within 250 ms
    now[0] = 0.3
    await ctx.stage("a", current=3, total=10)
    await ctx.stage("b")  # stage changes are always sent
    assert [(v["step"], v["step_current"]) for v in sent] == [("a", 1), ("a", 3), ("b", None)]


async def test_an_idle_worker_only_reads(app: FastAPI, client: AsyncClient):
    del client  # starts the app
    statements: list[str] = []

    def record(*args: Any) -> None:
        statements.append(args[2])

    engine = app.state.engine.sync_engine
    event.listen(engine, "before_cursor_execute", record)
    try:
        assert await app.state.jobs.run_one() is False
    finally:
        event.remove(engine, "before_cursor_execute", record)
    assert statements
    assert all(s.lstrip().upper().startswith("SELECT") for s in statements)


async def test_sqlite_statistics_are_refreshed(app: FastAPI, client: AsyncClient):
    del client
    await run_periodic(app.state, "core.sqlite_optimize")
