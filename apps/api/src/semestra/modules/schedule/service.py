"""Class schedule, one-off events and the calendar (M04). Capabilities stay thin."""

import hashlib
import secrets
from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import delete, func, select

from semestra.core.context import Ctx
from semestra.core.db import new_id
from semestra.core.errors import AppError, not_found
from semestra.core.events import events
from semestra.modules.academics import service as academics
from semestra.modules.academics.models import AcademicsProgram, AcademicsTerm
from semestra.modules.academics.rules import BreakSpan, Week
from semestra.modules.academics.schemas import Course, CourseListInput
from semestra.modules.schedule import rules
from semestra.modules.schedule.calendar import (
    Occurrence,
    OccurrenceMeta,
    OccurrenceQuery,
    OccurrenceRef,
    calendar_source,
    collect,
)
from semestra.modules.schedule.models import (
    ScheduleEvent,
    ScheduleEventType,
    ScheduleFeed,
    ScheduleMeeting,
    ScheduleMeetingException,
)
from semestra.modules.schedule.schemas import (
    CalendarBreak,
    CalendarWeek,
    ConflictPair,
    Event,
    EventCreateInput,
    EventListInput,
    EventType,
    EventTypeCreateInput,
    EventTypeUpdateInput,
    EventUpdateInput,
    ExceptionUpsertInput,
    Feed,
    FeedCreated,
    FeedCreateInput,
    Meeting,
    MeetingCreateManyResult,
    MeetingException,
    MeetingFields,
    MeetingUpdateInput,
    Occurrences,
    OccurrencesInput,
    Today,
    TodayWeek,
)

MAX_RANGE_DAYS = 120
EXPORT_MAX_RANGE_DAYS = 400
UPCOMING_DAYS = 7

BUILTIN_TYPES = (("LEC", "Lecture", "presentation"), ("PRA", "Practical", "flask-conical"))
BUILTIN_TYPES += (("TUT", "Tutorial", "users"),)

# What each feed option includes (M04 §2 `schedule_feeds.sources`).
FEED_SOURCES: dict[str, tuple[str, ...]] = {
    "schedule": ("schedule.meetings", "schedule.events"),
    "assessments": ("grading.assessments",),
    "tasks": ("tasks.due",),
    "lms": ("lms.events",),
}


def _columns(row: Any) -> dict[str, Any]:
    return {c.key: getattr(row, c.key) for c in row.__table__.columns}


async def _changed(ctx: Ctx, program_id: str, event_type: str, data: dict[str, Any]) -> None:
    """Every schedule write announces itself and that the Program's calendar changed."""
    await events.publish(ctx, event_type, {**data, "program_id": program_id})
    await events.publish(ctx, "calendar.changed", {"program_id": program_id})


def _tz(program: AcademicsProgram) -> ZoneInfo:
    return ZoneInfo(program.timezone)


# --- event types ----------------------------------------------------------------------------


async def ensure_event_types(ctx: Ctx, program_id: str) -> None:
    """A Program always has the built-in LEC/PRA/TUT (written on creation; also on first use
    for Programs created before this module)."""
    count = await ctx.db.scalar(
        select(func.count())
        .select_from(ScheduleEventType)
        .where(ScheduleEventType.user_id == ctx.user_id, ScheduleEventType.program_id == program_id)
    )
    if count:
        return
    ctx.db.add_all(
        ScheduleEventType(
            id=new_id(),
            user_id=ctx.user_id,
            program_id=program_id,
            code=code,
            name=name,
            icon=icon,
            builtin=True,
            position=i,
        )
        for i, (code, name, icon) in enumerate(BUILTIN_TYPES)
    )
    await ctx.db.flush()


async def _type_rows(ctx: Ctx, program_id: str) -> list[ScheduleEventType]:
    await ensure_event_types(ctx, program_id)
    return list(
        (
            await ctx.db.scalars(
                select(ScheduleEventType)
                .where(
                    ScheduleEventType.user_id == ctx.user_id,
                    ScheduleEventType.program_id == program_id,
                )
                .order_by(ScheduleEventType.position, ScheduleEventType.code)
            )
        ).all()
    )


async def list_event_types(ctx: Ctx, program_id: str) -> list[EventType]:
    await academics.get_program_row(ctx, program_id)
    return [EventType.model_validate(_columns(r)) for r in await _type_rows(ctx, program_id)]


async def _type_row(ctx: Ctx, type_id: str) -> ScheduleEventType:
    row = await ctx.db.get(ScheduleEventType, type_id)
    if row is None or row.user_id != ctx.user_id:
        raise not_found()
    return row


async def _check_type_code(ctx: Ctx, program_id: str, code: str | None) -> None:
    if code is None:
        return
    if code not in {t.code for t in await _type_rows(ctx, program_id)}:
        raise AppError(
            "common.validation", 422, errors=[{"loc": ["type_code"], "code": "unknown_type"}]
        )


async def create_event_type(ctx: Ctx, inp: EventTypeCreateInput) -> EventType:
    await academics.get_program_row(ctx, inp.program_id)
    rows = await _type_rows(ctx, inp.program_id)
    if any(r.code == inp.code for r in rows):
        raise AppError("common.conflict", 409, type_code=inp.code)
    row = ScheduleEventType(
        id=new_id(),
        user_id=ctx.user_id,
        program_id=inp.program_id,
        code=inp.code,
        name=inp.name,
        color=inp.color,
        icon=inp.icon,
        builtin=False,
        position=max((r.position for r in rows), default=-1) + 1,
    )
    ctx.db.add(row)
    await ctx.db.flush()
    await _changed(ctx, row.program_id, "schedule.event_type.created", {"event_type_id": row.id})
    return EventType.model_validate(_columns(row))


async def update_event_type(ctx: Ctx, inp: EventTypeUpdateInput) -> EventType:
    row = await _type_row(ctx, inp.event_type_id)
    sent = inp.model_fields_set - {"event_type_id"}
    if "name" in sent:
        if inp.name is None or row.builtin:
            # Built-in types are named by the app in the user's language.
            raise AppError("common.validation", 422, errors=[{"loc": ["name"], "code": "fixed"}])
        row.name = inp.name
    if "color" in sent:
        row.color = inp.color
    if "icon" in sent:
        row.icon = inp.icon
    await ctx.db.flush()
    await _changed(ctx, row.program_id, "schedule.event_type.updated", {"event_type_id": row.id})
    return EventType.model_validate(_columns(row))


async def delete_event_type(ctx: Ctx, type_id: str) -> None:
    row = await _type_row(ctx, type_id)
    if row.builtin:
        raise AppError("common.validation", 422, errors=[{"loc": ["builtin"], "code": "fixed"}])
    meetings = await ctx.db.scalar(
        select(func.count())
        .select_from(ScheduleMeeting)
        .where(
            ScheduleMeeting.user_id == ctx.user_id,
            ScheduleMeeting.course_id.in_(await _program_course_ids(ctx, row.program_id)),
            ScheduleMeeting.type_code == row.code,
        )
    )
    used_events = await ctx.db.scalar(
        select(func.count())
        .select_from(ScheduleEvent)
        .where(
            ScheduleEvent.user_id == ctx.user_id,
            ScheduleEvent.program_id == row.program_id,
            ScheduleEvent.type_code == row.code,
        )
    )
    count = (meetings or 0) + (used_events or 0)
    if count:
        raise AppError("schedule.event_type_in_use", 409, count=count)
    await ctx.db.delete(row)
    await ctx.db.flush()
    await _changed(ctx, row.program_id, "schedule.event_type.deleted", {"event_type_id": row.id})


async def reorder_event_types(ctx: Ctx, program_id: str, ids: Sequence[str]) -> list[EventType]:
    await academics.get_program_row(ctx, program_id)
    rows = await _type_rows(ctx, program_id)
    wanted = [i for i in dict.fromkeys(ids) if i in {r.id for r in rows}]
    rest = [r.id for r in rows if r.id not in wanted]
    position = {type_id: i for i, type_id in enumerate([*wanted, *rest])}
    for r in rows:
        r.position = position[r.id]
    await ctx.db.flush()
    await _changed(ctx, program_id, "schedule.event_type.updated", {"fields": ["position"]})
    return await list_event_types(ctx, program_id)


# --- courses and terms ----------------------------------------------------------------------


async def _program_courses(ctx: Ctx, program_id: str) -> dict[str, Course]:
    courses: dict[str, Course] = {}
    cursor: str | None = None
    while True:
        page = await academics.list_courses(
            ctx, CourseListInput(program_id=program_id, cursor=cursor, limit=500)
        )
        courses.update((c.id, c) for c in page.items)
        if page.next_cursor is None:
            return courses
        cursor = page.next_cursor


async def _program_course_ids(ctx: Ctx, program_id: str) -> list[str]:
    return list(await _program_courses(ctx, program_id))


def course_label(course: Course) -> str:
    return course.alias or course.code or course.title


@dataclass
class TermInfo:
    term: AcademicsTerm
    weeks: list[Week]
    breaks: list[BreakSpan]


async def _term_info(ctx: Ctx, term: AcademicsTerm) -> TermInfo:
    weeks = await academics.weeks_of(ctx, term)
    breaks = [
        BreakSpan(
            b["id"],
            b["name"],
            date.fromisoformat(b["start_date"]),
            date.fromisoformat(b["end_date"]),
        )
        for b in term.breaks
    ]
    return TermInfo(term, weeks, breaks)


# --- meetings -------------------------------------------------------------------------------


async def _meeting_row(ctx: Ctx, meeting_id: str) -> ScheduleMeeting:
    row = await ctx.db.get(ScheduleMeeting, meeting_id)
    if row is None or row.user_id != ctx.user_id:
        raise not_found()
    return row


async def _exceptions(
    ctx: Ctx, meeting_ids: Iterable[str]
) -> dict[str, list[ScheduleMeetingException]]:
    ids = list(meeting_ids)
    out: dict[str, list[ScheduleMeetingException]] = defaultdict(list)
    if not ids:
        return out
    rows = (
        await ctx.db.scalars(
            select(ScheduleMeetingException)
            .where(
                ScheduleMeetingException.user_id == ctx.user_id,
                ScheduleMeetingException.meeting_id.in_(ids),
            )
            .order_by(ScheduleMeetingException.original_date)
        )
    ).all()
    for r in rows:
        out[r.meeting_id].append(r)
    return out


async def meetings_out(ctx: Ctx, rows: Sequence[ScheduleMeeting]) -> list[Meeting]:
    exceptions = await _exceptions(ctx, [r.id for r in rows])
    return [
        Meeting.model_validate(
            {
                **_columns(r),
                "exceptions": [
                    MeetingException.model_validate(_columns(e)) for e in exceptions.get(r.id, [])
                ],
            }
        )
        for r in rows
    ]


def _check_meeting(row: ScheduleMeeting) -> None:
    if row.start_time >= row.end_time:
        raise AppError("schedule.time_range_invalid", 422)
    if row.end_week is not None and row.end_week < row.start_week:
        raise AppError("schedule.week_range_invalid", 422)
    if row.recurrence == "weekly":
        row.anchor_week = row.start_week


async def _course_with_term(ctx: Ctx, course_id: str, term_id: str) -> Course:
    course = await academics.course_out(ctx, await academics.get_course_row(ctx, course_id))
    if term_id not in course.term_ids:
        raise AppError("schedule.term_not_in_course", 422)
    return course


async def list_meetings(ctx: Ctx, course_id: str, term_id: str | None) -> list[Meeting]:
    course = await academics.get_course_row(ctx, course_id)
    q = select(ScheduleMeeting).where(
        ScheduleMeeting.user_id == ctx.user_id, ScheduleMeeting.course_id == course.id
    )
    if term_id is not None:
        q = q.where(ScheduleMeeting.term_id == term_id)
    rows = (await ctx.db.scalars(q)).all()
    order = {t.id: i for i, t in enumerate(await academics.program_terms(ctx, course.program_id))}
    rows = sorted(
        rows, key=lambda r: (order.get(r.term_id, 99), r.weekday, r.start_time, r.section_code)
    )
    return await meetings_out(ctx, rows)


def _apply_fields(row: ScheduleMeeting, fields: MeetingFields) -> None:
    data = fields.model_dump()
    anchor = data.pop("anchor_week")
    for key, value in data.items():
        setattr(row, key, value)
    row.anchor_week = anchor if anchor is not None else row.start_week


async def _new_meeting(ctx: Ctx, course: Course, fields: MeetingFields) -> ScheduleMeeting:
    row = ScheduleMeeting(
        id=new_id(),
        user_id=ctx.user_id,
        course_id=course.id,
        created_at=ctx.now,
        updated_at=ctx.now,
    )
    _apply_fields(row, fields)
    _check_meeting(row)
    ctx.db.add(row)
    return row


async def create_meeting(ctx: Ctx, course_id: str, fields: MeetingFields) -> Meeting:
    course = await _course_with_term(ctx, course_id, fields.term_id)
    await _check_type_code(ctx, course.program_id, fields.type_code)
    row = await _new_meeting(ctx, course, fields)
    await ctx.db.flush()
    await _changed(
        ctx,
        course.program_id,
        "schedule.meeting.created",
        {"meeting_id": row.id, "course_id": course.id},
    )
    return (await meetings_out(ctx, [row]))[0]


async def create_meetings(
    ctx: Ctx, course_id: str, items: Sequence[MeetingFields]
) -> MeetingCreateManyResult:
    """Import: an item whose (source_kind, source_ref) is already in the course updates it."""
    course = await academics.course_out(ctx, await academics.get_course_row(ctx, course_id))
    types = {t.code for t in await _type_rows(ctx, course.program_id)}
    existing = {
        (r.source_kind, r.source_ref): r
        for r in (
            await ctx.db.scalars(
                select(ScheduleMeeting).where(
                    ScheduleMeeting.user_id == ctx.user_id,
                    ScheduleMeeting.course_id == course.id,
                    ScheduleMeeting.source_ref.is_not(None),
                )
            )
        ).all()
    }
    rows: list[ScheduleMeeting] = []
    created: list[str] = []
    updated: list[str] = []
    for i, item in enumerate(items):
        if item.term_id not in course.term_ids:
            raise AppError("schedule.term_not_in_course", 422, index=i)
        if item.type_code not in types:
            raise AppError(
                "common.validation",
                422,
                errors=[{"loc": ["meetings", i, "type_code"], "code": "unknown_type"}],
            )
        key = (item.source_kind, item.source_ref)
        row = existing.get(key) if item.source_ref is not None else None
        if row is None:
            row = await _new_meeting(ctx, course, item)
            if item.source_ref is not None:
                existing[key] = row
            created.append(row.id)
        else:
            _apply_fields(row, item)
            _check_meeting(row)
            row.updated_at = ctx.now
            if row.id not in created:
                updated.append(row.id)
        rows.append(row)
    await ctx.db.flush()
    await _changed(
        ctx,
        course.program_id,
        "schedule.meeting.created",
        {"course_id": course.id, "meeting_ids": created, "updated_ids": updated},
    )
    unique = list({r.id: r for r in rows}.values())
    return MeetingCreateManyResult(
        items=await meetings_out(ctx, unique), created_ids=created, updated_ids=updated
    )


_NULLABLE_MEETING = {"title", "instructor", "location", "end_week"}


async def update_meeting(ctx: Ctx, inp: MeetingUpdateInput) -> Meeting:
    row = await _meeting_row(ctx, inp.meeting_id)
    sent = inp.model_fields_set - {"meeting_id"}
    bad = sorted(f for f in sent if getattr(inp, f) is None and f not in _NULLABLE_MEETING)
    if bad:
        raise AppError(
            "common.validation", 422, errors=[{"loc": [f], "code": "none_not_allowed"} for f in bad]
        )
    course = await _course_with_term(ctx, row.course_id, inp.term_id or row.term_id)
    if "type_code" in sent:
        await _check_type_code(ctx, course.program_id, inp.type_code)
    changed = sorted(f for f in sent if getattr(row, f) != getattr(inp, f))
    for field in changed:
        setattr(row, field, getattr(inp, field))
    if "start_week" in changed and "anchor_week" not in sent and row.recurrence == "biweekly":
        row.anchor_week = max(row.anchor_week, row.start_week)
    _check_meeting(row)
    if changed:
        row.updated_at = ctx.now
        await ctx.db.flush()
        await _changed(
            ctx,
            course.program_id,
            "schedule.meeting.updated",
            {"meeting_id": row.id, "course_id": row.course_id, "fields": changed},
        )
    return (await meetings_out(ctx, [row]))[0]


async def delete_meeting(ctx: Ctx, meeting_id: str) -> None:
    row = await _meeting_row(ctx, meeting_id)
    course = await academics.get_course_row(ctx, row.course_id)
    await ctx.db.execute(
        delete(ScheduleMeetingException).where(ScheduleMeetingException.meeting_id == row.id)
    )
    await ctx.db.delete(row)
    await ctx.db.flush()
    await _changed(
        ctx,
        course.program_id,
        "schedule.meeting.deleted",
        {"meeting_id": row.id, "course_id": course.id},
    )


async def set_enabled(
    ctx: Ctx, course_id: str, meeting_ids: Sequence[str], enabled: bool
) -> list[Meeting]:
    course = await academics.get_course_row(ctx, course_id)
    rows = (
        await ctx.db.scalars(
            select(ScheduleMeeting).where(
                ScheduleMeeting.user_id == ctx.user_id,
                ScheduleMeeting.course_id == course.id,
                ScheduleMeeting.id.in_(list(meeting_ids)),
            )
        )
    ).all()
    if len(rows) != len(set(meeting_ids)):
        raise not_found()
    changed = [r for r in rows if r.enabled != enabled]
    for r in changed:
        r.enabled = enabled
        r.updated_at = ctx.now
    if changed:
        await ctx.db.flush()
        await _changed(
            ctx,
            course.program_id,
            "schedule.meeting.updated",
            {"course_id": course.id, "meeting_ids": [r.id for r in changed], "fields": ["enabled"]},
        )
    return await list_meetings(ctx, course.id, None)


async def _meeting_dates(
    ctx: Ctx, row: ScheduleMeeting, info: TermInfo | None = None
) -> list[rules.MeetingDate]:
    if info is None:
        info = await _term_info(ctx, await academics.get_term_row(ctx, row.term_id))
    return rules.meeting_dates(
        _recurrence(row), info.term.start_date, info.term.end_date, info.weeks, info.breaks
    )


def _recurrence(row: ScheduleMeeting) -> rules.Recurrence:
    return rules.Recurrence(
        weekday=row.weekday,
        recurrence=row.recurrence,
        anchor_week=row.anchor_week,
        start_week=row.start_week,
        end_week=row.end_week,
        skip_breaks=row.skip_breaks,
    )


async def upsert_exception(ctx: Ctx, inp: ExceptionUpsertInput) -> Meeting:
    row = await _meeting_row(ctx, inp.meeting_id)
    course = await academics.get_course_row(ctx, row.course_id)
    if inp.original_date not in {d.day for d in await _meeting_dates(ctx, row)}:
        raise AppError(
            "common.validation", 422, errors=[{"loc": ["original_date"], "code": "no_class"}]
        )
    start = inp.new_start_time or row.start_time
    end = inp.new_end_time or row.end_time
    if inp.kind == "moved" and start >= end:
        raise AppError("schedule.time_range_invalid", 422)
    exc = await ctx.db.scalar(
        select(ScheduleMeetingException).where(
            ScheduleMeetingException.meeting_id == row.id,
            ScheduleMeetingException.original_date == inp.original_date,
        )
    )
    if exc is None:
        exc = ScheduleMeetingException(
            id=new_id(), user_id=ctx.user_id, meeting_id=row.id, original_date=inp.original_date
        )
        ctx.db.add(exc)
    moved = inp.kind == "moved"
    exc.kind = inp.kind
    exc.new_date = inp.new_date if moved else None
    exc.new_start_time = inp.new_start_time if moved else None
    exc.new_end_time = inp.new_end_time if moved else None
    exc.new_location = inp.new_location if moved else None
    exc.note = inp.note
    await ctx.db.flush()
    await _changed(
        ctx,
        course.program_id,
        "schedule.exception.upserted",
        {
            "meeting_id": row.id,
            "course_id": course.id,
            "original_date": inp.original_date.isoformat(),
        },
    )
    return (await meetings_out(ctx, [row]))[0]


async def delete_exception(ctx: Ctx, meeting_id: str, original_date: date) -> Meeting:
    row = await _meeting_row(ctx, meeting_id)
    course = await academics.get_course_row(ctx, row.course_id)
    result = await ctx.db.execute(
        delete(ScheduleMeetingException).where(
            ScheduleMeetingException.user_id == ctx.user_id,
            ScheduleMeetingException.meeting_id == row.id,
            ScheduleMeetingException.original_date == original_date,
        )
    )
    if not getattr(result, "rowcount", 0):
        raise not_found()
    await ctx.db.flush()
    await _changed(
        ctx,
        course.program_id,
        "schedule.exception.deleted",
        {"meeting_id": row.id, "course_id": course.id, "original_date": original_date.isoformat()},
    )
    return (await meetings_out(ctx, [row]))[0]


async def conflicts(ctx: Ctx, term_id: str) -> list[ConflictPair]:
    """Pairs of enabled meetings of the term that share at least one date and overlap in time."""
    term = await academics.get_term_row(ctx, term_id)
    info = await _term_info(ctx, term)
    rows = (
        await ctx.db.scalars(
            select(ScheduleMeeting).where(
                ScheduleMeeting.user_id == ctx.user_id,
                ScheduleMeeting.term_id == term.id,
                ScheduleMeeting.enabled.is_(True),
            )
        )
    ).all()
    rows = sorted(rows, key=lambda r: (r.weekday, r.start_time, r.id))
    dates = {r.id: {d.day for d in await _meeting_dates(ctx, r, info)} for r in rows}
    out: list[ConflictPair] = []
    for i, a in enumerate(rows):
        for b in rows[i + 1 :]:
            if a.weekday != b.weekday or not rules.times_overlap(
                a.start_time, a.end_time, b.start_time, b.end_time
            ):
                continue
            shared = sorted(dates[a.id] & dates[b.id])
            if shared:
                out.append(
                    ConflictPair(
                        meeting_id=a.id, other_meeting_id=b.id, weekday=a.weekday, dates=shared
                    )
                )
    return out


# --- one-off events -------------------------------------------------------------------------


async def _event_row(ctx: Ctx, event_id: str) -> ScheduleEvent:
    row = await ctx.db.get(ScheduleEvent, event_id)
    if row is None or row.user_id != ctx.user_id:
        raise not_found()
    return row


def _aware(value: datetime, tz: ZoneInfo) -> datetime:
    """Datetimes without an offset are read in the Program's time zone."""
    return (value.replace(tzinfo=tz) if value.tzinfo is None else value).astimezone(UTC)


def _normalize_times(
    start: datetime, end: datetime, all_day: bool, tz: ZoneInfo
) -> tuple[datetime, datetime]:
    """All-day events span whole local days: from the first day's midnight to the midnight after
    the last day."""
    start, end = _aware(start, tz), _aware(end, tz)
    if end < start:
        raise AppError("schedule.time_range_invalid", 422)
    if not all_day:
        return start, end
    first = start.astimezone(tz).date()
    local_end = end.astimezone(tz)
    last = local_end.date()
    if local_end.time() == time(0, 0) and last > first:
        last -= timedelta(days=1)
    return rules.local_midnight(first, tz), rules.local_midnight(last + timedelta(days=1), tz)


async def _check_event_links(
    ctx: Ctx, program_id: str, course_id: str | None, term_id: str | None
) -> None:
    if course_id is not None:
        course = await academics.course_out(ctx, await academics.get_course_row(ctx, course_id))
        if course.program_id != program_id:
            raise not_found()
        if term_id is not None and term_id not in course.term_ids:
            raise AppError("schedule.term_not_in_course", 422)
    if term_id is not None:
        term = await academics.get_term_row(ctx, term_id)
        if term.program_id != program_id:
            raise not_found()


def event_out(row: ScheduleEvent) -> Event:
    return Event.model_validate(_columns(row))


async def list_events(ctx: Ctx, inp: EventListInput) -> list[Event]:
    await academics.get_program_row(ctx, inp.program_id)
    q = select(ScheduleEvent).where(
        ScheduleEvent.user_id == ctx.user_id, ScheduleEvent.program_id == inp.program_id
    )
    if inp.course_id is not None:
        q = q.where(ScheduleEvent.course_id == inp.course_id)
    if inp.term_id is not None:
        q = q.where(ScheduleEvent.term_id == inp.term_id)
    rows = (await ctx.db.scalars(q.order_by(ScheduleEvent.start_at, ScheduleEvent.id))).all()
    return [event_out(r) for r in rows]


async def create_event(ctx: Ctx, inp: EventCreateInput) -> Event:
    program = await academics.get_program_row(ctx, inp.program_id)
    await _check_event_links(ctx, program.id, inp.course_id, inp.term_id)
    await _check_type_code(ctx, program.id, inp.type_code)
    start, end = _normalize_times(inp.start_at, inp.end_at, inp.all_day, _tz(program))
    row = ScheduleEvent(
        id=new_id(),
        user_id=ctx.user_id,
        program_id=program.id,
        term_id=inp.term_id,
        course_id=inp.course_id,
        type_code=inp.type_code,
        title=inp.title,
        start_at=start,
        end_at=end,
        all_day=inp.all_day,
        location=inp.location,
        note=inp.note,
        source_kind=inp.source_kind,
        source_ref=inp.source_ref,
        created_at=ctx.now,
        updated_at=ctx.now,
    )
    ctx.db.add(row)
    await ctx.db.flush()
    await _changed(ctx, program.id, "schedule.event.created", {"event_id": row.id})
    return event_out(row)


_NULLABLE_EVENT = {"course_id", "term_id", "type_code", "location", "note"}


async def update_event(ctx: Ctx, inp: EventUpdateInput) -> Event:
    row = await _event_row(ctx, inp.event_id)
    program = await academics.get_program_row(ctx, row.program_id)
    sent = inp.model_fields_set - {"event_id"}
    bad = sorted(f for f in sent if getattr(inp, f) is None and f not in _NULLABLE_EVENT)
    if bad:
        raise AppError(
            "common.validation", 422, errors=[{"loc": [f], "code": "none_not_allowed"} for f in bad]
        )
    course_id = inp.course_id if "course_id" in sent else row.course_id
    term_id = inp.term_id if "term_id" in sent else row.term_id
    await _check_event_links(ctx, program.id, course_id, term_id)
    if "type_code" in sent:
        await _check_type_code(ctx, program.id, inp.type_code)
    for field in ("title", "course_id", "term_id", "type_code", "location", "note"):
        if field in sent:
            setattr(row, field, getattr(inp, field))
    if sent & {"start_at", "end_at", "all_day"}:
        all_day = inp.all_day if inp.all_day is not None else row.all_day
        start = inp.start_at or row.start_at
        end = inp.end_at or row.end_at
        if inp.start_at is not None and inp.end_at is None:
            end = _aware(start, _tz(program)) + (row.end_at - row.start_at)  # keep the duration
        row.start_at, row.end_at = _normalize_times(start, end, all_day, _tz(program))
        row.all_day = all_day
    row.updated_at = ctx.now
    await ctx.db.flush()
    await _changed(
        ctx, program.id, "schedule.event.updated", {"event_id": row.id, "fields": sorted(sent)}
    )
    return event_out(row)


async def delete_event(ctx: Ctx, event_id: str) -> None:
    row = await _event_row(ctx, event_id)
    await ctx.db.delete(row)
    await ctx.db.flush()
    await _changed(ctx, row.program_id, "schedule.event.deleted", {"event_id": row.id})


# --- calendar sources -----------------------------------------------------------------------


async def _range_terms(ctx: Ctx, q: OccurrenceQuery, tz: ZoneInfo) -> list[AcademicsTerm]:
    first = q.range_start.astimezone(tz).date()
    last = (q.range_end - timedelta(microseconds=1)).astimezone(tz).date()
    terms = await academics.program_terms(ctx, q.program_id)
    return [
        t
        for t in terms
        if t.start_date <= last and t.end_date >= first and (q.term_id is None or t.id == q.term_id)
    ]


@calendar_source("schedule.meetings")
async def meetings_source(ctx: Ctx, q: OccurrenceQuery) -> list[Occurrence]:
    program = await academics.get_program_row(ctx, q.program_id)
    tz = _tz(program)
    terms = await _range_terms(ctx, q, tz)
    if not terms:
        return []
    courses = await _program_courses(ctx, program.id)
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
    exceptions = await _exceptions(ctx, [r.id for r in rows])
    infos = {t.id: await _term_info(ctx, t) for t in terms}
    out: list[Occurrence] = []
    for row in rows:
        course = courses[row.course_id]
        by_date = {e.original_date: e for e in exceptions.get(row.id, [])}
        for md in await _meeting_dates(ctx, row, infos[row.term_id]):
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
                location = exc.new_location or row.location
            start = rules.local_to_utc(day, start_t, tz)
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
                    end_at=rules.local_to_utc(day, end_t, tz),
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
                    ),
                )
            )
    return out


@calendar_source("schedule.events")
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
    courses = await _program_courses(ctx, q.program_id) if any(r.course_id for r in rows) else {}
    type_colors = {t.code: t.color for t in await _type_rows(ctx, q.program_id)}
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
                meta=OccurrenceMeta(term_id=r.term_id, note=r.note),
            )
        )
    return out


# --- calendar -------------------------------------------------------------------------------


async def _weeks_and_breaks(
    ctx: Ctx, program_id: str, first: date, last: date, term_id: str | None
) -> tuple[list[CalendarWeek], list[CalendarBreak]]:
    weeks: list[CalendarWeek] = []
    breaks: list[CalendarBreak] = []
    for term in await academics.program_terms(ctx, program_id):
        if term.start_date > last or term.end_date < first or term_id not in (None, term.id):
            continue
        info = await _term_info(ctx, term)
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


def _query(
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
    tz = _tz(program)
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
    program = await academics.get_program_row(ctx, inp.program_id)
    if inp.term_id is not None:
        term = await academics.get_term_row(ctx, inp.term_id)
        if term.program_id != program.id:
            raise not_found()
    q = _query(program, inp.start, inp.end, inp.term_id, inp.course_ids, max_days=max_days)
    items = await collect(ctx, q, inp.sources)
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
    program = await academics.get_program_row(ctx, program_id)
    tz = _tz(program)
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
            if o.kind in ("deadline", "task") and o.status != "done" and o.start_at >= q.range_start
        ],
        tasks=[
            o
            for o in items
            if o.kind == "task" and (o.status == "overdue" or o.start_at < tomorrow)
        ],
    )


# --- feeds ----------------------------------------------------------------------------------


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def feed_out(row: ScheduleFeed) -> Feed:
    return Feed.model_validate(_columns(row))


def feed_url(ctx: Ctx, token: str) -> str:
    return f"{ctx.settings.public_api_origin.rstrip('/')}/feeds/{token}.ics"


async def list_feeds(ctx: Ctx, program_id: str) -> list[Feed]:
    await academics.get_program_row(ctx, program_id)
    rows = (
        await ctx.db.scalars(
            select(ScheduleFeed)
            .where(ScheduleFeed.user_id == ctx.user_id, ScheduleFeed.program_id == program_id)
            .order_by(ScheduleFeed.created_at.desc())
        )
    ).all()
    return [feed_out(r) for r in rows]


async def create_feed(ctx: Ctx, inp: FeedCreateInput) -> FeedCreated:
    await academics.get_program_row(ctx, inp.program_id)
    token = secrets.token_urlsafe(32)
    row = ScheduleFeed(
        id=new_id(),
        user_id=ctx.user_id,
        program_id=inp.program_id,
        token_hash=_token_hash(token),
        prefix=token[:6],
        name=inp.name,
        sources=list(dict.fromkeys(inp.sources)),
        created_at=ctx.now,
    )
    ctx.db.add(row)
    await ctx.db.flush()
    await events.publish(
        ctx, "schedule.feed.created", {"feed_id": row.id, "program_id": row.program_id}
    )
    return FeedCreated(feed=feed_out(row), url=feed_url(ctx, token))


async def revoke_feed(ctx: Ctx, feed_id: str) -> Feed:
    row = await ctx.db.get(ScheduleFeed, feed_id)
    if row is None or row.user_id != ctx.user_id:
        raise not_found()
    if row.revoked_at is None:
        row.revoked_at = ctx.now
        await ctx.db.flush()
        await events.publish(
            ctx, "schedule.feed.revoked", {"feed_id": row.id, "program_id": row.program_id}
        )
    return feed_out(row)


async def feed_by_token(ctx: Ctx, token: str) -> ScheduleFeed:
    """Unknown tokens are not found; revoked ones say so (same status, nothing to leak)."""
    row = await ctx.db.scalar(
        select(ScheduleFeed).where(ScheduleFeed.token_hash == _token_hash(token))
    )
    if row is None:
        raise not_found()
    if row.revoked_at is not None:
        raise AppError("schedule.feed_revoked", 404)
    return row


async def feed_occurrences(
    ctx: Ctx, feed: ScheduleFeed
) -> tuple[AcademicsProgram, list[Occurrence]]:
    """The last 12 months and the next 6 months of the feed's sources."""
    program = await academics.get_program_row(ctx, feed.program_id)
    day = academics.program_today(ctx, program)
    q = _query(
        program, day - timedelta(days=365), day + timedelta(days=183), None, None, max_days=600
    )
    names = [n for s in feed.sources for n in FEED_SOURCES.get(s, ())]
    feed.last_fetched_at = ctx.now
    return program, await collect(ctx, q, names)


# --- cleanup (subscribers) ------------------------------------------------------------------
# No `calendar.changed` here: the academics event that caused the clean-up already tells the
# app to refetch the calendar.


async def delete_for_course(ctx: Ctx, course_id: str, program_id: str) -> None:
    meeting_ids = (
        await ctx.db.scalars(
            select(ScheduleMeeting.id).where(
                ScheduleMeeting.user_id == ctx.user_id, ScheduleMeeting.course_id == course_id
            )
        )
    ).all()
    await _delete_meetings(ctx, list(meeting_ids))
    await ctx.db.execute(
        delete(ScheduleEvent).where(
            ScheduleEvent.user_id == ctx.user_id, ScheduleEvent.course_id == course_id
        )
    )


async def delete_for_term(ctx: Ctx, term_id: str, program_id: str) -> None:
    meeting_ids = (
        await ctx.db.scalars(
            select(ScheduleMeeting.id).where(
                ScheduleMeeting.user_id == ctx.user_id, ScheduleMeeting.term_id == term_id
            )
        )
    ).all()
    await _delete_meetings(ctx, list(meeting_ids))
    await ctx.db.execute(
        delete(ScheduleEvent).where(
            ScheduleEvent.user_id == ctx.user_id, ScheduleEvent.term_id == term_id
        )
    )


async def delete_for_program(ctx: Ctx, program_id: str) -> None:
    for model in (ScheduleEvent, ScheduleEventType, ScheduleFeed):
        await ctx.db.execute(
            delete(model).where(model.user_id == ctx.user_id, model.program_id == program_id)
        )


async def delete_unlinked_meetings(
    ctx: Ctx, course_id: str, program_id: str, term_ids: Sequence[str]
) -> None:
    """Meetings of terms the course no longer runs in."""
    meeting_ids = (
        await ctx.db.scalars(
            select(ScheduleMeeting.id).where(
                ScheduleMeeting.user_id == ctx.user_id,
                ScheduleMeeting.course_id == course_id,
                ScheduleMeeting.term_id.not_in(list(term_ids)),
            )
        )
    ).all()
    await _delete_meetings(ctx, list(meeting_ids))


async def _delete_meetings(ctx: Ctx, meeting_ids: list[str]) -> None:
    if not meeting_ids:
        return
    await ctx.db.execute(
        delete(ScheduleMeetingException).where(ScheduleMeetingException.meeting_id.in_(meeting_ids))
    )
    await ctx.db.execute(delete(ScheduleMeeting).where(ScheduleMeeting.id.in_(meeting_ids)))
