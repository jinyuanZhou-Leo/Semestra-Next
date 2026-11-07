"""Assessment tasks (M05 §3): every assessment with a due date has exactly one task, linked by
`assessment_id`. It follows the assessment's title, due date and course, is finished once the
assessment has a score, and goes when the assessment is deleted (the foreign key) or loses its
due date. A task made for an assessment that is already past due stays open (overdue): whether it
was handed in is the user's to say. An assessment imported from the same source as an existing
to-do (a platform assignment first imported as a to-do, then added to the gradebook) takes that
to-do over instead of getting a second one. This module is the only writer of that link."""

from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules.academics import service as academics
from semestra.modules.grading import service as grading
from semestra.modules.grading.models import GradingAssessment
from semestra.modules.tasks import rules, service
from semestra.modules.tasks.models import TasksItem
from semestra.modules.tasks.schemas import TaskFields


@dataclass(frozen=True)
class AssessmentInfo:
    id: str
    course_id: str
    program_id: str
    title: str
    course_code: str | None
    due_at: datetime | None
    due_has_time: bool
    scored: bool = False  # graded or dropped
    source_kind: str | None = None
    source_ref: str | None = None


async def _info(ctx: Ctx, row: GradingAssessment) -> AssessmentInfo | None:
    try:
        course = await academics.get_course_row(ctx, row.course_id)
    except AppError:
        return None
    return AssessmentInfo(
        id=row.id,
        course_id=course.id,
        program_id=course.program_id,
        title=row.title,
        course_code=course.code or course.alias or course.title,
        due_at=row.due_at,
        due_has_time=row.due_has_time,
        # A dropped assessment counts as done: nothing is left to hand in for it.
        scored=row.score_percentage is not None or row.dropped,
        source_kind=row.source_kind,
        source_ref=row.source_ref,
    )


async def task_of(ctx: Ctx, assessment_id: str) -> TasksItem | None:
    return await ctx.db.scalar(
        select(TasksItem).where(
            TasksItem.user_id == ctx.user_id, TasksItem.assessment_id == assessment_id
        )
    )


async def _same_source(ctx: Ctx, info: AssessmentInfo) -> TasksItem | None:
    """A to-do of no assessment imported from the same item as this assessment."""
    if info.source_kind is None or info.source_ref is None:
        return None
    return await ctx.db.scalar(
        select(TasksItem).where(
            TasksItem.user_id == ctx.user_id,
            TasksItem.assessment_id.is_(None),
            TasksItem.source_kind == info.source_kind,
            TasksItem.source_ref == info.source_ref,
        )
    )


async def sync(ctx: Ctx, assessment_id: str) -> None:
    """Brings the task of one assessment in line with it (after any change to it)."""
    existing = await task_of(ctx, assessment_id)
    row = await grading.find_assessment_row(ctx, assessment_id)
    info = None if row is None else await _info(ctx, row)
    if info is None or info.due_at is None:
        if existing is not None:
            await _drop(ctx, existing)
        return
    changed: list[str] = []
    if existing is None and (existing := await _same_source(ctx, info)) is not None:
        existing.assessment_id = info.id
        changed.append("assessment_id")
    program = await academics.get_program_row(ctx, info.program_id)
    local = info.due_at.astimezone(ZoneInfo(program.timezone))
    due_date = local.date()
    due_time = local.time().replace(tzinfo=None) if info.due_has_time else None
    title = rules.auto_title(info.course_code, info.title)
    if existing is None:
        fields = TaskFields(
            title=title,
            due_date=due_date,
            due_time=due_time,
            priority="medium",
            course_id=info.course_id,
            source_kind="manual",
        )
        try:
            row = await service.create_task_row(
                ctx,
                program,
                fields,
                default_priority="medium",
                completed_at=ctx.now if info.scored else None,
            )
        except AppError:
            return  # the course vanished meanwhile; its deletion cleans up on its own
        row.assessment_id = info.id
        await ctx.db.flush()
        # Finished ones stay on the calendar too (marked done), so it always changes.
        await service.announce_item(ctx, "created", row, calendar=True)
        return
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
        await service.announce_item(ctx, "updated", existing, calendar=True, changed=changed)


async def drop(ctx: Ctx, assessment_id: str) -> None:
    if (row := await task_of(ctx, assessment_id)) is not None:
        await _drop(ctx, row)


async def _drop(ctx: Ctx, row: TasksItem) -> None:
    await ctx.db.delete(row)
    await ctx.db.flush()
    await service.announce_item(ctx, "deleted", row, calendar=row.due_date is not None)
