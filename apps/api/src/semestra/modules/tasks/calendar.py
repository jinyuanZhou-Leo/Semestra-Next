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


@calendar_source("tasks.due", kinds=("task",))
async def due_source(ctx: Ctx, q: OccurrenceQuery) -> list[Occurrence]:
    """A task with a time is a point in time; one with only a date is an all-day item. With
    `include_overdue` the unfinished ones before the range come along, marked `overdue`."""
    program = await academics.get_program_row(ctx, q.program_id)
    zone = ZoneInfo(program.timezone)
    now_local = ctx.now.astimezone(zone)
    # Overdue tasks may be due any time before the range; a day either side covers the zone.
    first = None if q.include_overdue else (q.range_start.astimezone(zone) - timedelta(days=1))
    last = q.range_end.astimezone(zone) + timedelta(days=1)
    rows = [
        r
        for r in await service.program_rows(
            ctx,
            program.id,
            term_id=q.term_id,
            open_only=True,
            due_from=first.date() if first else None,
            due_to=last.date(),
        )
        if r.source_kind != "assessment"  # `grading.assessments` already shows the assessment
        and q.wants_course(r.course_id)
    ]
    courses = await academics.courses_by_id(ctx, sorted({r.course_id for r in rows if r.course_id}))
    colors = {c.id: c.resolved_color for c in await academics.courses_out(ctx, program, courses)}
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
