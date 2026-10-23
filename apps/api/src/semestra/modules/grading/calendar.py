"""Assessment deadlines in the M04 calendar (M03 §5)."""

from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

from semestra.core.context import Ctx
from semestra.core.events import Event, events
from semestra.modules.academics import service as academics
from semestra.modules.grading import service
from semestra.modules.schedule.calendar import (
    Occurrence,
    OccurrenceMeta,
    OccurrenceQuery,
    OccurrenceRef,
    calendar_source,
)


@calendar_source("grading.assessments", kinds=("deadline",))
async def assessments_source(ctx: Ctx, q: OccurrenceQuery) -> list[Occurrence]:
    """Ungraded deadlines; one known only by date is an all-day item on that day."""
    program = await academics.get_program_row(ctx, q.program_id)
    tz = ZoneInfo(program.timezone)
    courses = {
        c.id: c
        for c in await service._program_courses(ctx, program.id, q.term_id)
        if q.wants_course(c.id)
    }
    if not courses:
        return []
    items = await service.assessment_deadlines(
        ctx, program.id, q.range_start, q.range_end, sorted(courses)
    )
    out: list[Occurrence] = []
    for a in items:
        if a.due_at is None or a.due_date is None:
            continue
        course = courses[a.course_id]
        start, end = a.due_at, None
        if not a.due_has_time:
            start = datetime.combine(a.due_date, time(0), tzinfo=tz).astimezone(UTC)
            end = datetime.combine(a.due_date + timedelta(days=1), time(0), tzinfo=tz).astimezone(
                UTC
            )
        out.append(
            Occurrence(
                id=f"grading.assessments:{a.id}",
                source="grading.assessments",
                kind="deadline",
                title=f"{course.alias or course.code or course.title} · {a.title}",
                start_at=start,
                end_at=end,
                all_day=not a.due_has_time,
                course_id=a.course_id,
                color_ref=course.resolved_color,
                status="overdue" if a.status == "overdue" else None,
                ref=OccurrenceRef(entity="grading.assessment", id=a.id),
                meta=OccurrenceMeta(note=a.note),
            )
        )
    return out


# What the calendar shows of an assessment: anything else (weight, category) leaves it as it is.
_SHOWN = {"title", "due_at", "due_has_time", "score_percentage", "dropped", "note"}


@events.subscribe("grading.assessment.created")
@events.subscribe("grading.assessment.updated")
@events.subscribe("grading.assessment.deleted")
async def on_assessment_changed(ctx: Ctx, event: Event) -> None:
    data = event.data
    if event.type == "grading.assessment.updated":
        shown = bool(_SHOWN & set(data.get("changed") or ()))
    else:  # created or deleted: only one with a deadline was ever on the calendar
        shown = bool(data.get("due_changed"))
    if shown:
        await events.publish(ctx, "calendar.changed", {"program_id": data["program_id"]})
