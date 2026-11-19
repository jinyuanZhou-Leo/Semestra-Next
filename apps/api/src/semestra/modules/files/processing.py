"""Reading files in the background, as one list (M07 §3.1): every `files.process` and
`files.process_synced` job of the user with the file it reads, for the status bar's "Reading
files" line and its panel. Each job is cancelled with `core.job.cancel` and a failed file is read
again with `files.item.reprocess`; `cancel_all` stops all of them at once."""

from datetime import datetime, timedelta

from pydantic import BaseModel, Field
from sqlalchemy import case, false, func, not_, or_, select

from semestra.core.context import Ctx
from semestra.core.events import events
from semestra.core.jobs import CoreJob, JobOut, JobRef, job_cancel
from semestra.modules.academics import service as academics
from semestra.modules.academics.models import AcademicsCourse
from semestra.modules.files import content, service
from semestra.modules.files.models import FilesItem
from semestra.modules.files.schemas import Id
from semestra.modules.files.service import PROCESS_KINDS

ACTIVE = ("pending", "running")
ENDED = ("succeeded", "failed", "cancelled")
# Queued files listed; the rest are counted (one sync can queue hundreds).
QUEUED_SHOWN = 100
# Files of the current round that ended, listed: all that failed or were stopped (so none is
# pushed out by a sync's successes), then the latest successes.
ROUND_FAILED_SHOWN = 300
ROUND_DONE_SHOWN = 100
# Failures of earlier rounds, listed until the user has seen them.
EARLIER_FAILED_SHOWN = 50
ENDED_WITHIN = timedelta(days=7)
# The most item ids one "process again" takes.
RETRY_MAX = 500


class ProcessingFile(BaseModel):
    job: JobOut = Field(description="The file's latest processing job")
    item_id: str
    name: str
    mime_type: str | None
    course_id: str
    folder_id: str | None
    program_id: str
    course_code: str = Field(description="The course's code, or its title when it has none")
    course_color: str
    synced: bool = Field(description="Kept in step with its source (M09's course materials)")


class ProcessingList(BaseModel):
    files: list[ProcessingFile] = Field(
        description="One row per file, with its latest job: running files, then queued ones in "
        "the order they will run (at most 100), then the files of the current round that ended, "
        "then files that failed earlier in the last 7 days"
    )
    active: int = Field(description="Files running or queued, all of them")
    done: int = Field(
        description="Files of the current round that ended: with `active`, how far it is"
    )
    since: datetime | None = Field(
        description="When the current round started (or the last one, when nothing is left): "
        "going back from now, when the queue was last empty"
    )


class CancelledAll(BaseModel):
    cancelled: int


class RetryInput(BaseModel):
    item_ids: list[Id] = Field(max_length=RETRY_MAX, description="The files to process again")


class Retried(BaseModel):
    retried: int


def _mine(ctx: Ctx):
    return (CoreJob.user_id == ctx.user_id, CoreJob.kind.in_(PROCESS_KINDS))


async def _round_start(ctx: Ctx) -> datetime | None:
    """Going back from now, when the processing queue was last empty: jobs whose times overlap
    are one round (a job queued while another ran joins its round)."""
    recent = or_(CoreJob.status.in_(ACTIVE), CoreJob.finished_at >= ctx.now - ENDED_WITHIN)
    active_start = await ctx.db.scalar(
        select(func.min(CoreJob.created_at)).where(*_mine(ctx), CoreJob.status.in_(ACTIVE))
    )
    ended = (
        await ctx.db.execute(
            select(CoreJob.created_at, CoreJob.finished_at)
            .where(*_mine(ctx), recent, CoreJob.status.in_(ENDED))
            .order_by(CoreJob.finished_at.desc())
        )
    ).all()
    start = active_start
    for created_at, finished_at in ended:
        if start is None:
            start = created_at  # nothing left to do: the last round
        elif finished_at is not None and finished_at >= start:
            start = min(start, created_at)
        else:
            break  # the queue was empty between this job and the round
    return start


def _latest():
    """Each file's latest processing job (a file read again has several)."""
    item = CoreJob.payload["item_id"].as_string()
    rank = (
        func.row_number()
        .over(partition_by=item, order_by=(CoreJob.created_at.desc(), CoreJob.id.desc()))
        .label("rank")
    )
    return select(CoreJob.id, rank)


async def list_processing(ctx: Ctx) -> ProcessingList:
    since = await _round_start(ctx)
    ranked = (
        _latest()
        .where(
            *_mine(ctx),
            or_(CoreJob.status.in_(ACTIVE), CoreJob.finished_at >= ctx.now - ENDED_WITHIN),
        )
        .subquery()
    )
    latest = select(CoreJob).join(ranked, ranked.c.id == CoreJob.id).where(ranked.c.rank == 1)

    async def rows(query) -> list[CoreJob]:
        return list((await ctx.db.scalars(query)).all())

    running = await rows(latest.where(CoreJob.status == "running").order_by(CoreJob.started_at))
    # The order the runner takes them in: the user's own files before synced ones.
    queued = await rows(
        latest.where(CoreJob.status == "pending")
        .order_by(case((CoreJob.kind == PROCESS_KINDS[0], 0), else_=1), CoreJob.run_after)
        .limit(QUEUED_SHOWN)
    )
    newest = CoreJob.finished_at.desc()
    in_round = CoreJob.created_at >= since if since is not None else false()
    round_failed = await rows(
        latest.where(CoreJob.status.in_(("failed", "cancelled")), in_round)
        .order_by(newest)
        .limit(ROUND_FAILED_SHOWN)
    )
    round_done = await rows(
        latest.where(CoreJob.status == "succeeded", in_round)
        .order_by(newest)
        .limit(ROUND_DONE_SHOWN)
    )
    earlier_failed = await rows(
        latest.where(CoreJob.status == "failed", not_(in_round))
        .order_by(newest)
        .limit(EARLIER_FAILED_SHOWN)
    )
    pending = latest.where(CoreJob.status.in_(ACTIVE)).subquery()
    active = int(await ctx.db.scalar(select(func.count()).select_from(pending)) or 0)
    done = 0
    if since is not None:
        ended = latest.where(CoreJob.status.in_(ENDED), CoreJob.created_at >= since).subquery()
        done = int(await ctx.db.scalar(select(func.count()).select_from(ended)) or 0)
    jobs = [*running, *queued, *round_failed, *round_done, *earlier_failed]
    return ProcessingList(files=await _files(ctx, jobs), active=active, done=done, since=since)


async def _files(ctx: Ctx, jobs: list[CoreJob]) -> list[ProcessingFile]:
    ids = {str(job.payload.get("item_id")) for job in jobs}
    items = {
        row.id: row
        for row in await ctx.db.scalars(
            select(FilesItem).where(FilesItem.user_id == ctx.user_id, FilesItem.id.in_(ids))
        )
    }
    courses = {
        row.id: row
        for row in await academics.courses_by_id(ctx, list({i.course_id for i in items.values()}))
    }
    colors: dict[str, str] = {}
    by_program: dict[str, list[AcademicsCourse]] = {}
    for course in courses.values():
        by_program.setdefault(course.program_id, []).append(course)
    for program_id, rows in by_program.items():
        program = await academics.get_program_row(ctx, program_id)
        for out_course in await academics.courses_out(ctx, program, rows):
            colors[out_course.id] = out_course.resolved_color
    out: list[ProcessingFile] = []
    for job in jobs:
        item = items.get(str(job.payload.get("item_id")))
        course = courses.get(item.course_id) if item else None
        if item is None or course is None:
            continue  # the file was deleted meanwhile; its job ends on its own
        out.append(
            ProcessingFile(
                job=JobOut.of(job),
                item_id=item.id,
                name=item.display_name,
                mime_type=item.mime_type,
                course_id=course.id,
                folder_id=item.folder_id,
                program_id=course.program_id,
                course_code=course.code or course.title,
                course_color=colors[course.id],
                synced=job.kind == PROCESS_KINDS[1],
            )
        )
    return out


async def cancel_all(ctx: Ctx) -> CancelledAll:
    """Every running or queued file is stopped; each is left marked as not read
    (`files.cancelled`) and can be read again later."""
    ids = (
        await ctx.db.scalars(
            select(CoreJob.id).where(
                CoreJob.user_id == ctx.user_id,
                CoreJob.kind.in_(PROCESS_KINDS),
                CoreJob.status.in_(ACTIVE),
                CoreJob.cancel_requested.is_(False),
            )
        )
    ).all()
    for job_id in ids:
        await job_cancel(ctx, JobRef(job_id=job_id))
    return CancelledAll(cancelled=len(ids))


async def retry(ctx: Ctx, inp: RetryInput) -> Retried:
    """Each listed file is queued to be read again. Unlike `files.item.reprocess` the bytes are
    not read here (the job tells the type again in its first stage), so a few hundred files cost
    one short write; files deleted meanwhile, links, and files that are being read are skipped."""
    ids = list(dict.fromkeys(inp.item_ids))
    rows = (
        await ctx.db.scalars(
            select(FilesItem).where(FilesItem.user_id == ctx.user_id, FilesItem.id.in_(ids))
        )
    ).all()
    retried = 0
    for row in rows:
        if not content.has_content(row) or row.doc_status in ("pending", "processing"):
            continue
        await service.request_read(ctx, row, "user")
        await events.publish(
            ctx, "files.item.updated", {"item_id": row.id, "course_id": row.course_id}
        )
        retried += 1
    await ctx.db.flush()
    return Retried(retried=retried)
