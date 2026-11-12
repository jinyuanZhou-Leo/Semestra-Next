"""Background sync of linked courses (M09 §4.1).

One job per course, `lms.course.sync`, runs the registered stages in order (course details,
assignments, announcements; the file sync adds its own). Each stage reads the platform first and
then writes in a transaction of its own, so a failing stage keeps its error code in
`LmsCourseLink.sync_errors` and the next one still runs; only a failing first stage (the course
itself cannot be read: the connection is broken) ends the run. When all have run the link's
`synced_at` moves on and `lms.course.synced` says what the run did, for notifications (M18) and
the app's status line.

Jobs are queued by the scheduler (`lms.sync_due`, every few minutes: courses whose last sync is
older than the account's interval, `lms.sync_every`), when the app opens a Program whose courses
were not synced lately, and when the user asks. Only synced courses of a running, upcoming or
recent term are synced, and only for accounts used in the last weeks; a returning user's courses
sync when the app opens.
"""

from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from datetime import timedelta

import structlog
from pydantic import BaseModel
from sqlalchemy import select
from starlette.datastructures import State

from semestra.core.context import Ctx, run_as_system
from semestra.core.errors import AppError
from semestra.core.events import events
from semestra.core.jobs import CoreJob, JobCtx, enqueue, job_handler, periodic
from semestra.modules.academics import service as academics
from semestra.modules.auth import service as auth
from semestra.modules.lms import service
from semestra.modules.lms.models import LmsConnection, LmsCourseLink
from semestra.modules.lms.service import Bound
from semestra.modules.lms.settings import account, interval
from semestra.modules.notifications import service as notifications

log = structlog.get_logger()

JOB = "lms.course.sync"
SYNCED = "lms.course.synced"
# The status line and panel of a Program refetch on it (enqueued, finished, decided).
UPDATED = "lms.sync.updated"
# Grades come in a while after a term's last day (the final exam), so a term that ended within
# this is still synced.
RECENT = timedelta(days=30)
# Accounts not used for this long are not synced on a schedule (opening the app syncs them),
# unless they hear of the platform's news by notification (final grades come out after the
# term, when students rarely open the app).
INACTIVE = timedelta(days=14)
# Opening a Program syncs its courses not synced for this long.
ON_OPEN = timedelta(minutes=30)
# The scheduler's round, and how many courses one round queues (the rest wait for the next).
TICK = timedelta(minutes=5)
PER_TICK = 20


@dataclass
class Applied:
    """A field the stage changed on a Semestra object (`LmsSyncChange`)."""

    change_id: str
    name: str
    field: str


@dataclass
class Notice:
    """Something new on the platform worth telling (an announcement)."""

    kind: str
    external_id: str
    title: str


@dataclass
class StageResult:
    applied: list[Applied] = field(default_factory=lambda: [])
    # Items waiting for the user: new ones, conflicts, items gone from the platform.
    pending: int = 0
    notices: list[Notice] = field(default_factory=lambda: [])
    # The stage stopped at its per-run limit; the next run goes on.
    cap_reached: bool = False


StageRun = Callable[[Ctx, LmsCourseLink, Bound], Awaitable[StageResult]]
StageEnabled = Callable[[Ctx, LmsCourseLink, Bound], Awaitable[bool]]


@dataclass(frozen=True)
class SyncStage:
    name: str
    order: int
    run: StageRun
    enabled: StageEnabled | None = None


_stages: dict[str, SyncStage] = {}


def register_sync_stage(
    name: str, run: StageRun, *, order: int, enabled: StageEnabled | None = None
) -> None:
    """Adds a stage to every course sync. `run(ctx, link, b)` reads the platform, then writes in
    `ctx`'s transaction (committed after it returns; rolled back if it raises). An `AppError` is
    recorded as the stage's error; the other stages still run. `enabled(ctx, link, b)` skips the
    stage for a course (its settings, the provider's features)."""
    if name in _stages:
        raise ValueError(f"duplicate sync stage {name!r}")
    _stages[name] = SyncStage(name, order, run, enabled)


def stages() -> list[SyncStage]:
    return sorted(_stages.values(), key=lambda s: s.order)


class SyncPayload(BaseModel):
    course_id: str
    manual: bool = False


class SyncOutcome(BaseModel):
    course_id: str
    applied: int = 0
    pending: int = 0
    errors: dict[str, str] = {}


class _Unlinked(Exception):
    """The course was unlinked or paused since the job was queued."""


# Not in the status bar's job list: the sync has its own status line (M09 §4.1).
@job_handler(JOB, stages=[("syncing", 1)], max_attempts=1, listed=False)
async def sync_job(ctx: JobCtx, payload: SyncPayload) -> SyncOutcome:
    async def progress(done: int, total: int) -> None:
        await ctx.stage("syncing", current=done, total=total)

    return await sync_course(ctx.state, ctx.user_id, payload.course_id, payload.manual, progress)


async def sync_course(
    state: State,
    user_id: str,
    course_id: str,
    manual: bool = False,
    progress: Callable[[int, int], Awaitable[None]] | None = None,
) -> SyncOutcome:
    """Runs every stage for one course, each in a transaction of its own."""
    todo = stages()
    results: list[StageResult] = []
    errors: dict[str, str] = {}
    for n, stage in enumerate(todo):
        if progress is not None:
            await progress(n, len(todo))

        async def run(sys: Ctx, stage: SyncStage = stage) -> None:
            link = await service.link_row(sys, course_id)
            if link is None or not link.sync_enabled:
                raise _Unlinked
            b = await service.bound(sys, await service.get_connection_row(sys, link.connection_id))
            if stage.enabled is not None and not await stage.enabled(sys, link, b):
                return
            results.append(await stage.run(sys, link, b))

        try:
            await run_as_system(state, user_id, run)
        except _Unlinked:
            return SyncOutcome(course_id=course_id)
        except AppError as exc:
            errors[stage.name] = exc.code
        except Exception:
            log.exception("lms.sync_stage_failed", stage=stage.name, course_id=course_id)
            errors[stage.name] = "common.internal"
        if n == 0 and stage.name in errors:
            break  # the course itself could not be read: the others would fail the same way
    outcome = SyncOutcome(
        course_id=course_id,
        applied=sum(len(r.applied) for r in results),
        pending=sum(r.pending for r in results),
        errors=errors,
    )

    async def finish(sys: Ctx) -> None:
        link = await service.link_row(sys, course_id)
        if link is None:
            return
        link.synced_at = sys.now
        link.sync_errors = errors
        await events.publish(
            sys,
            SYNCED,
            {
                "course_id": course_id,
                "program_id": link.program_id,
                "manual": manual,
                "applied": [
                    {"change_id": a.change_id, "name": a.name, "field": a.field}
                    for r in results
                    for a in r.applied
                ],
                "notices": [
                    {"kind": x.kind, "external_id": x.external_id, "title": x.title}
                    for r in results
                    for x in r.notices
                ],
                "pending": outcome.pending,
                "errors": errors,
            },
        )
        await events.publish(sys, UPDATED, {"program_id": link.program_id})

    await run_as_system(state, user_id, finish)
    return outcome


# --- queueing --------------------------------------------------------------------------------


def _dedupe(course_id: str) -> str:
    return f"{JOB}:{course_id}"


async def syncable_links(ctx: Ctx, program_id: str | None = None) -> list[LmsCourseLink]:
    """The ctx user's links a sync looks at: synced, with credentials, of an active course."""
    query = (
        select(LmsCourseLink)
        .join(LmsConnection, LmsConnection.id == LmsCourseLink.connection_id)
        .where(
            LmsCourseLink.user_id == ctx.user_id,
            LmsCourseLink.sync_enabled,
            LmsConnection.credentials_encrypted.is_not(None),
        )
        .order_by(LmsCourseLink.synced_at.is_not(None), LmsCourseLink.synced_at)
    )
    if program_id is not None:
        query = query.where(LmsCourseLink.program_id == program_id)
    active = await academics.course_ids_active_since(ctx, (ctx.now - RECENT).date())
    return [li for li in await ctx.db.scalars(query) if li.course_id in active]


async def queue(ctx: Ctx, links: Sequence[LmsCourseLink], *, manual: bool = False) -> int:
    """Queues a sync of each link's course (one job per course: a course already queued or
    syncing is not queued twice). Returns how many were queued."""
    for link in links:
        payload = SyncPayload(course_id=link.course_id, manual=manual)
        await enqueue(ctx, JOB, payload, dedupe_key=_dedupe(link.course_id))
    for program_id in {li.program_id for li in links}:
        await events.publish(ctx, UPDATED, {"program_id": program_id})
    return len(links)


async def request_sync(
    ctx: Ctx, program_id: str, course_id: str | None = None, *, force: bool = False
) -> int:
    """A sync the app asks for: of one course or the Program's, those not synced in the last
    `ON_OPEN` (opening the app) or all of them (`force`: the user asked)."""
    await academics.get_program_row(ctx, program_id)  # owned, or not found
    links = await syncable_links(ctx, program_id)
    if course_id is not None:
        links = [li for li in links if li.course_id == course_id]
    if not force:
        links = [li for li in links if li.synced_at is None or li.synced_at < ctx.now - ON_OPEN]
    return await queue(ctx, links, manual=force)


async def syncing_courses(ctx: Ctx, course_ids: Sequence[str]) -> set[str]:
    """Which of these courses have a sync queued or running."""
    keys = {_dedupe(c): c for c in course_ids}
    if not keys:
        return set()
    rows = await ctx.db.scalars(
        select(CoreJob.dedupe_key).where(
            CoreJob.user_id == ctx.user_id,
            CoreJob.kind == JOB,
            CoreJob.status.in_(("pending", "running")),
            CoreJob.dedupe_key.in_(list(keys)),
        )
    )
    return {keys[k] for k in rows if k in keys}


@periodic("lms.sync_due", every=TICK, first_after=timedelta(minutes=1))
async def sync_due(ctx: Ctx) -> None:
    """Queues the courses whose last sync is older than their account's interval, oldest first,
    at most `PER_TICK` a round. Reads only the database, so a restart loses nothing."""
    users = (
        await ctx.db.scalars(
            select(LmsCourseLink.user_id)
            .join(LmsConnection, LmsConnection.id == LmsCourseLink.connection_id)
            .where(LmsCourseLink.sync_enabled, LmsConnection.credentials_encrypted.is_not(None))
            .distinct()
        )
    ).all()
    active = await auth.active_user_ids(ctx, list(users), ctx.now - INACTIVE)
    listening = await notifications.users_with_devices(ctx, [u for u in users if u not in active])
    room = PER_TICK
    for user_id in users:
        if room <= 0 or (user_id not in active and user_id not in listening):
            continue
        queued = 0

        async def due(sys: Ctx, room: int = room, listens: bool = user_id in listening) -> None:
            nonlocal queued
            if listens and (await notifications.settings_of(sys)).lms == "off":
                return  # away and not told: nothing to sync for
            every = interval(sys, await account(sys))
            links = [
                li
                for li in await syncable_links(sys)
                if li.synced_at is None or li.synced_at <= sys.now - every
            ]
            busy = await syncing_courses(sys, [li.course_id for li in links])
            links = [li for li in links if li.course_id not in busy][:room]
            queued = await queue(sys, links)

        try:
            await run_as_system(ctx.state, user_id, due)
        except Exception:
            # One user's broken data must not stop the round.
            log.exception("lms.sync_due_failed", user_id=user_id)
        room -= queued
