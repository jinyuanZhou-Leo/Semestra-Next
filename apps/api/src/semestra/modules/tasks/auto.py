"""Tasks generated from assessments (M05 §3): one task per assessment with a due date, kept in
sync through the `grading.assessment.*` events and finished once the assessment has a score."""

from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import func, select

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules.academics import service as academics
from semestra.modules.academics.models import AcademicsCourse
from semestra.modules.grading.models import GradingAssessment
from semestra.modules.tasks import rules, service
from semestra.modules.tasks.models import TasksItem
from semestra.modules.tasks.schemas import TaskFields

SOURCE_KIND = "assessment"


@dataclass(frozen=True)
class AssessmentInfo:
    id: str
    course_id: str
    program_id: str
    title: str
    course_code: str | None
    due_at: datetime | None
    due_has_time: bool
    scored: bool = False


async def _info(ctx: Ctx, row: GradingAssessment) -> AssessmentInfo | None:
    course = await ctx.db.get(AcademicsCourse, row.course_id)
    if course is None or course.user_id != ctx.user_id:
        return None
    return AssessmentInfo(
        id=row.id,
        course_id=course.id,
        program_id=course.program_id,
        title=row.title,
        course_code=course.code or course.alias or course.title,
        due_at=row.due_at,
        due_has_time=row.due_has_time,
        scored=row.score_percentage is not None,
    )


async def enabled(ctx: Ctx, program_id: str) -> bool:
    return (await service.program_settings(ctx, program_id)).auto_tasks_from_assessments


async def sync_assessment(
    ctx: Ctx, info: AssessmentInfo | None, assessment_id: str, *, create: bool = True
) -> None:
    """Brings the task of one assessment in line with it. `info` is None once it is deleted.
    Without `create` only an existing task is updated or removed."""
    existing = await service.existing_by_source(ctx, SOURCE_KIND, assessment_id)
    if info is None or info.due_at is None:
        # Gone or no longer scheduled: an unfinished task goes, a finished one stays.
        if existing is not None and existing.completed_at is None:
            await _drop(ctx, existing)
        return
    program = await academics.get_program_row(ctx, info.program_id)
    local = info.due_at.astimezone(ZoneInfo(program.timezone))
    due_date = local.date()
    due_time = local.time().replace(tzinfo=None) if info.due_has_time else None
    title = rules.auto_title(info.course_code, info.title)
    if existing is None:
        if info.scored or not create:
            return  # nothing left to do for an assessment that is already marked
        fields = TaskFields(
            title=title,
            due_date=due_date,
            due_time=due_time,
            priority="medium",
            course_id=info.course_id,
            source_kind=SOURCE_KIND,
            source_ref=info.id,
        )
        try:
            row = await service.create_task_row(ctx, program, fields, default_priority="medium")
        except AppError:
            return  # the course vanished meanwhile; its deletion cleans up on its own
        await service.announce_item(ctx, "created", row, calendar=False)
        return
    changed: list[str] = []
    if existing.title != title:
        existing.title = title
        changed.append("title")
    if (existing.due_date, existing.due_time) != (due_date, due_time):
        existing.due_date, existing.due_time = due_date, due_time
        changed.append("due")
    if existing.course_id != info.course_id:
        existing.course_id = info.course_id
        existing.term_id = await service.infer_term(ctx, program, info.course_id, due_date)
        changed.append("course_id")
    elif "due" in changed:
        existing.term_id = await service.infer_term(ctx, program, info.course_id, due_date)
    if info.scored and existing.completed_at is None:
        existing.completed_at = ctx.now
        changed.append("completed_at")
    if changed:
        existing.updated_at = ctx.now
        await ctx.db.flush()
        await service.announce_item(ctx, "updated", existing, calendar=False, changed=changed)


async def _drop(ctx: Ctx, row: TasksItem) -> None:
    await ctx.db.delete(row)
    await ctx.db.flush()
    await service.announce_item(ctx, "deleted", row, calendar=False)


async def on_assessment_event(ctx: Ctx, kind: str, program_id: str, assessment_id: str) -> None:
    """The switch only decides whether new tasks are made: tasks made while it was on keep
    following their assessment, since they stay read-only where the assessment decides."""
    create = await enabled(ctx, program_id)
    if not create and await service.existing_by_source(ctx, SOURCE_KIND, assessment_id) is None:
        return
    row = None if kind == "deleted" else await ctx.db.get(GradingAssessment, assessment_id)
    info = None
    if row is not None and row.user_id == ctx.user_id:
        info = await _info(ctx, row)
    await sync_assessment(ctx, info, assessment_id, create=create)


async def backfill(ctx: Ctx, program_id: str) -> int:
    """Creates the missing tasks of a Program (after the switch is turned on); returns how
    many were created."""
    before = await _count(ctx, program_id)
    rows = await ctx.db.scalars(
        select(GradingAssessment)
        .join(AcademicsCourse, AcademicsCourse.id == GradingAssessment.course_id)
        .where(
            GradingAssessment.user_id == ctx.user_id,
            AcademicsCourse.program_id == program_id,
            GradingAssessment.due_at.is_not(None),
            GradingAssessment.score_percentage.is_(None),
        )
        .order_by(GradingAssessment.due_at)
    )
    for row in rows.all():
        if info := await _info(ctx, row):
            await sync_assessment(ctx, info, info.id)
    return await _count(ctx, program_id) - before


async def _count(ctx: Ctx, program_id: str) -> int:
    count = await ctx.db.scalar(
        select(func.count()).where(
            TasksItem.user_id == ctx.user_id,
            TasksItem.program_id == program_id,
            TasksItem.source_kind == SOURCE_KIND,
        )
    )
    return count or 0
