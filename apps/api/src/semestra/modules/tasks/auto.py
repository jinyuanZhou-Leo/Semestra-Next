"""Tasks generated from assessments (M05 §3).

The grading module (M03) owns assessments. It plugs in what tasks need to know about them with
`set_assessment_provider`; this module never imports grading. Without a provider nothing is
generated.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
from zoneinfo import ZoneInfo

from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.core.events import events
from semestra.modules.academics import service as academics
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


class AssessmentProvider(Protocol):
    async def get(self, ctx: Ctx, assessment_id: str) -> AssessmentInfo | None: ...

    async def open_in_program(self, ctx: Ctx, program_id: str) -> list[AssessmentInfo]:
        """Assessments of the Program that have a due date and no score yet."""
        ...


_provider: AssessmentProvider | None = None


def set_assessment_provider(provider: AssessmentProvider | None) -> None:
    global _provider
    _provider = provider


async def enabled(ctx: Ctx, program_id: str) -> bool:
    return (await service.program_settings(ctx, program_id)).auto_tasks_from_assessments


async def sync_assessment(ctx: Ctx, info: AssessmentInfo | None, assessment_id: str) -> None:
    """Brings the task of one assessment in line with it. `info` is None once it is deleted."""
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
        if info.scored:
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
        await _announce(ctx, "created", row)
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
        await _announce(ctx, "updated", existing, changed)


async def _announce(ctx: Ctx, kind: str, row: TasksItem, changed: list[str] | None = None) -> None:
    data = {
        "task_id": row.id,
        "program_id": row.program_id,
        "course_id": row.course_id,
        "changed": changed or [],
    }
    await events.publish(ctx, f"tasks.item.{kind}", data)
    await events.publish(ctx, "calendar.changed", {"program_id": row.program_id})


async def _drop(ctx: Ctx, row: TasksItem) -> None:
    await ctx.db.delete(row)
    await ctx.db.flush()
    await _announce(ctx, "deleted", row)


async def on_assessment_event(ctx: Ctx, kind: str, program_id: str, assessment_id: str) -> None:
    if _provider is None or not await enabled(ctx, program_id):
        return
    info = None if kind == "deleted" else await _provider.get(ctx, assessment_id)
    await sync_assessment(ctx, info, assessment_id)


async def backfill(ctx: Ctx, program_id: str) -> int:
    """Creates the missing tasks of a Program (after the switch is turned on); returns how
    many were created."""
    if _provider is None:
        return 0
    before = await _count(ctx, program_id)
    for info in await _provider.open_in_program(ctx, program_id):
        await sync_assessment(ctx, info, info.id)
    return await _count(ctx, program_id) - before


async def _count(ctx: Ctx, program_id: str) -> int:
    rows = await ctx.db.scalars(
        select(TasksItem.id).where(
            TasksItem.user_id == ctx.user_id,
            TasksItem.program_id == program_id,
            TasksItem.source_kind == SOURCE_KIND,
        )
    )
    return len(rows.all())
