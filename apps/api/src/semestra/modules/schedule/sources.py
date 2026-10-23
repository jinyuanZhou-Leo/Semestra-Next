"""The calendar (M04 §3): this module's two sources, the merged range and today."""

from collections.abc import Sequence
from datetime import date, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.errors import AppError, not_found
from semestra.modules.academics import service as academics
from semestra.modules.academics.models import AcademicsProgram, AcademicsTerm
from semestra.modules.academics.rules import BreakSpan
from semestra.modules.schedule import rules
from semestra.modules.schedule.calendar import (
    Occurrence,
    OccurrenceMeta,
    OccurrenceQuery,
    OccurrenceRef,
    calendar_source,
    collect,
)
from semestra.modules.schedule.common import (
    MAX_RANGE_DAYS,
    UPCOMING_DAYS,
    course_label,
    program_courses,
    program_tz,
    term_info,
)
from semestra.modules.schedule.event_types import type_rows
from semestra.modules.schedule.meetings import exceptions_of, meeting_dates
from semestra.modules.schedule.models import (
    ScheduleEvent,
    ScheduleMeeting,
    ScheduleMeetingException,
)
from semestra.modules.schedule.schemas import (
    CalendarBreak,
    CalendarWeek,
    Occurrences,
    OccurrencesInput,
    Today,
    TodayWeek,
)


async def _range_terms(ctx: Ctx, q: OccurrenceQuery, tz: ZoneInfo) -> list[AcademicsTerm]:
    first = q.range_start.astimezone(tz).date()
    last = (q.range_end - timedelta(microseconds=1)).astimezone(tz).date()
    terms = await academics.program_terms(ctx, q.program_id)
    # A class can be moved to a date outside its term, so terms with such a move into the range
    # count too.
    moved_into = set(
        (
            await ctx.db.scalars(
                select(ScheduleMeeting.term_id)
                .join(ScheduleMeetingException)
                .where(
                    ScheduleMeetingException.user_id == ctx.user_id,
                    ScheduleMeetingException.kind == "moved",
                    ScheduleMeetingException.new_date >= first,
                    ScheduleMeetingException.new_date <= last,
                )
            )
        ).all()
    )
    return [
        t
        for t in terms
        if ((t.start_date <= last and t.end_date >= first) or t.id in moved_into)
        and (q.term_id is None or t.id == q.term_id)
    ]


@calendar_source("schedule.meetings", kinds=("class",))
async def meetings_source(ctx: Ctx, q: OccurrenceQuery) -> list[Occurrence]:
    program = await academics.get_program_row(ctx, q.program_id)
    tz = program_tz(program)
    terms = await _range_terms(ctx, q, tz)
    if not terms:
        return []
    courses = await program_courses(ctx, program.id)
    rows = (
        await ctx.db.scalars(
            select(ScheduleMeeting).where(
                ScheduleMeeting.user_id == ctx.user_id,
                ScheduleMeeting.term_id.in_([t.id for t in terms]),
                ScheduleMeeting.enabled.is_(True),
            )
        )
    ).all()
    rows = [r for r in rows if r.course_id in courses and q.wants_course(r.course_id)]
    exceptions = await exceptions_of(ctx, [r.id for r in rows])
    infos = {t.id: await term_info(ctx, t) for t in terms}
    out: list[Occurrence] = []
    for row in rows:
        course = courses[row.course_id]
        by_date = {e.original_date: e for e in exceptions.get(row.id, [])}
        for md in await meeting_dates(ctx, row, infos[row.term_id]):
            exc = by_date.get(md.day)
            day, start_t, end_t, location = md.day, row.start_time, row.end_time, row.location
            status = None
            original_start = None
            if exc is not None and exc.kind == "cancelled":
                status = "cancelled"
            elif exc is not None:
                status = "moved"
                original_start = rules.local_to_utc(md.day, row.start_time, tz)
                day = exc.new_date or md.day
                start_t = exc.new_start_time or row.start_time
                end_t = exc.new_end_time or row.end_time
                # None keeps the meeting's room; an empty string clears it for this class.
                location = row.location if exc.new_location is None else exc.new_location or None
            start, end = rules.local_span(day, start_t, end_t, tz)
            if not q.range_start <= start < q.range_end:
                continue
            title = course_label(course)
            out.append(
                Occurrence(
                    id=f"schedule.meetings:{row.id}:{md.day.isoformat()}",
                    source="schedule.meetings",
                    kind="class",
                    title=f"{title} · {row.title}" if row.title else title,
                    start_at=start,
                    end_at=end,
                    course_id=course.id,
                    type_code=row.type_code,
                    location=location,
                    color_ref=course.resolved_color,
                    status=status,
                    ref=OccurrenceRef(entity="schedule.meeting", id=row.id),
                    meta=OccurrenceMeta(
                        term_id=row.term_id,
                        meeting_id=row.id,
                        original_date=md.day,
                        original_start_at=original_start,
                        week_number=md.week_number,
                        section_code=row.section_code or None,
                        instructor=row.instructor,
                        note=exc.note if exc is not None else None,
                        updated_at=row.updated_at,
                    ),
                )
            )
    return out


@calendar_source("schedule.events", kinds=("event",))
async def events_source(ctx: Ctx, q: OccurrenceQuery) -> list[Occurrence]:
    await academics.get_program_row(ctx, q.program_id)
    rows = (
        await ctx.db.scalars(
            select(ScheduleEvent).where(
                ScheduleEvent.user_id == ctx.user_id,
                ScheduleEvent.program_id == q.program_id,
                ScheduleEvent.start_at < q.range_end,
                ScheduleEvent.end_at >= q.range_start,
            )
        )
    ).all()
    if q.term_id is not None:
        rows = [r for r in rows if r.term_id in (None, q.term_id)]
    if q.course_ids is not None:
        rows = [r for r in rows if q.wants_course(r.course_id)]
    courses = await program_courses(ctx, q.program_id) if any(r.course_id for r in rows) else {}
    type_colors = {t.code: t.color for t in await type_rows(ctx, q.program_id)}
    out: list[Occurrence] = []
    for r in rows:
        # A point-in-time event that ends exactly at the range start is outside it.
        if r.end_at == q.range_start and r.start_at < q.range_start:
            continue
        course = courses.get(r.course_id) if r.course_id else None
        color = course.resolved_color if course else type_colors.get(r.type_code or "")
        out.append(
            Occurrence(
                id=f"schedule.events:{r.id}",
                source="schedule.events",
                kind="event",
                title=f"{course_label(course)} · {r.title}" if course else r.title,
                start_at=r.start_at,
                end_at=r.end_at,
                all_day=r.all_day,
                course_id=r.course_id,
                type_code=r.type_code,
                location=r.location,
                color_ref=color,
                ref=OccurrenceRef(entity="schedule.event", id=r.id),
                meta=OccurrenceMeta(term_id=r.term_id, note=r.note, updated_at=r.updated_at),
            )
        )
    return out


async def _weeks_and_breaks(
    ctx: Ctx, program_id: str, first: date, last: date, term_id: str | None
) -> tuple[list[CalendarWeek], list[CalendarBreak]]:
    weeks: list[CalendarWeek] = []
    breaks: list[CalendarBreak] = []
    for term in await academics.program_terms(ctx, program_id):
        if term.start_date > last or term.end_date < first or term_id not in (None, term.id):
            continue
        info = await term_info(ctx, term)
        weeks.extend(
            CalendarWeek(
                term_id=term.id,
                start_date=w.start_date,
                end_date=w.end_date,
                number=w.number,
                break_name=w.break_.name if w.break_ else None,
            )
            for w in info.weeks
            if w.start_date <= last and w.end_date >= first
        )
        breaks.extend(
            CalendarBreak(
                term_id=term.id, name=b.name, start_date=b.start_date, end_date=b.end_date
            )
            for b in info.breaks
            if b.start_date <= last and b.end_date >= first
        )
    return weeks, breaks


def calendar_query(
    program: AcademicsProgram,
    start: date,
    end: date,
    term_id: str | None,
    course_ids: Sequence[str] | None,
    *,
    max_days: int,
) -> OccurrenceQuery:
    if end <= start:
        raise AppError("common.validation", 422, errors=[{"loc": ["end"], "code": "before_start"}])
    if (end - start).days > max_days:
        raise AppError("schedule.range_too_large", 422, max_days=max_days)
    tz = program_tz(program)
    return OccurrenceQuery(
        program_id=program.id,
        range_start=rules.local_midnight(start, tz),
        range_end=rules.local_midnight(end, tz),
        term_id=term_id,
        course_ids=frozenset(course_ids) if course_ids is not None else None,
    )


async def occurrences(
    ctx: Ctx, inp: OccurrencesInput, *, max_days: int = MAX_RANGE_DAYS
) -> Occurrences:
    # Read-only: terms and courses are read once for the sources and the weeks.
    with academics.read_memo():
        program = await academics.get_program_row(ctx, inp.program_id)
        if inp.term_id is not None:
            term = await academics.get_term_row(ctx, inp.term_id)
            if term.program_id != program.id:
                raise not_found()
        q = calendar_query(
            program, inp.start, inp.end, inp.term_id, inp.course_ids, max_days=max_days
        )
        items = await collect(ctx, q, inp.sources, inp.kinds)
        weeks, breaks = await _weeks_and_breaks(
            ctx, program.id, inp.start, inp.end - timedelta(days=1), inp.term_id
        )
        return Occurrences(
            timezone=program.timezone,
            start=inp.start,
            end=inp.end,
            items=items,
            weeks=weeks,
            breaks=breaks,
        )


async def today(ctx: Ctx, program_id: str) -> Today:
    # Read-only: terms and courses are read once for the sources and the week.
    with academics.read_memo():
        program = await academics.get_program_row(ctx, program_id)
        tz = program_tz(program)
        day = academics.program_today(ctx, program)
        q = OccurrenceQuery(
            program_id=program.id,
            range_start=rules.local_midnight(day, tz),
            range_end=rules.local_midnight(day + timedelta(days=UPCOMING_DAYS), tz),
            include_overdue=True,
        )
        items = await collect(ctx, q)
        tomorrow = rules.local_midnight(day + timedelta(days=1), tz)
        week: TodayWeek | None = None
        for term in await academics.program_terms(ctx, program.id):
            if term.start_date <= day <= term.end_date:
                found = await academics.term_week_of(ctx, term, day)
                week = TodayWeek(
                    term_id=term.id,
                    term_name=term.name,
                    number=found if isinstance(found, int) else None,
                    break_name=found.name if isinstance(found, BreakSpan) else None,
                )
                break
        return Today(
            day=day,
            timezone=program.timezone,
            week=week,
            items=[o for o in items if o.kind in ("class", "event") and o.start_at < tomorrow],
            upcoming=[
                o
                for o in items
                if o.kind in ("deadline", "task")
                and o.status != "done"
                and o.start_at >= q.range_start
            ],
            tasks=[
                o
                for o in items
                if o.kind == "task" and (o.status == "overdue" or o.start_at < tomorrow)
            ],
        )
