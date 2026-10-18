"""Background jobs and periodic tasks (M00 §3.7).

* `@job_handler("files.parse")` registers `async def handler(ctx: JobCtx, payload: In) -> Out`.
* `await enqueue(ctx, "files.parse", In(...), dedupe_key=...)` adds a row to `core_jobs` inside
  the caller's transaction; workers pick it up after commit.
* Workers are asyncio tasks in the API process. A claimed job holds a lease that a heartbeat
  renews; if the process dies the lease runs out and another worker retries the job.
* An `AppError` from a handler fails the job at once (the input is wrong, retrying will not
  help). Any other exception is retried with exponential backoff up to `max_attempts`.
* Every state or progress change publishes `core.job.updated` to the job's owner (SSE).
* `@periodic("core.cleanup", every=timedelta(hours=1))` runs a function in this process.
"""

import asyncio
import contextlib
import inspect
import os
import socket
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Annotated, Any, Literal, get_type_hints

import structlog
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import (
    JSON,
    Boolean,
    ColumnElement,
    Index,
    Integer,
    String,
    UniqueConstraint,
    and_,
    case,
    delete,
    func,
    or_,
    select,
    update,
)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column
from starlette.datastructures import State

from semestra.core.capability import Http, capability
from semestra.core.context import Ctx, run_after_commit, run_as_system, system_ctx
from semestra.core.db import Base, OwnedMixin, UTCDateTime, new_id
from semestra.core.errors import AppError, not_found
from semestra.core.events import Event, events

log = structlog.get_logger()

JobStatus = Literal["pending", "running", "succeeded", "failed", "cancelled"]
TERMINAL: tuple[JobStatus, ...] = ("succeeded", "failed", "cancelled")
LEASE_SECONDS = 60
POLL_SECONDS = 2.0
RETENTION = timedelta(days=7)
JOB_UPDATED = "core.job.updated"


class CoreJob(Base, OwnedMixin):
    __tablename__ = "core_jobs"
    __table_args__ = (
        # Per user, so one user's key can never return another user's job.
        UniqueConstraint("user_id", "dedupe_key"),
        Index("ix_core_jobs_status_run_after", "status", "run_after"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    kind: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="pending")
    progress: Mapped[int] = mapped_column(Integer, default=0)
    step: Mapped[str | None] = mapped_column(String, default=None)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)
    result: Mapped[dict[str, Any] | None] = mapped_column(JSON, default=None)
    error_code: Mapped[str | None] = mapped_column(String, default=None)
    error_params: Mapped[dict[str, Any] | None] = mapped_column(JSON, default=None)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    lease_owner: Mapped[str | None] = mapped_column(String, default=None)
    lease_expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    # Not before this time (backoff between attempts).
    run_after: Mapped[datetime] = mapped_column(UTCDateTime)
    # Cleared when the job ends, so the same key can be enqueued again.
    dedupe_key: Mapped[str | None] = mapped_column(String, default=None)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime)
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)


class JobOut(BaseModel):
    id: str
    kind: str
    status: JobStatus
    progress: int
    step: str | None
    result: dict[str, Any] | None
    error_code: str | None
    error_params: dict[str, Any] | None
    attempts: int
    max_attempts: int
    cancel_requested: bool
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None

    @classmethod
    def of(cls, job: CoreJob) -> JobOut:
        return cls.model_validate(job, from_attributes=True)


class JobCancelled(Exception):
    """Raised by `JobCtx.check_cancelled()`; the job ends as `cancelled`."""


@dataclass
class JobCtx(Ctx):
    """`Ctx` for a job handler (actor "system", user = the job's owner) plus progress helpers.

    `db` is the handler's own transaction; it commits together with the job's success.
    Progress and cancellation use separate short transactions.
    """

    job_id: str = ""
    lease_owner: str = ""
    report_hook: Callable[[int, str | None], Awaitable[None]] | None = field(
        default=None, repr=False
    )

    async def report(self, progress: int, step: str | None = None) -> None:
        if self.report_hook is not None:
            await self.report_hook(max(0, min(100, progress)), step)

    async def check_cancelled(self) -> None:
        async with self.state.session_factory() as db:
            requested = await db.scalar(
                select(CoreJob.cancel_requested).where(CoreJob.id == self.job_id)
            )
        if requested is None or requested:
            raise JobCancelled


@dataclass(frozen=True)
class JobHandler:
    kind: str
    payload_model: type[BaseModel]
    fn: Callable[[JobCtx, Any], Awaitable[BaseModel]]
    max_attempts: int


_handlers: dict[str, JobHandler] = {}


def job_handler(
    kind: str, *, max_attempts: int = 3
) -> Callable[[Callable[[JobCtx, Any], Awaitable[Any]]], Callable[[JobCtx, Any], Awaitable[Any]]]:
    def decorate(
        fn: Callable[[JobCtx, Any], Awaitable[Any]],
    ) -> Callable[[JobCtx, Any], Awaitable[Any]]:
        if kind in _handlers:
            raise ValueError(f"duplicate job handler {kind!r}")
        hints = get_type_hints(fn)
        params = list(inspect.signature(fn).parameters)
        if len(params) != 2:
            raise TypeError(f"{kind}: a job handler takes (ctx, payload)")
        payload_model, result_model = hints[params[1]], hints["return"]
        for model in (payload_model, result_model):
            if not (isinstance(model, type) and issubclass(model, BaseModel)):
                raise TypeError(f"{kind}: payload and result must be Pydantic models")
        _handlers[kind] = JobHandler(kind, payload_model, fn, max_attempts)
        return fn

    return decorate


def _event(job: CoreJob) -> Event:
    data = {
        "id": job.id,
        "kind": job.kind,
        "status": job.status,
        "progress": job.progress,
        "step": job.step,
    }
    return Event(JOB_UPDATED, data, job.user_id)


async def enqueue(
    ctx: Ctx, kind: str, payload: BaseModel, *, dedupe_key: str | None = None
) -> CoreJob:
    """Add a job for the ctx user. With `dedupe_key`, an unfinished job with the same key is
    returned instead of adding a new one. Runs once the caller's transaction commits."""
    handler = _handlers.get(kind)
    if handler is None:
        raise ValueError(f"no job handler for {kind!r}")
    if not isinstance(payload, handler.payload_model):
        raise TypeError(f"{kind}: payload must be {handler.payload_model.__name__}")
    if dedupe_key is not None:
        existing = await ctx.db.scalar(
            select(CoreJob).where(CoreJob.user_id == ctx.user_id, CoreJob.dedupe_key == dedupe_key)
        )
        if existing is not None:
            return existing
    job = CoreJob(
        user_id=ctx.user_id,
        kind=kind,
        payload=payload.model_dump(mode="json"),
        max_attempts=handler.max_attempts,
        run_after=ctx.now,
        created_at=ctx.now,
        dedupe_key=dedupe_key,
    )
    ctx.db.add(job)
    await ctx.db.flush()
    await events.publish(ctx, JOB_UPDATED, _event(job).data)
    state = ctx.state

    async def _wake() -> None:
        runner: JobRunner | None = getattr(state, "jobs", None)
        if runner is not None:
            runner.wake()

    ctx.after_commit.append(_wake)
    return job


# --- periodic tasks -------------------------------------------------------------------------


@dataclass(frozen=True)
class PeriodicTask:
    name: str
    every: timedelta
    fn: Callable[[Ctx], Awaitable[None]]


_periodic: dict[str, PeriodicTask] = {}


def periodic(
    name: str, *, every: timedelta
) -> Callable[[Callable[[Ctx], Awaitable[None]]], Callable[[Ctx], Awaitable[None]]]:
    """Run `fn(ctx)` every `every` in a system ctx without a user (first run after one period)."""

    def decorate(fn: Callable[[Ctx], Awaitable[None]]) -> Callable[[Ctx], Awaitable[None]]:
        if name in _periodic:
            raise ValueError(f"duplicate periodic task {name!r}")
        _periodic[name] = PeriodicTask(name, every, fn)
        return fn

    return decorate


async def run_periodic(state: State, name: str) -> None:
    await run_as_system(state, None, _periodic[name].fn)


@periodic("core.cleanup", every=timedelta(hours=1))
async def cleanup_jobs(ctx: Ctx) -> None:
    """Finished jobs are kept for 7 days."""
    await ctx.db.execute(
        delete(CoreJob).where(
            CoreJob.status.in_(TERMINAL), CoreJob.finished_at < ctx.now - RETENTION
        )
    )


# --- worker ---------------------------------------------------------------------------------


def _end_values(now: datetime) -> dict[str, Any]:
    return {"finished_at": now, "lease_owner": None, "lease_expires_at": None, "dedupe_key": None}


def _backoff(attempts: int) -> timedelta:
    return timedelta(seconds=min(600, 10 * 2 ** (attempts - 1)))


class JobRunner:
    """Workers and the periodic scheduler for one process (`app.state.jobs`)."""

    def __init__(self, state: State, concurrency: int = 2) -> None:
        self.state = state
        self.concurrency = concurrency
        self.owner = f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:8]}"
        self._wake = asyncio.Event()
        self._tasks: list[asyncio.Task[None]] = []

    @property
    def running(self) -> bool:
        return bool(self._tasks) and not any(t.done() for t in self._tasks)

    def start(self) -> None:
        self._tasks = [asyncio.create_task(self._work()) for _ in range(self.concurrency)]
        self._tasks += [asyncio.create_task(self._schedule(t)) for t in _periodic.values()]

    async def stop(self) -> None:
        for task in self._tasks:
            task.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks = []

    def wake(self) -> None:
        self._wake.set()

    async def run_until_idle(self) -> None:
        """Run due jobs one by one until none is left (tests, CLI)."""
        while await self.run_one():
            pass

    async def _work(self) -> None:
        while True:
            self._wake.clear()
            try:
                worked = await self.run_one()
            except Exception:
                log.exception("job_worker_error")
                worked = False
            if not worked:
                with contextlib.suppress(TimeoutError):
                    await asyncio.wait_for(self._wake.wait(), POLL_SECONDS)

    async def _schedule(self, task: PeriodicTask) -> None:
        while True:
            await asyncio.sleep(task.every.total_seconds())
            try:
                await run_periodic(self.state, task.name)
            except Exception:
                log.exception("periodic_task_failed", task=task.name)

    async def run_one(self) -> bool:
        job = await self._claim()
        if job is None:
            return False
        await self._execute(job)
        return True

    async def _claim(self) -> CoreJob | None:
        now: datetime = self.state.now()
        lease_lapsed = and_(CoreJob.status == "running", CoreJob.lease_expires_at < now)
        async with self.state.session_factory() as db:
            # Jobs whose worker died: cancel if asked, fail if out of attempts.
            ended = (
                await db.scalars(
                    update(CoreJob)
                    .where(
                        lease_lapsed,
                        or_(CoreJob.cancel_requested, CoreJob.attempts >= CoreJob.max_attempts),
                    )
                    .values(
                        status=case((CoreJob.cancel_requested, "cancelled"), else_="failed"),
                        error_code=case(
                            (CoreJob.cancel_requested, None), else_="core.job_lease_expired"
                        ),
                        **_end_values(now),
                    )
                    .returning(CoreJob)
                )
            ).all()
            due = or_(and_(CoreJob.status == "pending", CoreJob.run_after <= now), lease_lapsed)
            pick = select(CoreJob.id).where(due).order_by(CoreJob.run_after).limit(1)
            job = await db.scalar(
                update(CoreJob)
                .where(CoreJob.id == pick.scalar_subquery(), due)
                .values(
                    status="running",
                    attempts=CoreJob.attempts + 1,
                    lease_owner=self.owner,
                    lease_expires_at=now + timedelta(seconds=LEASE_SECONDS),
                    started_at=func.coalesce(CoreJob.started_at, now),
                )
                .returning(CoreJob)
            )
            await db.commit()
        for row in ended:
            await events.dispatch(self.state, _event(row))
        if job is not None:
            await events.dispatch(self.state, _event(job))
        return job

    def _mine(self, job_id: str) -> ColumnElement[bool]:
        return and_(
            CoreJob.id == job_id, CoreJob.lease_owner == self.owner, CoreJob.status == "running"
        )

    async def _update(
        self, job_id: str, values: dict[str, Any], db: AsyncSession | None = None
    ) -> CoreJob | None:
        """Update a job this worker still holds; None if the lease was lost."""
        stmt = update(CoreJob).where(self._mine(job_id)).values(**values).returning(CoreJob)
        if db is not None:
            return await db.scalar(stmt)
        async with self.state.session_factory() as own:
            row = await own.scalar(stmt)
            await own.commit()
        return row

    async def _heartbeat(self, job_id: str) -> None:
        while True:
            await asyncio.sleep(LEASE_SECONDS / 3)
            lease = self.state.now() + timedelta(seconds=LEASE_SECONDS)
            try:
                await self._update(job_id, {"lease_expires_at": lease})
            except Exception:  # e.g. database busy: try again next beat
                log.exception("job_heartbeat_failed", job_id=job_id)

    async def _execute(self, job: CoreJob) -> None:
        heartbeat = asyncio.create_task(self._heartbeat(job.id))
        try:
            row = await self._run_handler(job)
        finally:
            heartbeat.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await heartbeat
        if row is not None:
            await events.dispatch(self.state, _event(row))

    async def _run_handler(self, job: CoreJob) -> CoreJob | None:
        handler = _handlers.get(job.kind)
        now: datetime = self.state.now()
        end = _end_values(now)
        if handler is None:
            return await self._update(
                job.id, {"status": "failed", "error_code": "core.job_unknown_kind", **end}
            )

        async def report(progress: int, step: str | None) -> None:
            row = await self._update(job.id, {"progress": progress, "step": step})
            if row is not None:
                await events.dispatch(self.state, _event(row))

        async with system_ctx(self.state, job.user_id) as base:
            ctx = JobCtx(
                **{f: getattr(base, f) for f in Ctx.__dataclass_fields__},
                job_id=job.id,
                lease_owner=self.owner,
                report_hook=report,
            )
            try:
                payload = handler.payload_model.model_validate(job.payload)
                result = await handler.fn(ctx, payload)
            except JobCancelled:
                await ctx.db.rollback()
                return await self._update(job.id, {"status": "cancelled", **end})
            except (AppError, ValidationError) as exc:
                await ctx.db.rollback()
                code, params = (
                    (exc.code, exc.params)
                    if isinstance(exc, AppError)
                    else ("common.validation", {})
                )
                return await self._update(
                    job.id,
                    {"status": "failed", "error_code": code, "error_params": params, **end},
                )
            except Exception:
                await ctx.db.rollback()
                log.exception("job_failed", job_id=job.id, kind=job.kind, attempt=job.attempts)
                error = {"error_code": "common.internal", "error_params": None}
                if job.attempts >= job.max_attempts:
                    return await self._update(job.id, {"status": "failed", **error, **end})
                retry = {
                    "status": "pending",
                    "run_after": now + _backoff(job.attempts),
                    "lease_owner": None,
                    "lease_expires_at": None,
                }
                return await self._update(job.id, {**retry, **error})
            # Success commits together with the handler's own writes.
            done = {
                "status": "succeeded",
                "progress": 100,
                "result": result.model_dump(mode="json"),
                "error_code": None,
                "error_params": None,
                **end,
            }
            row = await self._update(job.id, done, db=ctx.db)
            if row is None:
                await ctx.db.rollback()  # lease lost: another worker owns the job now
                return None
            await ctx.db.commit()
        await run_after_commit(ctx)
        return row


# --- capabilities ---------------------------------------------------------------------------


class JobRef(BaseModel):
    job_id: str = Field(description="Job id, as returned when the job was started.")


class JobListInput(BaseModel):
    status: JobStatus | None = Field(default=None, description="Only jobs in this state.")
    kind: str | None = Field(default=None, description="Only jobs of this kind, e.g. files.parse.")
    cursor: str | None = Field(default=None, description="`next_cursor` of the previous page.")
    limit: Annotated[int, Field(ge=1, le=100)] = Field(default=20, description="Page size.")


class JobPage(BaseModel):
    items: list[JobOut]
    next_cursor: str | None


async def _own_job(ctx: Ctx, job_id: str) -> CoreJob:
    job = await ctx.db.scalar(
        select(CoreJob).where(CoreJob.id == job_id, CoreJob.user_id == ctx.user_id)
    )
    if job is None:
        raise not_found()
    return job


@capability(
    name="core.job.get",
    summary="Get the state and progress of a background job.",
    description="""Use to check on a long-running operation (file parsing, imports, syncs) that
another capability started and returned a job id for.""",
    effect="read",
    http=Http("GET", "/jobs/{job_id}"),
    tags=("jobs",),
)
async def job_get(ctx: Ctx, inp: JobRef) -> JobOut:
    return JobOut.of(await _own_job(ctx, inp.job_id))


@capability(
    name="core.job.list",
    summary="List the user's background jobs, newest first.",
    description="""Use to find recent or running background operations and their outcome.
Do not use to read the data a job produced; use the capability of the module that owns it.""",
    effect="read",
    http=Http("GET", "/jobs"),
    tags=("jobs",),
)
async def job_list(ctx: Ctx, inp: JobListInput) -> JobPage:
    query = select(CoreJob).where(CoreJob.user_id == ctx.user_id)
    if inp.status is not None:
        query = query.where(CoreJob.status == inp.status)
    if inp.kind is not None:
        query = query.where(CoreJob.kind == inp.kind)
    if inp.cursor is not None:
        query = query.where(CoreJob.id < inp.cursor)
    rows = (await ctx.db.scalars(query.order_by(CoreJob.id.desc()).limit(inp.limit + 1))).all()
    items = [JobOut.of(r) for r in rows[: inp.limit]]
    return JobPage(items=items, next_cursor=items[-1].id if len(rows) > inp.limit else None)


@capability(
    name="core.job.cancel",
    summary="Cancel a pending or running background job.",
    description="""Use when the user wants to stop a background operation. A running job stops at
its next checkpoint, so it may still finish. Cancelling a finished job changes nothing.""",
    effect="write",
    http=Http("POST", "/jobs/{job_id}/cancel"),
    tags=("jobs",),
)
async def job_cancel(ctx: Ctx, inp: JobRef) -> JobOut:
    job = await _own_job(ctx, inp.job_id)
    if job.status == "pending":
        job.status = "cancelled"
        job.cancel_requested = True
        for key, value in _end_values(ctx.now).items():
            setattr(job, key, value)
    elif job.status == "running":
        job.cancel_requested = True
    else:
        return JobOut.of(job)
    await ctx.db.flush()
    await events.publish(ctx, JOB_UPDATED, _event(job).data)
    return JobOut.of(job)
