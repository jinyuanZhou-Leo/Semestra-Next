"""Background jobs and periodic tasks (M00 §3.7).

* `@job_handler("files.parse", stages=[("parsing", 25), ("ocr", 30)])` registers
  `async def handler(ctx: JobCtx, payload: In) -> Out`. Handlers that take more than a few
  seconds declare weighted stages and call `ctx.stage(...)` / `ctx.skip_stage(...)`; the overall
  percentage is computed here, never by the frontend.
* `await enqueue(ctx, "files.parse", In(...), dedupe_key=...)` adds a row to `core_jobs` inside
  the caller's transaction; workers pick it up after commit. A job with the same key that has
  not started yet stands for the new request; one already running may have read what the request
  is about before it changed, so with `again=True` it runs once more after it ends (succeeded or
  failed, not cancelled), with the last such request's payload.
* Workers are asyncio tasks in the API process. A claimed job holds a lease that a heartbeat
  renews; if the process dies the lease runs out and another worker retries the job.
* An `AppError` from a handler fails the job at once (the input is wrong, retrying will not
  help). Any other exception is retried with exponential backoff up to `max_attempts`.
* `on_failure=fn` (`async def fn(ctx, payload, job)`) runs once when the job ends `failed` or
  `cancelled`, whatever ended it: the handler, a cancel before it started, or a worker that died
  (its lease ran out). A module that keeps its own copy of the job's state (a file "processing",
  an import "extracting") sets it there, so the copy never outlives the job.
* Every state or progress change publishes `core.job.progress` to the job's owner (SSE);
  progress-only updates are throttled to one per 250 ms.
* `@periodic("core.cleanup", every=timedelta(hours=1))` runs a function in this process.
* Jobs run in lanes. `default` is for the jobs a user is waiting on (an import, a new file);
  `bulk` for minutes to hours of work (rebuilding every vector, model downloads), which may hold
  at most `job_bulk_concurrency` of the `job_concurrency` workers, so the others stay free;
  `background` for work nobody waits on (the LMS course sync, reading the files it brings),
  run by `job_background_concurrency` workers of its own, so a queue of it never delays the
  others even on a server with a single worker.
* Due jobs run oldest first, except that kinds of a lower `priority` wait for the others: the
  files a course sync brings (hundreds at first) are stored (`priority=-1`) and read (`-2`)
  after any sync queued since, however few workers there are; with several workers, one of a
  lower priority also waits while one of a higher priority of the same user and lanes still
  runs (`_behind`), so a file is read only once its copy is stored. Within a priority users take
  turns: the user served least lately goes first, so one user's hundreds of jobs never hold
  back another's (`_first`).
* `job_handler(at_once=n)`: at most n jobs of the kind run at once on the server, whatever the
  workers of its lane: a lane's workers say how much of its waiting may overlap, and a kind that
  works the machine (parsing a file) keeps to what its lane promised the others (`_full`).
* `async with waiting("ai.rate_limited", until=...)` inside a job tells its owner what the job is
  waiting for (`JobOut.waiting`); kept in memory, as it changes too often to be worth a write.
"""

import asyncio
import contextlib
import inspect
import os
import socket
import time
import uuid
from collections.abc import AsyncGenerator, Awaitable, Callable, Iterable, Sequence
from contextvars import ContextVar
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
    false,
    func,
    not_,
    or_,
    select,
    text,
    true,
    update,
)
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, aliased, mapped_column
from sqlalchemy.sql import Subquery
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
# Picks a claim makes before leaving the jobs to the next poll (each lost to another worker).
CLAIM_TRIES = 3
RETENTION = timedelta(days=7)
JOB_PROGRESS = "core.job.progress"
JOB_FINISHED = "core.job.finished"
PROGRESS_THROTTLE_SECONDS = 0.25
_monotonic = time.monotonic  # patched in tests


class CoreJob(Base, OwnedMixin):
    __tablename__ = "core_jobs"
    __table_args__ = (
        # Per user, so one user's key can never return another user's job.
        UniqueConstraint("user_id", "dedupe_key"),
        Index("ix_core_jobs_status_run_after", "status", "run_after"),
        # Each user's last turn (`_first`).
        Index("ix_core_jobs_user_claimed", "user_id", "claimed_at"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    kind: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="pending")
    progress: Mapped[int] = mapped_column(Integer, default=0)
    step: Mapped[str | None] = mapped_column(String, default=None)  # current stage key
    # Count within the stage, e.g. OCR page 3 of 12.
    step_current: Mapped[int | None] = mapped_column(Integer, default=None)
    step_total: Mapped[int | None] = mapped_column(Integer, default=None)
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
    # Asked for again while it ran (`enqueue(..., again=True)`): the payload of the job that
    # follows it once it ends.
    next_payload: Mapped[dict[str, Any] | None] = mapped_column(JSON, default=None)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime)
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    # When a worker last took it (each attempt; `started_at` keeps the first).
    claimed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)


Lane = Literal["default", "background", "bulk"]
LANES: frozenset[Lane] = frozenset(("default", "background", "bulk"))
# What the workers of `job_concurrency` take; `background` jobs have workers of their own.
FOREGROUND: frozenset[Lane] = frozenset(("default", "bulk"))
BACKGROUND: frozenset[Lane] = frozenset(("background",))


class JobWaiting(BaseModel):
    reason: str = Field(
        description="What the running job waits for: `ai.provider_busy` (the provider's limit of "
        "requests at a time) or `ai.rate_limited`."
    )
    until: datetime | None = Field(default=None, description="When it expects to go on, if known.")


class JobOut(BaseModel):
    id: str
    kind: str
    status: JobStatus
    progress: int
    step: str | None
    step_current: int | None
    step_total: int | None
    result: dict[str, Any] | None
    error_code: str | None
    error_params: dict[str, Any] | None
    attempts: int
    max_attempts: int
    cancel_requested: bool
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    waiting: JobWaiting | None = None
    # Its stages are named like this kind's (`job_handler(labels=…)`); None: its own.
    label_kind: str | None = None

    @classmethod
    def of(cls, job: CoreJob) -> JobOut:
        out = cls.model_validate(job, from_attributes=True)
        handler = _handlers.get(job.kind)
        out.label_kind = handler.labels if handler else None
        if job.status == "running":
            out.waiting = _waiting_now(job.id)
        return out


# --- what a running job waits for -----------------------------------------------------------

# Job id → what it waits for, newest last (pages read side by side may each wait).
_waits: dict[str, list[JobWaiting]] = {}


@dataclass(frozen=True)
class _Running:
    job_id: str
    notify: Callable[[], Awaitable[None]]
    lane: Lane = "default"


_running: ContextVar[_Running | None] = ContextVar("semestra_running_job", default=None)


def _waiting_now(job_id: str) -> JobWaiting | None:
    waits = _waits.get(job_id)
    return waits[-1] if waits else None


def in_job() -> bool:
    """Whether this code runs inside a job handler (background work may wait longer)."""
    return _running.get() is not None


def in_background() -> bool:
    """Whether this code runs inside a job of the `background` lane: work nobody waits on, which
    gives way to work someone does where they share something scarce (M09's request gate)."""
    running = _running.get()
    return running is not None and running.lane == "background"


@contextlib.asynccontextmanager
async def waiting(reason: str, *, until: datetime | None = None) -> AsyncGenerator[None]:
    """Shows the owner that the job is waiting (`JobOut.waiting`) while the block runs. Does
    nothing outside a job."""
    job = _running.get()
    if job is None:
        yield
        return
    entry = JobWaiting(reason=reason, until=until)
    _waits.setdefault(job.job_id, []).append(entry)
    await job.notify()
    try:
        yield
    except BaseException:
        _forget(job.job_id, entry)
        raise
    _forget(job.job_id, entry)
    await job.notify()


def _forget(job_id: str, entry: JobWaiting) -> None:
    waits = _waits.get(job_id, [])
    if entry in waits:
        waits.remove(entry)
    if not waits:
        _waits.pop(job_id, None)


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
    stages: tuple[tuple[str, float], ...] = ()
    progress_hook: Callable[[dict[str, Any]], Awaitable[None]] | None = field(
        default=None, repr=False
    )
    _progress: float = field(default=0.0, repr=False)
    _skipped: set[str] = field(default_factory=lambda: set[str](), repr=False)
    _last_step: str | None = field(default=None, repr=False)
    _last_sent: float = field(default=-1.0, repr=False)

    async def stage(
        self,
        key: str,
        *,
        current: int | None = None,
        total: int | None = None,
        fraction: float | None = None,
    ) -> None:
        """Enter stage `key` or report progress within it (`current`/`total`, or `fraction`)."""
        keys = [k for k, _ in self.stages]
        if key not in keys:
            raise ValueError(f"unknown stage {key!r} (declared: {keys})")
        if fraction is None:
            fraction = current / total if current is not None and total else 0.0
        weights = {k: w for k, w in self.stages if k not in self._skipped}
        done = sum(weights.get(k, 0.0) for k in keys[: keys.index(key)])
        within = weights.get(key, 0.0) * max(0.0, min(1.0, fraction))
        total_weight = sum(weights.values()) or 1.0
        await self._emit(100 * (done + within) / total_weight, key, current, total)

    async def skip_stage(self, key: str) -> None:
        """The stage will not run; its weight goes to the others (progress never goes back)."""
        self._skipped.add(key)

    async def _emit(
        self, progress: float, step: str | None, current: int | None, total: int | None
    ) -> None:
        self._progress = max(self._progress, max(0.0, min(100.0, progress)))
        now = _monotonic()
        if step == self._last_step and now - self._last_sent < PROGRESS_THROTTLE_SECONDS:
            return
        self._last_step, self._last_sent = step, now
        if self.progress_hook is not None:
            values = {
                "progress": int(self._progress),
                "step": step,
                "step_current": current,
                "step_total": total,
            }
            await self.progress_hook(values)

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
    stages: tuple[tuple[str, float], ...]
    lane: Lane = "default"
    on_failure: OnFailure | None = None
    # False: left out of `core.job.list` (the status bar's list); its module shows it its own way.
    listed: bool = True
    # Another kind whose stage names it shares (the same work queued in another lane).
    labels: str | None = None
    # Due jobs of a higher priority are taken first, whatever their age (default 0).
    priority: int = 0
    # At most this many of the kind run at once (None: as many as its lane's workers).
    at_once: int | None = None


OnFailure = Callable[[Ctx, Any, "CoreJob"], Awaitable[None]]
_handlers: dict[str, JobHandler] = {}


def job_handler(
    kind: str,
    *,
    max_attempts: int = 3,
    stages: Sequence[tuple[str, float]] = (),
    lane: Lane = "default",
    on_failure: OnFailure | None = None,
    listed: bool = True,
    labels: str | None = None,
    priority: int = 0,
    at_once: int | None = None,
) -> Callable[[Callable[[JobCtx, Any], Awaitable[Any]]], Callable[[JobCtx, Any], Awaitable[Any]]]:
    keys = [k for k, _ in stages]
    if len(set(keys)) != len(keys) or any(w <= 0 for _, w in stages):
        raise ValueError(f"{kind}: stage keys must be unique and weights positive")

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
        _handlers[kind] = JobHandler(
            kind,
            payload_model,
            fn,
            max_attempts,
            tuple(stages),
            lane,
            on_failure,
            listed,
            labels,
            priority,
            at_once,
        )
        return fn

    return decorate


def _event(job: CoreJob) -> Event:
    waiting = _waiting_now(job.id) if job.status == "running" else None
    data = {
        "job_id": job.id,
        "kind": job.kind,
        "status": job.status,
        "progress": job.progress,
        "step": job.step,
        "step_current": job.step_current,
        "step_total": job.step_total,
        "finished_at": job.finished_at.isoformat() if job.finished_at else None,
        "waiting": waiting.model_dump(mode="json") if waiting else None,
    }
    return Event(JOB_PROGRESS, data, job.user_id)


def _finished(job: CoreJob) -> Event:
    """`core.job.finished`: once per job, however it ended, for subscribers that care about
    outcomes (notifications) rather than progress."""
    data = {"job_id": job.id, "kind": job.kind, "status": job.status, "error_code": job.error_code}
    return Event(JOB_FINISHED, data, job.user_id)


async def _on_failure(ctx: Ctx, job: CoreJob) -> None:
    """The handler's `on_failure` for a job that has ended failed or cancelled, in `ctx`'s
    transaction."""
    handler = _handlers.get(job.kind)
    if handler is None or handler.on_failure is None or job.status not in ("failed", "cancelled"):
        return  # succeeded, or pending again after a crash it will be retried from
    try:
        payload = handler.payload_model.model_validate(job.payload)
    except ValidationError:
        return  # nothing to clean up for a payload the handler could never have run with
    await handler.on_failure(ctx, payload, job)


async def enqueue(
    ctx: Ctx,
    kind: str,
    payload: BaseModel,
    *,
    dedupe_key: str | None = None,
    run_after: datetime | None = None,
    again: bool = False,
) -> CoreJob:
    """Add a job for the ctx user. With `dedupe_key`, an unfinished job with the same key is
    returned instead of adding a new one; with `again` too, one already running runs once more
    after it ends (see the module docstring). Runs once the caller's transaction commits, or not
    before `run_after`."""
    handler = _handlers.get(kind)
    if handler is None:
        raise ValueError(f"no job handler for {kind!r}")
    if not isinstance(payload, handler.payload_model):
        raise TypeError(f"{kind}: payload must be {handler.payload_model.__name__}")
    values: dict[str, Any] = {
        "user_id": ctx.user_id,
        "kind": kind,
        "payload": payload.model_dump(mode="json"),
        "max_attempts": handler.max_attempts,
        "run_after": run_after or ctx.now,
        "created_at": ctx.now,
        "dedupe_key": dedupe_key,
    }
    if dedupe_key is None:
        job = CoreJob(**values)
        ctx.db.add(job)
        await ctx.db.flush()
    else:
        # Atomic, so two concurrent submissions with one key both get the same job.
        inserted = await ctx.db.scalar(
            sqlite_insert(CoreJob)
            .values(**values)
            .on_conflict_do_nothing(index_elements=["user_id", "dedupe_key"])
            .returning(CoreJob)
        )
        if inserted is None:
            existing = await ctx.db.scalar(
                select(CoreJob).where(
                    CoreJob.user_id == ctx.user_id, CoreJob.dedupe_key == dedupe_key
                )
            )
            assert existing is not None
            if again and existing.status == "running":
                existing.next_payload = values["payload"]
                await ctx.db.flush()
            return existing
        job = inserted
    await events.publish(ctx, JOB_PROGRESS, _event(job).data)
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
    first_after: timedelta | None = None


_periodic: dict[str, PeriodicTask] = {}


def periodic(
    name: str, *, every: timedelta, first_after: timedelta | None = None
) -> Callable[[Callable[[Ctx], Awaitable[None]]], Callable[[Ctx], Awaitable[None]]]:
    """Run `fn(ctx)` every `every` in a system ctx without a user (first run after one period,
    or after `first_after` for a task that should not wait a whole period after each start)."""

    def decorate(fn: Callable[[Ctx], Awaitable[None]]) -> Callable[[Ctx], Awaitable[None]]:
        if name in _periodic:
            raise ValueError(f"duplicate periodic task {name!r}")
        _periodic[name] = PeriodicTask(name, every, fn, first_after)
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


# Soon after start too: a local app restarts often and may never stay up for six hours.
@periodic("core.sqlite_optimize", every=timedelta(hours=6), first_after=timedelta(minutes=1))
async def optimize_sqlite(ctx: Ctx) -> None:
    """Keeps SQLite's query planner statistics current (what the SQLite docs advise for
    long-lived connections); cheap when nothing changed. 0x10000 looks at every table, not
    only those the pooled connection it happens to get has queried."""
    if ctx.db.get_bind().dialect.name == "sqlite":
        await ctx.db.execute(text("PRAGMA optimize=0x10002"))


# --- worker ---------------------------------------------------------------------------------


def _lane(kind: str) -> Lane:
    handler = _handlers.get(kind)
    return handler.lane if handler else "default"


def _kinds(lanes: Iterable[Lane]) -> list[str]:
    wanted = set(lanes)
    return [kind for kind, handler in _handlers.items() if handler.lane in wanted]


def _in_lanes(lanes: frozenset[Lane], kind: Any = None) -> ColumnElement[bool]:
    """Jobs of these lanes (a kind with no handler counts as `default`, as in `_lane`)."""
    if closed := LANES - lanes:
        return (CoreJob.kind if kind is None else kind).not_in(_kinds(closed))
    return true()


def _priority(kind: Any) -> Any:
    ranked = {k: h.priority for k, h in _handlers.items() if h.priority}
    return case(ranked, value=kind, else_=0) if ranked else None


def _behind(lanes: frozenset[Lane], now: datetime) -> ColumnElement[bool]:
    """A job that a running job of the same user and lanes, of a higher priority, holds back:
    the files a sync brings are read after their copies are stored, not while (M00 §3.7)."""
    mine = _priority(CoreJob.kind)
    if mine is None:
        return false()
    other = aliased(CoreJob)
    return (
        select(other.id)
        .where(
            other.status == "running",
            other.lease_expires_at >= now,
            other.user_id == CoreJob.user_id,
            _in_lanes(lanes, other.kind),
            _priority(other.kind) > mine,
        )
        .exists()
    )


def _full(now: datetime) -> ColumnElement[bool]:
    """A job of a kind that already runs its `at_once` jobs (checked again as it is taken, in
    the same statement, so two workers never both take the last place)."""
    full: list[ColumnElement[bool]] = []
    for kind, handler in _handlers.items():
        if handler.at_once is None:
            continue
        other = aliased(CoreJob)
        running = (
            select(func.count())
            .select_from(other)
            .where(other.kind == kind, other.status == "running", other.lease_expires_at >= now)
            .scalar_subquery()
        )
        full.append(and_(CoreJob.kind == kind, running >= handler.at_once))
    return or_(*full) if full else false()


def _first(
    lanes: frozenset[Lane], due: ColumnElement[bool], several: bool
) -> tuple[Subquery | None, tuple[Any, ...]]:
    """The order `due` jobs of these lanes are taken in (M00 §3.7): higher priority; then, when
    `several` users have due jobs, the one whose last turn in these lanes (the latest
    `claimed_at` of their jobs there) is the oldest, one never served first, so users take
    turns; then the oldest; then the first made. Returns the users' last turns (to outer-join on
    `user_id`; none for a single user) and the order."""
    ranked = {kind: h.priority for kind, h in _handlers.items() if h.priority}
    priority = (case(ranked, value=CoreJob.kind, else_=0).desc(),) if ranked else ()
    if not several:
        return None, (*priority, CoreJob.run_after, CoreJob.id)
    turns = (
        select(CoreJob.user_id.label("user_id"), func.max(CoreJob.claimed_at).label("at"))
        .where(
            CoreJob.user_id.in_(select(CoreJob.user_id).where(due).distinct()),
            CoreJob.claimed_at.is_not(None),
            _in_lanes(lanes),
        )
        .group_by(CoreJob.user_id)
        .subquery("turns")
    )
    return turns, (*priority, turns.c.at.asc().nulls_first(), CoreJob.run_after, CoreJob.id)


async def _ended(state: State, job: CoreJob) -> None:
    """After a write to a job has committed: its progress event, and `core.job.finished` once it
    has ended."""
    await events.dispatch(state, _event(job))
    if job.status in TERMINAL:
        await events.dispatch(state, _finished(job))


async def _discard(ctx: Ctx) -> None:
    """Roll back `ctx`'s transaction, with the side effects it had queued. The user is read
    again (a rollback expires it), so what runs after (`on_failure`, the job that follows)
    still has `ctx.user_id`."""
    await ctx.db.rollback()
    ctx.after_commit.clear()
    if ctx.user is not None:
        await ctx.db.refresh(ctx.user)


def _lease_lapsed(now: datetime) -> ColumnElement[bool]:
    return and_(CoreJob.status == "running", CoreJob.lease_expires_at < now)


_GIVE_UP = or_(CoreJob.cancel_requested, CoreJob.attempts >= CoreJob.max_attempts)


def _end_values(now: datetime) -> dict[str, Any]:
    return {"finished_at": now, "lease_owner": None, "lease_expires_at": None, "dedupe_key": None}


async def _run_again(ctx: Ctx, job: CoreJob, dedupe_key: str | None) -> None:
    """A job asked for again while it ran (`next_payload`) that has now ended: the one that
    follows it, in the transaction that ends it. Not after a cancel: the user stopped it."""
    handler = _handlers.get(job.kind)
    if job.next_payload is None or job.status not in ("succeeded", "failed") or handler is None:
        return
    try:
        payload = handler.payload_model.model_validate(job.next_payload)
    except ValidationError:
        return
    await enqueue(ctx, job.kind, payload, dedupe_key=dedupe_key)


def _backoff(attempts: int) -> timedelta:
    return timedelta(seconds=min(600, 10 * 2 ** (attempts - 1)))


class JobRunner:
    """Workers and the periodic scheduler for one process (`app.state.jobs`)."""

    def __init__(
        self, state: State, concurrency: int = 2, bulk: int = 1, background: int = 1
    ) -> None:
        self.state = state
        # Workers for `default` and `bulk` jobs; bulk ones may hold at most `bulk` of them, so
        # at least one is left for the others (unless there is one).
        self.concurrency = concurrency
        self.bulk = max(1, min(bulk, concurrency - 1))
        self._bulk_running = 0
        # Workers of their own for `background` jobs (they mostly wait on the network): a
        # queue of them never delays the others, however few workers those have.
        self.background = max(1, background)
        self.owner = f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:8]}"
        self._wake = asyncio.Event()
        self._tasks: list[asyncio.Task[None]] = []

    @property
    def running(self) -> bool:
        return bool(self._tasks) and not any(t.done() for t in self._tasks)

    def start(self) -> None:
        self._tasks = [
            *(asyncio.create_task(self._work(FOREGROUND)) for _ in range(self.concurrency)),
            *(asyncio.create_task(self._work(BACKGROUND)) for _ in range(self.background)),
            *(asyncio.create_task(self._schedule(t)) for t in _periodic.values()),
        ]

    async def stop(self) -> None:
        for task in self._tasks:
            task.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks = []

    def wake(self) -> None:
        self._wake.set()

    async def run_until_idle(self) -> None:
        """Run due jobs of every lane one by one until none is left (tests, CLI)."""
        while await self.run_one(LANES):
            pass

    async def _work(self, lanes: frozenset[Lane]) -> None:
        while True:
            self._wake.clear()
            try:
                worked = await self.run_one(lanes)
            except Exception:
                log.exception("job_worker_error")
                worked = False
            if not worked:
                with contextlib.suppress(TimeoutError):
                    await asyncio.wait_for(self._wake.wait(), POLL_SECONDS)

    async def _schedule(self, task: PeriodicTask) -> None:
        wait = task.first_after or task.every
        while True:
            await asyncio.sleep(wait.total_seconds())
            wait = task.every
            try:
                await run_periodic(self.state, task.name)
            except Exception:
                log.exception("periodic_task_failed", task=task.name)

    async def run_one(self, lanes: frozenset[Lane] = FOREGROUND) -> bool:
        """Runs one due job of these lanes; False when there is none."""
        # A bulk slot is taken before claiming (no await in between), so two workers polling at
        # once cannot both start a bulk job; it is given back when the job is not one.
        held = "bulk" in lanes and self._bulk_running < self.bulk
        if held:
            self._bulk_running += 1
        open_lanes = lanes if held else lanes - {"bulk"}
        try:
            job = await self._claim(open_lanes)
            if held and job is not None and _lane(job.kind) != "bulk":
                self._bulk_running -= 1
                held = False
            if job is None:
                return False
            await self._execute(job)
            return True
        finally:
            if held:
                self._bulk_running -= 1

    async def _claim(self, lanes: frozenset[Lane] = LANES) -> CoreJob | None:
        now: datetime = self.state.now()
        # A job whose worker died runs again, unless it was asked to stop or is out of attempts:
        # then it ends, each in its own transaction with its `on_failure`.
        lapsed = _lease_lapsed(now)
        due = and_(
            or_(and_(CoreJob.status == "pending", CoreJob.run_after <= now), lapsed),
            _in_lanes(lanes),
            not_(_behind(lanes, now)),
            not_(_full(now)),
        )
        async with self.state.session_factory() as db:
            # Most polls find nothing: check with a read first, so an idle worker does not take
            # SQLite's write lock every POLL_SECONDS.
            if await db.scalar(select(CoreJob.id).where(due).limit(1)) is None:
                return None
            ending = (
                await db.execute(select(CoreJob.id, CoreJob.user_id).where(lapsed, _GIVE_UP))
            ).all()
        for job_id, user_id in ending:
            await self._end_lapsed(job_id, user_id, now)
        # One that could not be ended (its `on_failure` failed) is left for the next poll.
        due = and_(due, not_(and_(lapsed, _GIVE_UP)))
        job: CoreJob | None = None
        # The job is chosen with reads, outside SQLite's write lock; taking it only checks it is
        # still due, and one another worker took meanwhile is chosen again.
        for _ in range(CLAIM_TRIES):
            async with self.state.session_factory() as db:
                users = (
                    await db.scalars(select(CoreJob.user_id).where(due).distinct().limit(2))
                ).all()
                turns, order = _first(lanes, due, len(users) > 1)
                pick = select(CoreJob.id).where(due).order_by(*order).limit(1)
                if turns is not None:
                    pick = pick.outerjoin(turns, turns.c.user_id == CoreJob.user_id)
                if (job_id := await db.scalar(pick)) is None:
                    return None
            async with self.state.session_factory() as db:
                job = await db.scalar(
                    update(CoreJob)
                    .where(CoreJob.id == job_id, due)
                    .values(
                        status="running",
                        attempts=CoreJob.attempts + 1,
                        lease_owner=self.owner,
                        lease_expires_at=now + timedelta(seconds=LEASE_SECONDS),
                        started_at=func.coalesce(CoreJob.started_at, now),
                        claimed_at=now,
                    )
                    .returning(CoreJob)
                )
                await db.commit()
            if job is not None:
                await events.dispatch(self.state, _event(job))
                return job
        return None

    async def _end_lapsed(self, job_id: str, user_id: str, now: datetime) -> None:
        """End a job whose worker died: cancelled if asked, else failed. Its `on_failure` runs in
        the same transaction; if that fails, the job stays as it was and the next poll retries."""
        try:
            async with system_ctx(self.state, user_id) as ctx:
                key = await ctx.db.scalar(select(CoreJob.dedupe_key).where(CoreJob.id == job_id))
                row = await ctx.db.scalar(
                    update(CoreJob)
                    .where(CoreJob.id == job_id, _lease_lapsed(now), _GIVE_UP)
                    .values(
                        status=case((CoreJob.cancel_requested, "cancelled"), else_="failed"),
                        error_code=case(
                            (CoreJob.cancel_requested, None), else_="core.job_lease_expired"
                        ),
                        **_end_values(now),
                    )
                    .returning(CoreJob)
                )
                if row is None:  # another worker ended it first
                    return
                await _on_failure(ctx, row)
                await _run_again(ctx, row, key)
                await ctx.db.commit()
        except Exception:
            log.exception("job_on_failure_failed", job_id=job_id)
            return
        await run_after_commit(ctx)
        await _ended(self.state, row)

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
            await _ended(self.state, row)

    async def _run_handler(self, job: CoreJob) -> CoreJob | None:
        handler = _handlers.get(job.kind)

        def end() -> dict[str, Any]:
            # When the job ended, not when it started: the status bar times "done" from it.
            return _end_values(self.state.now())

        if handler is None:
            return await self._update(
                job.id, {"status": "failed", "error_code": "core.job_unknown_kind", **end()}
            )

        last = job

        async def report(values: dict[str, Any]) -> None:
            nonlocal last
            row = await self._update(job.id, values)
            if row is not None:
                last = row
                await events.dispatch(self.state, _event(row))

        async def notify() -> None:
            # What it waits for changed: the last progress again, without a write.
            await events.dispatch(self.state, _event(last))

        try:
            payload = handler.payload_model.model_validate(job.payload)
        except ValidationError:
            # Retrying cannot fix a payload that does not match its model.
            log.warning("job_payload_invalid", job_id=job.id, kind=job.kind)
            return await self._update(
                job.id, {"status": "failed", "error_code": "common.validation", **end()}
            )

        async def finish(values: dict[str, Any]) -> CoreJob | None:
            # The job's new state, a failed or cancelled job's `on_failure`, and (on success) the
            # handler's writes commit together, so the module's copy never outlives the job. If
            # `on_failure` raises, nothing commits: the lease lapses and the sweep ends the job.
            row = await self._update(job.id, values, db=ctx.db)
            if row is None:
                await _discard(ctx)  # lease lost: another worker owns the job now
                return None
            await _on_failure(ctx, row)
            await _run_again(ctx, row, job.dedupe_key)
            await ctx.db.commit()
            return row

        async with system_ctx(self.state, job.user_id) as base:
            ctx = JobCtx(
                **{f: getattr(base, f) for f in Ctx.__dataclass_fields__},
                job_id=job.id,
                lease_owner=self.owner,
                stages=handler.stages,
                progress_hook=report,
            )
            try:
                token = _running.set(_Running(job.id, notify, handler.lane))
                try:
                    result = await handler.fn(ctx, payload)
                finally:
                    _running.reset(token)
                    _waits.pop(job.id, None)
            except JobCancelled:
                await _discard(ctx)
                row = await finish({"status": "cancelled", **end()})
            except AppError as exc:
                await _discard(ctx)
                row = await finish(
                    {
                        "status": "failed",
                        "error_code": exc.code,
                        "error_params": exc.params,
                        **end(),
                    }
                )
            except Exception:
                await _discard(ctx)
                log.exception("job_failed", job_id=job.id, kind=job.kind, attempt=job.attempts)
                error = {"error_code": "common.internal", "error_params": None}
                if job.attempts >= job.max_attempts:
                    row = await finish({"status": "failed", **error, **end()})
                else:
                    retry = {
                        "status": "pending",
                        # From the failure, not the start: a long run still waits its backoff.
                        "run_after": self.state.now() + _backoff(job.attempts),
                        "lease_owner": None,
                        "lease_expires_at": None,
                        # Running again reads everything afresh.
                        "next_payload": None,
                    }
                    row = await finish({**retry, **error})
            else:
                # Success commits together with the handler's own writes.
                row = await finish(
                    {
                        "status": "succeeded",
                        "progress": 100,
                        "result": result.model_dump(mode="json"),
                        "error_code": None,
                        "error_params": None,
                        **end(),
                    }
                )
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
    with_active: bool = Field(
        default=False,
        description="Also every pending or running job however old (first page only), so a list "
        "of the newest jobs never misses one still in progress.",
    )


class JobPage(BaseModel):
    items: list[JobOut]
    next_cursor: str | None


async def _own_job(ctx: Ctx, job_id: str) -> CoreJob:
    job = await ctx.db.scalar(
        select(CoreJob).where(CoreJob.id == job_id, CoreJob.user_id == ctx.user_id)
    )
    if job is None:
        raise not_found("job", job_id)
    return job


# What agents get back (M00 §3.6): no retry bookkeeping or timestamps.
_JOB_FIELDS = (
    "id", "kind", "status", "progress", "step", "step_current", "step_total", "result",
    "error_code", "error_params",
)  # fmt: skip


@capability(
    name="core.job.get",
    summary="Get the state and progress of a background job.",
    description="""Use to check on a long-running operation (file parsing, imports, syncs) that
another capability started and returned a job id for.""",
    effect="read",
    http=Http("GET", "/jobs/{job_id}"),
    tags=("jobs",),
    agent_output_fields=_JOB_FIELDS,
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
    agent_output_fields=(*(f"items.{f}" for f in _JOB_FIELDS), "next_cursor"),
)
async def job_list(ctx: Ctx, inp: JobListInput) -> JobPage:
    query = select(CoreJob).where(CoreJob.user_id == ctx.user_id)
    if inp.status is not None:
        query = query.where(CoreJob.status == inp.status)
    if inp.kind is not None:
        query = query.where(CoreJob.kind == inp.kind)
    elif unlisted := [h.kind for h in _handlers.values() if not h.listed]:
        query = query.where(CoreJob.kind.not_in(unlisted))
    if inp.cursor is not None:
        query = query.where(CoreJob.id < inp.cursor)
    rows = (await ctx.db.scalars(query.order_by(CoreJob.id.desc()).limit(inp.limit + 1))).all()
    items = [JobOut.of(r) for r in rows[: inp.limit]]
    next_cursor = items[-1].id if len(rows) > inp.limit else None
    if inp.with_active and inp.cursor is None and next_cursor is not None:
        older = await ctx.db.scalars(
            query.where(CoreJob.id < next_cursor, CoreJob.status.in_(("pending", "running")))
            .order_by(CoreJob.id.desc())
            .limit(100)
        )
        items += [JobOut.of(r) for r in older]
    return JobPage(items=items, next_cursor=next_cursor)


async def withdraw(ctx: Ctx, job_ids: Sequence[str]) -> None:
    """Jobs not started yet that a newer one replaces (the work they would do is queued again):
    they end `cancelled` without their `on_failure`, which would record a stop nobody asked
    for. One a worker claimed meanwhile is left to run: the update only ends jobs still pending
    when it runs, whatever the caller read before."""
    if not job_ids:
        return
    ended = list(
        await ctx.db.scalars(
            update(CoreJob)
            .where(
                CoreJob.user_id == ctx.user_id,
                CoreJob.id.in_(list(job_ids)),
                CoreJob.status == "pending",
            )
            .values(status="cancelled", **_end_values(ctx.now))
            .returning(CoreJob.id),
            execution_options={"synchronize_session": False},
        )
    )
    if not ended:
        return
    for job in await ctx.db.scalars(
        select(CoreJob).where(CoreJob.id.in_(ended)).execution_options(populate_existing=True)
    ):
        await events.publish(ctx, JOB_PROGRESS, _event(job).data)
        await events.publish(ctx, JOB_FINISHED, _finished(job).data)


@capability(
    name="core.job.cancel",
    summary="Cancel a pending or running background job.",
    description="""Use when the user wants to stop a background operation. A running job stops at
its next checkpoint, so it may still finish. Cancelling a finished job changes nothing.""",
    effect="write",
    http=Http("POST", "/jobs/{job_id}/cancel"),
    tags=("jobs",),
    agent_output_fields=("id", "kind", "status", "cancel_requested"),
)
async def job_cancel(ctx: Ctx, inp: JobRef) -> JobOut:
    job = await _own_job(ctx, inp.job_id)
    if job.status == "pending":
        job.status = "cancelled"
        job.cancel_requested = True
        for key, value in _end_values(ctx.now).items():
            setattr(job, key, value)
        await ctx.db.flush()
        # It never ran: what the handler would have done on cancelling happens here.
        await _on_failure(ctx, job)
        await events.publish(ctx, JOB_PROGRESS, _event(job).data)
        await events.publish(ctx, JOB_FINISHED, _finished(job).data)
    elif job.status == "running":
        job.cancel_requested = True
        await ctx.db.flush()
        await events.publish(ctx, JOB_PROGRESS, _event(job).data)
    return JobOut.of(job)
