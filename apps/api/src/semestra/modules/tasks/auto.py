"""Assessment tasks (M05 §3): every assessment with a due date has exactly one task, linked by
`assessment_id`. It follows the assessment's title, due date and course, is finished once the
assessment has a score, and goes when the assessment is deleted (the foreign key) or loses its
due date. A task made for an assessment that is already past due stays open (overdue): whether it
was handed in is the user's to say. An assessment imported from the same source as an existing
to-do (a platform assignment first imported as a to-do, then added to the gradebook, or bound to
an assessment made by hand that has its own to-do already) takes that to-do over instead of
keeping a second one. This module is the only writer of that link."""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import select, tuple_

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules.academics import service as academics
from semestra.modules.academics.models import AcademicsCourse, AcademicsProgram
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


def _info(row: GradingAssessment, course: AcademicsCourse) -> AssessmentInfo:
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


async def _same_source(
    ctx: Ctx, infos: Sequence[AssessmentInfo]
) -> dict[tuple[str, str], TasksItem]:
    """To-dos of no assessment imported from the same items as these assessments."""
    keys = {
        (i.source_kind, i.source_ref)
        for i in infos
        if i.source_kind is not None and i.source_ref is not None
    }
    if not keys:
        return {}
    rows = await ctx.db.scalars(
        select(TasksItem).where(
            TasksItem.user_id == ctx.user_id,
            TasksItem.assessment_id.is_(None),
            tuple_(TasksItem.source_kind, TasksItem.source_ref).in_(keys),
        )
    )
    return {
        (r.source_kind, r.source_ref): r
        for r in rows
        if r.source_kind is not None and r.source_ref is not None
    }


async def sync(ctx: Ctx, assessment_ids: Sequence[str]) -> None:
    """Brings the tasks of these assessments in line with them (after any change to them),
    reading what they need once for the whole batch."""
    ids = list(dict.fromkeys(assessment_ids))
    if not ids:
        return
    assessments = await grading.find_assessment_rows(ctx, ids)
    courses = {
        c.id: c
        for c in await academics.courses_by_id(
            ctx, list({a.course_id for a in assessments.values()})
        )
    }
    infos = {
        a.id: _info(a, courses[a.course_id]) for a in assessments.values() if a.course_id in courses
    }
    existing = {
        r.assessment_id: r
        for r in await ctx.db.scalars(
            select(TasksItem).where(
                TasksItem.user_id == ctx.user_id, TasksItem.assessment_id.in_(ids)
            )
        )
    }
    same_source = await _same_source(ctx, list(infos.values()))
    lookups: dict[str, tuple[AcademicsProgram, service.TermLookup]] = {}
    for program_id in {i.program_id for i in infos.values() if i.due_at is not None}:
        program = await academics.get_program_row(ctx, program_id)
        course_ids = [i.course_id for i in infos.values() if i.program_id == program_id]
        lookups[program_id] = (program, await service.term_lookup(ctx, program, course_ids))
    for assessment_id in ids:
        info = infos.get(assessment_id)
        task = existing.get(assessment_id)
        changed: list[str] = []
        # A to-do of the same item (an LMS assignment first imported as a to-do) becomes the
        # assessment's; without a due date it goes, like any assessment to-do. The one the
        # assessment had (it was made by hand, then bound to that item) goes into it.
        if info is not None and info.source_ref is not None:
            imported = same_source.pop((str(info.source_kind), info.source_ref), None)
            if imported is not None:
                if task is not None:
                    if imported.completed_at is None and task.completed_at is not None:
                        imported.completed_at = task.completed_at
                        changed.append("completed_at")
                    await _drop(ctx, task)
                task = imported
                task.assessment_id = info.id
                changed.append("assessment_id")
        if info is None or info.due_at is None:
            if task is not None:
                await _drop(ctx, task)
            continue
        program, terms = lookups[info.program_id]
        await _apply(ctx, info, task, changed, program, terms)


async def _apply(
    ctx: Ctx,
    info: AssessmentInfo,
    task: TasksItem | None,
    changed: list[str],
    program: AcademicsProgram,
    terms: service.TermLookup,
) -> None:
    assert info.due_at is not None
    local = info.due_at.astimezone(ZoneInfo(program.timezone))
    due_date = local.date()
    due_time = local.time().replace(tzinfo=None) if info.due_has_time else None
    title = rules.auto_title(info.course_code, info.title)
    if task is None:
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
                terms=terms,
            )
        except AppError:
            return  # the course vanished meanwhile; its deletion cleans up on its own
        row.assessment_id = info.id
        await ctx.db.flush()
        # Finished ones stay on the calendar too (marked done), so it always changes.
        await service.announce_item(ctx, "created", row, calendar=True)
        return
    if task.title != title:
        task.title = title
        changed.append("title")
    if (task.due_date, task.due_time) != (due_date, due_time):
        task.due_date, task.due_time = due_date, due_time
        changed.append("due")
    if task.course_id != info.course_id or "due" in changed:
        if task.course_id != info.course_id:
            task.course_id = info.course_id
            changed.append("course_id")
        task.term_id = terms.infer(info.course_id, due_date)
    if info.scored and task.completed_at is None:
        task.completed_at = ctx.now
        changed.append("completed_at")
    if changed:
        task.updated_at = ctx.now
        await ctx.db.flush()
        await service.announce_item(ctx, "updated", task, calendar=True, changed=changed)


async def drop(ctx: Ctx, assessment_id: str) -> None:
    if (row := await task_of(ctx, assessment_id)) is not None:
        await _drop(ctx, row)


async def _drop(ctx: Ctx, row: TasksItem) -> None:
    await ctx.db.delete(row)
    await ctx.db.flush()
    await service.announce_item(ctx, "deleted", row, calendar=row.due_date is not None)
