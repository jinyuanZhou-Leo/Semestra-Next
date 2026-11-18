"""Reading files in the background, as one list (M07 §3.1): every `files.process` and
`files.process_synced` job of the user with the file it reads, for the status bar's "Reading
files" line and its panel. Each job is cancelled with `core.job.cancel` and a failed file is read
again with `files.item.reprocess`; `cancel_all` stops all of them at once."""

from datetime import datetime, timedelta

from pydantic import BaseModel, Field
from sqlalchemy import case, func, select

from semestra.core.context import Ctx
from semestra.core.jobs import CoreJob, JobOut, JobRef, job_cancel
from semestra.modules.academics import service as academics
from semestra.modules.academics.models import AcademicsCourse
from semestra.modules.files.models import FilesItem
from semestra.modules.files.service import PROCESS_KINDS

ACTIVE = ("pending", "running")
# Queued files listed; the rest are counted (one sync can queue hundreds).
QUEUED_SHOWN = 100
# Ended jobs listed: what the panel may still show (a success briefly, a failure until seen).
ENDED_SHOWN = 50
ENDED_WITHIN = timedelta(days=7)


class ProcessingFile(BaseModel):
    job: JobOut
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
        description="Running files, then queued ones in the order they will run (at most 100), "
        "then files that ended in the last 7 days, newest first"
    )
    active: int = Field(description="Files running or queued, all of them")
    done: int = Field(
        description="Files that ended since the oldest active one was queued: with `active`, "
        "how far the current round is"
    )
    since: datetime | None = Field(
        description="When the oldest active file was queued: the start of the current round"
    )


class CancelledAll(BaseModel):
    cancelled: int


async def list_processing(ctx: Ctx) -> ProcessingList:
    mine = select(CoreJob).where(CoreJob.user_id == ctx.user_id, CoreJob.kind.in_(PROCESS_KINDS))
    running = (
        await ctx.db.scalars(mine.where(CoreJob.status == "running").order_by(CoreJob.started_at))
    ).all()
    # The order the runner takes them in: the user's own files before synced ones.
    queued = (
        await ctx.db.scalars(
            mine.where(CoreJob.status == "pending")
            .order_by(case((CoreJob.kind == PROCESS_KINDS[0], 0), else_=1), CoreJob.run_after)
            .limit(QUEUED_SHOWN)
        )
    ).all()
    ended = (
        await ctx.db.scalars(
            mine.where(
                CoreJob.status.in_(("succeeded", "failed", "cancelled")),
                CoreJob.finished_at >= ctx.now - ENDED_WITHIN,
            )
            .order_by(CoreJob.finished_at.desc())
            .limit(ENDED_SHOWN)
        )
    ).all()
    counts = (
        await ctx.db.execute(
            select(func.count(), func.min(CoreJob.created_at)).where(
                CoreJob.user_id == ctx.user_id,
                CoreJob.kind.in_(PROCESS_KINDS),
                CoreJob.status.in_(ACTIVE),
            )
        )
    ).one()
    active, since = int(counts[0]), counts[1]
    done = 0
    if active and since is not None:
        done = int(
            await ctx.db.scalar(
                select(func.count()).where(
                    CoreJob.user_id == ctx.user_id,
                    CoreJob.kind.in_(PROCESS_KINDS),
                    CoreJob.status.in_(("succeeded", "failed", "cancelled")),
                    CoreJob.created_at >= since,
                )
            )
            or 0
        )
    jobs = [*running, *queued, *ended]
    return ProcessingList(
        files=await _files(ctx, jobs), active=active, done=done, since=since if active else None
    )


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
