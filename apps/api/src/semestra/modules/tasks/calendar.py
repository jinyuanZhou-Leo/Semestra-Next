"""The `tasks.due` calendar source (M05 §4, M04 §3): unfinished tasks that have a due date.

Tasks generated from an assessment are left out: the assessment is already on the calendar."""

from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

from semestra.core.context import Ctx
from semestra.modules.academics import service as academics
from semestra.modules.schedule.calendar import (
    Occurrence,
    OccurrenceMeta,
    OccurrenceQuery,
    OccurrenceRef,
    calendar_source,
)
from semestra.modules.tasks import rules, service


@calendar_source("tasks.due")
async def due_source(ctx: Ctx, q: OccurrenceQuery) -> list[Occurrence]:
    """A task with a time is a point in time; one with only a date is an all-day item. With
    `include_overdue` the unfinished ones before the range come along, marked `overdue`."""
    program = await academics.get_program_row(ctx, q.program_id)
    zone = ZoneInfo(program.timezone)
    now_local = ctx.now.astimezone(zone)
    rows = [
        r
        for r in await service.program_rows(ctx, program.id, term_id=q.term_id)
        if r.due_date is not None
        and r.completed_at is None
        and r.source_kind != "assessment"  # `grading.assessments` already shows the assessment
        and q.wants_course(r.course_id)
    ]
    colors = {
        c.id: c.resolved_color
        for c in await academics.courses_out(
            ctx,
            program,
            [
                await academics.get_course_row(ctx, i)
                for i in {r.course_id for r in rows if r.course_id}
            ],
        )
    }
    out: list[Occurrence] = []
    for r in rows:
        assert r.due_date is not None
        midnight = datetime.combine(r.due_date, time(0), tzinfo=zone)
        all_day = r.due_time is None
        start = midnight if all_day else datetime.combine(r.due_date, r.due_time, tzinfo=zone)  # pyright: ignore[reportArgumentType]
        start = start.astimezone(UTC)
        in_range = q.range_start <= start < q.range_end
        if not in_range and not (q.include_overdue and start < q.range_start):
            continue
        out.append(
            Occurrence(
                id=f"tasks.due:{r.id}",
                source="tasks.due",
                kind="task",
                title=r.title,
                start_at=start,
                end_at=(midnight + timedelta(days=1)).astimezone(UTC) if all_day else None,
                all_day=all_day,
                course_id=r.course_id,
                color_ref=colors.get(r.course_id) if r.course_id else None,
                status="overdue"
                if rules.is_overdue(r.due_date, r.due_time, False, now_local)
                else None,
                ref=OccurrenceRef(entity="tasks.item", id=r.id),
                meta=OccurrenceMeta(term_id=r.term_id),
            )
        )
    return out
