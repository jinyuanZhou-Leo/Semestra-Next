"""Weekly times of a section, their cancelled or moved dates, conflicts.

A meeting is one weekly time (weekday, hours, room) of a section; the weeks it runs in are the
section's (`sections.py`)."""

from collections import defaultdict
from collections.abc import Iterable, Sequence
from datetime import date, time
from typing import Any

from sqlalchemy import delete, select

from semestra.core.context import Ctx
from semestra.core.db import new_id
from semestra.core.errors import AppError, not_found
from semestra.core.events import events
from semestra.modules.academics import service as academics
from semestra.modules.academics.schemas import Course
from semestra.modules.schedule import rules
from semestra.modules.schedule.common import TermInfo, columns, term_info
from semestra.modules.schedule.models import (
    ScheduleMeeting,
    ScheduleMeetingException,
    ScheduleSection,
)
from semestra.modules.schedule.schemas import (
    ConflictPair,
    ExceptionRef,
    ExceptionUpsertInput,
    Meeting,
    MeetingCreateInput,
    MeetingException,
    MeetingRef,
    MeetingUpdateInput,
    Section,
)

# --- rows -----------------------------------------------------------------------------------


async def section_row(ctx: Ctx, section_id: str) -> ScheduleSection:
    row = await ctx.db.get(ScheduleSection, section_id)
    if row is None or row.user_id != ctx.user_id:
        raise not_found("section", section_id)
    return row


async def meeting_row(ctx: Ctx, meeting_id: str) -> tuple[ScheduleMeeting, ScheduleSection]:
    """A meeting with its section."""
    row = await ctx.db.get(ScheduleMeeting, meeting_id)
    if row is None or row.user_id != ctx.user_id:
        raise not_found("meeting", meeting_id)
    return row, await section_row(ctx, row.section_id)


async def meetings_of(ctx: Ctx, section_ids: Iterable[str]) -> dict[str, list[ScheduleMeeting]]:
    """The sections' meetings, by weekday and start time."""
    ids = list(section_ids)
    out: dict[str, list[ScheduleMeeting]] = defaultdict(list)
    if not ids:
        return out
    rows = (
        await ctx.db.scalars(
            select(ScheduleMeeting)
            .where(ScheduleMeeting.user_id == ctx.user_id, ScheduleMeeting.section_id.in_(ids))
            .order_by(ScheduleMeeting.weekday, ScheduleMeeting.start_time, ScheduleMeeting.id)
        )
    ).all()
    for r in rows:
        out[r.section_id].append(r)
    return out


async def exceptions_of(
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


def _meeting_out(
    row: ScheduleMeeting, exceptions: dict[str, list[ScheduleMeetingException]]
) -> Meeting:
    return Meeting.model_validate(
        {
            **columns(row),
            "exceptions": [
                MeetingException.model_validate(columns(e)) for e in exceptions.get(row.id, [])
            ],
        }
    )


async def meetings_out(ctx: Ctx, rows: Sequence[ScheduleMeeting]) -> list[Meeting]:
    exceptions = await exceptions_of(ctx, [r.id for r in rows])
    return [_meeting_out(r, exceptions) for r in rows]


async def sections_out(ctx: Ctx, rows: Sequence[ScheduleSection]) -> list[Section]:
    meetings = await meetings_of(ctx, [r.id for r in rows])
    exceptions = await exceptions_of(ctx, [m.id for ms in meetings.values() for m in ms])
    return [
        Section.model_validate(
            {
                **columns(r),
                "meetings": [_meeting_out(m, exceptions) for m in meetings.get(r.id, [])],
            }
        )
        for r in rows
    ]


# --- checks and dates -----------------------------------------------------------------------


def check_meeting(row: ScheduleMeeting) -> None:
    if row.start_time >= row.end_time:
        raise AppError("schedule.time_range_invalid", 422)


def check_section_weeks(row: ScheduleSection) -> None:
    if row.end_week is not None and row.end_week < row.start_week:
        raise AppError("schedule.week_range_invalid", 422)
    if row.recurrence == "weekly":
        row.anchor_week = row.start_week


async def course_with_term(ctx: Ctx, course_id: str, term_id: str) -> Course:
    course = await academics.course_out(ctx, await academics.get_course_row(ctx, course_id))
    if term_id not in course.term_ids:
        raise AppError("schedule.term_not_in_course", 422)
    return course


def recurrence(section: ScheduleSection, meeting: ScheduleMeeting) -> rules.Recurrence:
    return rules.Recurrence(
        weekday=meeting.weekday,
        recurrence=section.recurrence,
        anchor_week=section.anchor_week,
        start_week=section.start_week,
        end_week=section.end_week,
        skip_breaks=section.skip_breaks,
    )


async def meeting_dates(
    ctx: Ctx, section: ScheduleSection, meeting: ScheduleMeeting, info: TermInfo | None = None
) -> list[rules.MeetingDate]:
    if info is None:
        info = await term_info(ctx, await academics.get_term_row(ctx, section.term_id))
    return rules.meeting_dates(
        recurrence(section, meeting),
        info.term.start_date,
        info.term.end_date,
        info.weeks,
        info.breaks,
    )


async def drop_stale_exceptions(
    ctx: Ctx, section: ScheduleSection, meetings: Sequence[ScheduleMeeting]
) -> None:
    """After a weeks or weekday edit, exceptions on dates a meeting no longer has would linger in
    its list and come back if the edit is undone."""
    if not meetings:
        return
    info = await term_info(ctx, await academics.get_term_row(ctx, section.term_id))
    for row in meetings:
        days = [d.day for d in await meeting_dates(ctx, section, row, info)]
        await ctx.db.execute(
            delete(ScheduleMeetingException).where(
                ScheduleMeetingException.meeting_id == row.id,
                ScheduleMeetingException.original_date.not_in(days),
            )
        )


async def announce_sections(
    ctx: Ctx,
    course: Any,
    *,
    created: Sequence[str] = (),
    updated: Sequence[str] = (),
    deleted: Sequence[str] = (),
) -> None:
    """Sections written in one change, and that the Program's calendar changed."""
    for event_type, ids in (
        ("schedule.section.created", created),
        ("schedule.section.updated", updated),
        ("schedule.section.deleted", deleted),
    ):
        if ids:
            await events.publish(
                ctx,
                event_type,
                {"course_id": course.id, "section_ids": list(ids), "program_id": course.program_id},
            )
    if created or updated or deleted:
        await events.publish(ctx, "calendar.changed", {"program_id": course.program_id})


async def delete_sections(ctx: Ctx, section_ids: Sequence[str]) -> None:
    """Sections with their meetings and the meetings' exceptions."""
    if not section_ids:
        return
    meeting_ids = select(ScheduleMeeting.id).where(ScheduleMeeting.section_id.in_(section_ids))
    await ctx.db.execute(
        delete(ScheduleMeetingException).where(ScheduleMeetingException.meeting_id.in_(meeting_ids))
    )
    await ctx.db.execute(delete(ScheduleMeeting).where(ScheduleMeeting.section_id.in_(section_ids)))
    await ctx.db.execute(delete(ScheduleSection).where(ScheduleSection.id.in_(section_ids)))


async def delete_meetings(ctx: Ctx, meeting_ids: Sequence[str]) -> None:
    if not meeting_ids:
        return
    await ctx.db.execute(
        delete(ScheduleMeetingException).where(ScheduleMeetingException.meeting_id.in_(meeting_ids))
    )
    await ctx.db.execute(delete(ScheduleMeeting).where(ScheduleMeeting.id.in_(meeting_ids)))


# --- meetings -------------------------------------------------------------------------------


def new_meeting_row(ctx: Ctx, section: ScheduleSection, **values: Any) -> ScheduleMeeting:
    row = ScheduleMeeting(
        id=new_id(),
        user_id=ctx.user_id,
        section_id=section.id,
        created_at=ctx.now,
        updated_at=ctx.now,
        **values,
    )
    check_meeting(row)
    ctx.db.add(row)
    return row


async def create_meeting(ctx: Ctx, inp: MeetingCreateInput) -> Meeting:
    section = await section_row(ctx, inp.section_id)
    course = await academics.get_course_row(ctx, section.course_id)
    row = new_meeting_row(ctx, section, **inp.model_dump(exclude={"section_id"}))
    section.updated_at = ctx.now
    await ctx.db.flush()
    await announce_sections(ctx, course, updated=[section.id])
    return (await meetings_out(ctx, [row]))[0]


_NULLABLE_MEETING = {"location", "title"}


async def update_meeting(ctx: Ctx, inp: MeetingUpdateInput) -> Meeting:
    row, section = await meeting_row(ctx, inp.meeting_id)
    sent = inp.model_fields_set - {"meeting_id"}
    bad = sorted(f for f in sent if getattr(inp, f) is None and f not in _NULLABLE_MEETING)
    if bad:
        raise AppError(
            "common.validation", 422, errors=[{"loc": [f], "code": "none_not_allowed"} for f in bad]
        )
    changed = sorted(f for f in sent if getattr(row, f) != getattr(inp, f))
    for field in changed:
        setattr(row, field, getattr(inp, field))
    check_meeting(row)
    if "weekday" in changed:
        await drop_stale_exceptions(ctx, section, [row])
    if changed:
        row.updated_at = ctx.now
        await ctx.db.flush()
        course = await academics.get_course_row(ctx, section.course_id)
        await announce_sections(ctx, course, updated=[section.id])
    return (await meetings_out(ctx, [row]))[0]


async def delete_meeting(ctx: Ctx, meeting_id: str) -> None:
    """Deletes one weekly time; a section's last time goes with the section."""
    row, section = await meeting_row(ctx, meeting_id)
    course = await academics.get_course_row(ctx, section.course_id)
    others = (await meetings_of(ctx, [section.id]))[section.id]
    if len(others) <= 1:
        await delete_sections(ctx, [section.id])
        await ctx.db.flush()
        await announce_sections(ctx, course, deleted=[section.id])
        return
    await delete_meetings(ctx, [row.id])
    section.updated_at = ctx.now
    await ctx.db.flush()
    await announce_sections(ctx, course, updated=[section.id])


async def set_enabled(
    ctx: Ctx,
    course_id: str,
    meeting_ids: Sequence[str],
    enabled: bool,
    other_ids: Sequence[str] = (),
) -> list[Meeting]:
    """The meetings whose state changed (none when they all already were). `other_ids` get the
    opposite state in the same change ("keep only this section")."""
    course = await academics.get_course_row(ctx, course_id)
    wanted = {**{i: not enabled for i in other_ids}, **{i: enabled for i in meeting_ids}}
    rows = (
        await ctx.db.scalars(
            select(ScheduleMeeting)
            .join(ScheduleSection, ScheduleSection.id == ScheduleMeeting.section_id)
            .where(
                ScheduleMeeting.user_id == ctx.user_id,
                ScheduleSection.course_id == course.id,
                ScheduleMeeting.id.in_(list(wanted)),
            )
        )
    ).all()
    if len(rows) != len(wanted):
        raise not_found()
    changed = [r for r in rows if r.enabled != wanted[r.id]]
    for r in changed:
        r.enabled = wanted[r.id]
        r.updated_at = ctx.now
    if changed:
        await ctx.db.flush()
        await announce_sections(ctx, course, updated=sorted({r.section_id for r in changed}))
    return await meetings_out(ctx, sorted(changed, key=lambda r: (r.weekday, r.start_time, r.id)))


# --- exceptions -----------------------------------------------------------------------------


async def upsert_exception(ctx: Ctx, inp: ExceptionUpsertInput) -> Meeting:
    row, section = await meeting_row(ctx, inp.meeting_id)
    course = await academics.get_course_row(ctx, section.course_id)
    if inp.original_date not in {d.day for d in await meeting_dates(ctx, section, row)}:
        raise AppError(
            "common.validation", 422, errors=[{"loc": ["original_date"], "code": "no_class"}]
        )
    start = inp.new_start_time or row.start_time
    end = inp.new_end_time or row.end_time
    if inp.kind == "moved" and start >= end:
        raise AppError("schedule.time_range_invalid", 422)
    exc = await _exception_row(ctx, row.id, inp.original_date)
    # Only an import marks its changes (it calls in as the app); the assistant and MCP clients
    # cannot, so what they write stays the user's.
    imported = inp.imported and not ctx.delegated
    if exc is not None and imported and not exc.imported:
        # The user changed this class themselves: their change stays.
        return (await meetings_out(ctx, [row]))[0]
    if exc is None:
        exc = ScheduleMeetingException(
            id=new_id(), user_id=ctx.user_id, meeting_id=row.id, original_date=inp.original_date
        )
        ctx.db.add(exc)
    exc.imported = imported
    moved = inp.kind == "moved"
    exc.kind = inp.kind
    exc.new_date = inp.new_date if moved else None
    exc.new_start_time = inp.new_start_time if moved else None
    exc.new_end_time = inp.new_end_time if moved else None
    exc.new_location = inp.new_location if moved else None
    exc.note = inp.note
    row.updated_at = ctx.now  # one of its dates changed: calendar feeds see the meeting changed
    await ctx.db.flush()
    await _announce_exception(ctx, course, row, "schedule.exception.upserted", inp.original_date)
    return (await meetings_out(ctx, [row]))[0]


async def delete_exception(ctx: Ctx, meeting_id: str, original_date: date) -> Meeting:
    row, section = await meeting_row(ctx, meeting_id)
    course = await academics.get_course_row(ctx, section.course_id)
    result = await ctx.db.execute(
        delete(ScheduleMeetingException).where(
            ScheduleMeetingException.user_id == ctx.user_id,
            ScheduleMeetingException.meeting_id == row.id,
            ScheduleMeetingException.original_date == original_date,
        )
    )
    if not getattr(result, "rowcount", 0):
        raise not_found("exception", str(original_date))
    row.updated_at = ctx.now
    await ctx.db.flush()
    await _announce_exception(ctx, course, row, "schedule.exception.deleted", original_date)
    return (await meetings_out(ctx, [row]))[0]


async def _announce_exception(
    ctx: Ctx, course: Any, row: ScheduleMeeting, event_type: str, original_date: date
) -> None:
    await events.publish(
        ctx,
        event_type,
        {
            "meeting_id": row.id,
            "section_id": row.section_id,
            "course_id": course.id,
            "original_date": original_date.isoformat(),
            "program_id": course.program_id,
        },
    )
    await events.publish(ctx, "calendar.changed", {"program_id": course.program_id})


# --- conflicts ------------------------------------------------------------------------------


async def conflicts(ctx: Ctx, term_id: str) -> list[ConflictPair]:
    """Pairs of enabled meetings of the term that share at least one date and overlap in time."""
    term = await academics.get_term_row(ctx, term_id)
    info = await term_info(ctx, term)
    pairs = (
        await ctx.db.execute(
            select(ScheduleMeeting, ScheduleSection)
            .join(ScheduleSection, ScheduleSection.id == ScheduleMeeting.section_id)
            .where(
                ScheduleMeeting.user_id == ctx.user_id,
                ScheduleSection.term_id == term.id,
                ScheduleMeeting.enabled.is_(True),
            )
        )
    ).all()
    rows = sorted(pairs, key=lambda p: (p[0].weekday, p[0].start_time, p[0].id))
    dates = {m.id: {d.day for d in await meeting_dates(ctx, s, m, info)} for m, s in rows}
    out: list[ConflictPair] = []
    for i, (a, _) in enumerate(rows):
        for b, _ in rows[i + 1 :]:
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


# --- labels and previews --------------------------------------------------------------------


async def section_label(ctx: Ctx, section: ScheduleSection) -> str:
    """A section as people name it: its type and code, then its course ("LEC 0101 · APS105
    Intro")."""
    course = await academics.get_course_row(ctx, section.course_id)
    name = " ".join(p for p in (section.type_code, section.section_code) if p)
    label = f"{course.code} {course.title}" if course.code else course.title
    return f"{name} · {label}" if name else label


async def meeting_label(ctx: Ctx, meeting_id: str) -> str:
    """A meeting by its section; also what the assistant shows for a meeting id."""
    _, section = await meeting_row(ctx, meeting_id)
    return await section_label(ctx, section)


async def preview_meeting_delete(ctx: Ctx, inp: MeetingRef) -> dict[str, Any]:
    return {"target": await meeting_label(ctx, inp.meeting_id), "changes": []}


async def _exception_row(
    ctx: Ctx, meeting_id: str, original_date: date
) -> ScheduleMeetingException | None:
    return await ctx.db.scalar(
        select(ScheduleMeetingException).where(
            ScheduleMeetingException.user_id == ctx.user_id,
            ScheduleMeetingException.meeting_id == meeting_id,
            ScheduleMeetingException.original_date == original_date,
        )
    )


_EXCEPTION_FIELDS = ("new_date", "new_start_time", "new_end_time", "new_location", "note")


def _clock(value: time | None) -> str | None:
    return value.isoformat(timespec="minutes") if value is not None else None


def _exception_values(row: ScheduleMeetingException | None) -> dict[str, Any]:
    if row is None:
        return {}
    return {
        "exception": row.kind,
        "new_date": row.new_date.isoformat() if row.new_date else None,
        "new_start_time": _clock(row.new_start_time),
        "new_end_time": _clock(row.new_end_time),
        "new_location": row.new_location,
        "note": row.note,
    }


async def preview_exception_upsert(ctx: Ctx, inp: ExceptionUpsertInput) -> dict[str, Any]:
    """The assistant's confirmation card (M12 §3.5): the class on its date, cancelled or moved,
    with what the date's change was before (if it had one)."""
    target = await meeting_label(ctx, inp.meeting_id)
    before = _exception_values(await _exception_row(ctx, inp.meeting_id, inp.original_date))
    after = {
        "exception": inp.kind,
        "new_date": inp.new_date.isoformat() if inp.new_date else None,
        "new_start_time": _clock(inp.new_start_time),
        "new_end_time": _clock(inp.new_end_time),
        "new_location": inp.new_location,
        "note": inp.note,
    }
    changes: list[dict[str, Any]] = [
        {"field": "original_date", "after": inp.original_date.isoformat()}
    ]
    # A cancelled class has no new date, time or place, only a note.
    shown = ("exception", "note") if inp.kind == "cancelled" else ("exception", *_EXCEPTION_FIELDS)
    for field in shown:
        new, old = after[field], before.get(field)
        if new is None and old is None:
            continue
        change: dict[str, Any] = {"field": field, "after": new}
        if before and old != new:
            change["before"] = old
        changes.append(change)
    return {"target": target, "changes": changes}


async def preview_exception_delete(ctx: Ctx, inp: ExceptionRef) -> dict[str, Any]:
    """The card for undoing a date's change: the class goes back to its regular time."""
    target = await meeting_label(ctx, inp.meeting_id)
    row = await _exception_row(ctx, inp.meeting_id, inp.original_date)
    changes: list[dict[str, Any]] = [
        {"field": "original_date", "after": inp.original_date.isoformat()}
    ]
    if row is not None:
        changes.append({"field": "exception", "before": row.kind, "after": None})
    return {"target": target, "changes": changes}
