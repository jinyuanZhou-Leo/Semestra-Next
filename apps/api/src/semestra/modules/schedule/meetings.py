"""Weekly class times of a course in a term, their cancelled or moved dates, conflicts."""

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
from semestra.modules.schedule.common import TermInfo, announce, columns, term_info
from semestra.modules.schedule.event_types import check_type_code, type_rows
from semestra.modules.schedule.models import (
    ScheduleMeeting,
    ScheduleMeetingException,
)
from semestra.modules.schedule.schemas import (
    ConflictPair,
    ExceptionRef,
    ExceptionUpsertInput,
    Meeting,
    MeetingCreateManyResult,
    MeetingException,
    MeetingFields,
    MeetingRef,
    MeetingUpdateInput,
    SectionSaveInput,
    SectionWeeks,
)


async def meeting_row(ctx: Ctx, meeting_id: str) -> ScheduleMeeting:
    row = await ctx.db.get(ScheduleMeeting, meeting_id)
    if row is None or row.user_id != ctx.user_id:
        raise not_found("meeting", meeting_id)
    return row


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


async def meetings_out(ctx: Ctx, rows: Sequence[ScheduleMeeting]) -> list[Meeting]:
    exceptions = await exceptions_of(ctx, [r.id for r in rows])
    return [
        Meeting.model_validate(
            {
                **columns(r),
                "exceptions": [
                    MeetingException.model_validate(columns(e)) for e in exceptions.get(r.id, [])
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


async def list_term_meetings(ctx: Ctx, term_id: str) -> list[Meeting]:
    """Every meeting of the term's courses (the term timetable), by course, weekday and time."""
    term = await academics.get_term_row(ctx, term_id)
    rows = (
        await ctx.db.scalars(
            select(ScheduleMeeting).where(
                ScheduleMeeting.user_id == ctx.user_id, ScheduleMeeting.term_id == term.id
            )
        )
    ).all()
    rows = sorted(rows, key=lambda r: (r.course_id, r.weekday, r.start_time, r.section_code))
    return await meetings_out(ctx, rows)


def _apply_fields(row: ScheduleMeeting, fields: MeetingFields) -> None:
    data = fields.model_dump()
    anchor = data.pop("anchor_week")
    for key, value in data.items():
        setattr(row, key, value)
    row.anchor_week = anchor if anchor is not None else row.start_week


def _apply_import_update(row: ScheduleMeeting, fields: MeetingFields) -> None:
    """A repeated import changes only what the importer sent: whether the user shows the
    section (`enabled`) stays theirs unless the importer says otherwise."""
    data = fields.model_dump(exclude_unset=True)
    anchor = data.pop("anchor_week", None)
    for key, value in data.items():
        setattr(row, key, value)
    if anchor is not None:
        row.anchor_week = anchor
    elif row.recurrence == "biweekly":
        row.anchor_week = max(row.anchor_week, row.start_week)


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
    await check_type_code(ctx, course.program_id, fields.type_code)
    row = await _new_meeting(ctx, course, fields)
    await ctx.db.flush()
    await announce(
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
    types = {t.code for t in await type_rows(ctx, course.program_id)}
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
            _apply_import_update(row, item)
            _check_meeting(row)
            await _drop_stale_exceptions(ctx, row)
            row.updated_at = ctx.now
            if row.id not in created and row.id not in updated:
                updated.append(row.id)
        rows.append(row)
    await ctx.db.flush()
    if created:
        await events.publish(
            ctx,
            "schedule.meeting.created",
            {"course_id": course.id, "meeting_ids": created, "program_id": course.program_id},
        )
    if updated:
        await events.publish(
            ctx,
            "schedule.meeting.updated",
            {"course_id": course.id, "meeting_ids": updated, "program_id": course.program_id},
        )
    if created or updated:
        await events.publish(ctx, "calendar.changed", {"program_id": course.program_id})
    unique = list({r.id: r for r in rows}.values())
    return MeetingCreateManyResult(
        items=await meetings_out(ctx, unique), created_ids=created, updated_ids=updated
    )


_NULLABLE_MEETING = {"title", "instructor", "location", "end_week"}


_RECURRENCE_FIELDS = {
    "term_id",
    "weekday",
    "recurrence",
    "anchor_week",
    "start_week",
    "end_week",
    "skip_breaks",
}


async def _drop_stale_exceptions(ctx: Ctx, row: ScheduleMeeting) -> None:
    """After a recurrence edit, exceptions on dates the meeting no longer has would linger in its
    list and come back if the edit is undone."""
    days = [d.day for d in await meeting_dates(ctx, row)]
    await ctx.db.execute(
        delete(ScheduleMeetingException).where(
            ScheduleMeetingException.meeting_id == row.id,
            ScheduleMeetingException.original_date.not_in(days),
        )
    )


async def update_meeting(ctx: Ctx, inp: MeetingUpdateInput) -> Meeting:
    row = await meeting_row(ctx, inp.meeting_id)
    sent = inp.model_fields_set - {"meeting_id"}
    if "anchor_week" in sent and inp.anchor_week is None:
        # As on create: no anchor means the first week (weekly meetings ignore it).
        inp = inp.model_copy(update={"anchor_week": inp.start_week or row.start_week})
    bad = sorted(f for f in sent if getattr(inp, f) is None and f not in _NULLABLE_MEETING)
    if bad:
        raise AppError(
            "common.validation", 422, errors=[{"loc": [f], "code": "none_not_allowed"} for f in bad]
        )
    course = await _course_with_term(ctx, row.course_id, inp.term_id or row.term_id)
    if "type_code" in sent:
        await check_type_code(ctx, course.program_id, inp.type_code)
    changed = sorted(f for f in sent if getattr(row, f) != getattr(inp, f))
    for field in changed:
        setattr(row, field, getattr(inp, field))
    if "start_week" in changed and "anchor_week" not in sent and row.recurrence == "biweekly":
        row.anchor_week = max(row.anchor_week, row.start_week)
    _check_meeting(row)
    if _RECURRENCE_FIELDS & set(changed):
        await _drop_stale_exceptions(ctx, row)
    if changed:
        row.updated_at = ctx.now
        await ctx.db.flush()
        await announce(
            ctx,
            course.program_id,
            "schedule.meeting.updated",
            {"meeting_id": row.id, "course_id": row.course_id, "fields": changed},
        )
    return (await meetings_out(ctx, [row]))[0]


async def delete_meeting(ctx: Ctx, meeting_id: str) -> None:
    row = await meeting_row(ctx, meeting_id)
    course = await academics.get_course_row(ctx, row.course_id)
    await ctx.db.execute(
        delete(ScheduleMeetingException).where(ScheduleMeetingException.meeting_id == row.id)
    )
    await ctx.db.delete(row)
    await ctx.db.flush()
    await announce(
        ctx,
        course.program_id,
        "schedule.meeting.deleted",
        {"meeting_id": row.id, "course_id": course.id},
    )


async def set_enabled(
    ctx: Ctx,
    course_id: str,
    meeting_ids: Sequence[str],
    enabled: bool,
    other_ids: Sequence[str] = (),
) -> list[Meeting]:
    """The sections whose state changed (none when they all already were). `other_ids` get the
    opposite state in the same change ("keep only this section")."""
    course = await academics.get_course_row(ctx, course_id)
    wanted = {**{i: not enabled for i in other_ids}, **{i: enabled for i in meeting_ids}}
    rows = (
        await ctx.db.scalars(
            select(ScheduleMeeting).where(
                ScheduleMeeting.user_id == ctx.user_id,
                ScheduleMeeting.course_id == course.id,
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
        await announce(
            ctx,
            course.program_id,
            "schedule.meeting.updated",
            {"course_id": course.id, "meeting_ids": [r.id for r in changed], "fields": ["enabled"]},
        )
    return await meetings_out(
        ctx, sorted(changed, key=lambda r: (r.weekday, r.start_time, r.section_code))
    )


async def meeting_dates(
    ctx: Ctx, row: ScheduleMeeting, info: TermInfo | None = None
) -> list[rules.MeetingDate]:
    if info is None:
        info = await term_info(ctx, await academics.get_term_row(ctx, row.term_id))
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
    row = await meeting_row(ctx, inp.meeting_id)
    course = await academics.get_course_row(ctx, row.course_id)
    if inp.original_date not in {d.day for d in await meeting_dates(ctx, row)}:
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
    # Only an import marks its changes (it calls in with the http surface); the assistant and MCP
    # cannot, so what they write stays the user's.
    imported = inp.imported and ctx.surface == "http"
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
    await announce(
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
    row = await meeting_row(ctx, meeting_id)
    course = await academics.get_course_row(ctx, row.course_id)
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
    await announce(
        ctx,
        course.program_id,
        "schedule.exception.deleted",
        {"meeting_id": row.id, "course_id": course.id, "original_date": original_date.isoformat()},
    )
    return (await meetings_out(ctx, [row]))[0]


async def conflicts(ctx: Ctx, term_id: str) -> list[ConflictPair]:
    """Pairs of enabled meetings of the term that share at least one date and overlap in time."""
    term = await academics.get_term_row(ctx, term_id)
    info = await term_info(ctx, term)
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
    dates = {r.id: {d.day for d in await meeting_dates(ctx, r, info)} for r in rows}
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


async def meeting_label(ctx: Ctx, meeting_id: str) -> str:
    """A meeting as people name it: its type and section, then its course ("LEC 0101 · APS105
    Intro"); also what the assistant shows for a meeting id."""
    row = await meeting_row(ctx, meeting_id)
    course = await academics.get_course_row(ctx, row.course_id)
    section = " ".join(p for p in (row.type_code, row.section_code) if p) or row.title
    label = f"{course.code} {course.title}" if course.code else course.title
    return f"{section} · {label}" if section else label


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


async def delete_meetings(ctx: Ctx, meeting_ids: list[str]) -> None:
    if not meeting_ids:
        return
    await ctx.db.execute(
        delete(ScheduleMeetingException).where(ScheduleMeetingException.meeting_id.in_(meeting_ids))
    )
    await ctx.db.execute(delete(ScheduleMeeting).where(ScheduleMeeting.id.in_(meeting_ids)))


async def save_section(ctx: Ctx, inp: SectionSaveInput) -> list[Meeting]:
    """One transaction for a section edited as a whole (see `SectionSaveInput`)."""
    course = await _course_with_term(ctx, inp.course_id, inp.term_id)
    await check_type_code(ctx, course.program_id, inp.type_code)
    rows = (
        (
            await ctx.db.scalars(
                select(ScheduleMeeting).where(
                    ScheduleMeeting.user_id == ctx.user_id,
                    ScheduleMeeting.course_id == course.id,
                    ScheduleMeeting.id.in_(inp.meeting_ids),
                )
            )
        ).all()
        if inp.meeting_ids
        else []
    )
    by_id = {r.id: r for r in rows}
    # New times follow the section: its weeks, and off when the whole section is off.
    first = next((by_id[i] for i in inp.meeting_ids if i in by_id), None)
    weeks = inp.weeks or (
        SectionWeeks(
            recurrence=first.recurrence,  # pyright: ignore[reportArgumentType]
            anchor_week=first.anchor_week,
            start_week=first.start_week,
            end_week=first.end_week,
            skip_breaks=first.skip_breaks,
        )
        if first
        else SectionWeeks()
    )
    enabled = not rows or any(r.enabled for r in rows)
    shared = {
        "term_id": inp.term_id,
        "section_code": inp.section_code,
        "type_code": inp.type_code,
        "instructor": inp.instructor,
    }
    created: list[str] = []
    updated: list[str] = []
    kept: list[ScheduleMeeting] = []
    for t in inp.times:
        own = {
            "weekday": t.weekday,
            "start_time": t.start_time,
            "end_time": t.end_time,
            "location": t.location,
        }
        row = by_id.get(t.meeting_id) if t.meeting_id else None
        if t.meeting_id and row is None:
            raise not_found("meeting", t.meeting_id)
        if row is None:
            row = await _new_meeting(
                ctx,
                course,
                MeetingFields(**shared, **own, **weeks.model_dump(), enabled=enabled),
            )
            created.append(row.id)
        else:
            values = {**shared, **own, **(inp.weeks.model_dump() if inp.weeks else {})}
            if inp.weeks and values["anchor_week"] is None:
                values["anchor_week"] = values["start_week"]
            changed = [k for k, v in values.items() if getattr(row, k) != v]
            for key in changed:
                setattr(row, key, values[key])
            _check_meeting(row)
            if _RECURRENCE_FIELDS & set(changed):
                await _drop_stale_exceptions(ctx, row)
            if changed:
                row.updated_at = ctx.now
                updated.append(row.id)
        kept.append(row)
    keep_ids = {r.id for r in kept}
    removed = [r.id for r in rows if r.id not in keep_ids]
    await delete_meetings(ctx, removed)
    await ctx.db.flush()
    for event_type, ids in (
        ("schedule.meeting.created", created),
        ("schedule.meeting.updated", updated),
        ("schedule.meeting.deleted", removed),
    ):
        if ids:
            await events.publish(
                ctx,
                event_type,
                {"course_id": course.id, "meeting_ids": ids, "program_id": course.program_id},
            )
    if created or updated or removed:
        await events.publish(ctx, "calendar.changed", {"program_id": course.program_id})
    return await meetings_out(ctx, kept)
