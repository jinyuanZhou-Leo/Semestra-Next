"""One-off events: exams, office hours, make-up classes (M04 §2)."""

from collections.abc import Sequence
from datetime import UTC, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.db import new_id
from semestra.core.errors import AppError, not_found
from semestra.core.events import events
from semestra.modules.academics import service as academics
from semestra.modules.academics.models import AcademicsProgram
from semestra.modules.schedule import rules
from semestra.modules.schedule.common import announce, columns, program_tz
from semestra.modules.schedule.event_types import check_type_code
from semestra.modules.schedule.models import (
    ScheduleEvent,
)
from semestra.modules.schedule.schemas import (
    EventCreateInput,
    EventCreateManyResult,
    EventFields,
    EventListInput,
    EventRef,
    EventUpdateInput,
    OneOffEvent,
)


async def _event_row(ctx: Ctx, event_id: str) -> ScheduleEvent:
    row = await ctx.db.get(ScheduleEvent, event_id)
    if row is None or row.user_id != ctx.user_id:
        raise not_found("event", event_id)
    return row


async def preview_event_delete(ctx: Ctx, inp: EventRef) -> dict[str, Any]:
    row = await _event_row(ctx, inp.event_id)
    return {"target": row.title, "changes": []}


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


def event_out(row: ScheduleEvent) -> OneOffEvent:
    return OneOffEvent.model_validate(columns(row))


async def list_events(ctx: Ctx, inp: EventListInput) -> list[OneOffEvent]:
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


async def get_event(ctx: Ctx, event_id: str) -> OneOffEvent:
    return event_out(await _event_row(ctx, event_id))


async def _write_event(
    ctx: Ctx, program: AcademicsProgram, inp: EventFields, row: ScheduleEvent | None = None
) -> ScheduleEvent:
    """A new event, or `row` updated with what `inp` sets (a repeated import: fields the
    importer leaves out, such as the user's note, stay as they are)."""
    sent = inp.model_fields_set if row is not None else set(EventFields.model_fields)
    links = {
        name: getattr(inp, name) if name in sent or row is None else getattr(row, name)
        for name in ("course_id", "term_id", "type_code")
    }
    course_id, term_id, type_code = links["course_id"], links["term_id"], links["type_code"]
    await _check_event_links(ctx, program.id, course_id, term_id)
    await check_type_code(ctx, program.id, type_code)
    if row is None:
        row = ScheduleEvent(id=new_id(), user_id=ctx.user_id, created_at=ctx.now)
        ctx.db.add(row)
    if sent & {"start_at", "end_at", "all_day"}:
        row.start_at, row.end_at = _normalize_times(
            inp.start_at, inp.end_at, inp.all_day, program_tz(program)
        )
        row.all_day = inp.all_day
    row.program_id = program.id
    row.course_id, row.term_id, row.type_code = course_id, term_id, type_code
    for name in ("title", "location", "note", "source_kind", "source_ref"):
        if name in sent:
            setattr(row, name, getattr(inp, name))
    row.updated_at = ctx.now
    return row


async def create_event(ctx: Ctx, inp: EventCreateInput) -> OneOffEvent:
    program = await academics.get_program_row(ctx, inp.program_id)
    row = await _write_event(ctx, program, inp)
    await ctx.db.flush()
    await announce(ctx, program.id, "schedule.event.created", {"event_id": row.id})
    return event_out(row)


async def create_events(
    ctx: Ctx, program_id: str, items: Sequence[EventFields]
) -> EventCreateManyResult:
    """Import: an item whose (source_kind, source_ref) is already in the Program updates it."""
    program = await academics.get_program_row(ctx, program_id)
    refs = [i.source_ref for i in items if i.source_ref is not None]
    existing = {
        (r.source_kind, r.source_ref): r
        for r in (
            await ctx.db.scalars(
                select(ScheduleEvent).where(
                    ScheduleEvent.user_id == ctx.user_id,
                    ScheduleEvent.program_id == program.id,
                    ScheduleEvent.source_ref.in_(refs),
                )
            )
        ).all()
    }
    rows: list[ScheduleEvent] = []
    created: list[str] = []
    updated: list[str] = []
    for item in items:
        key = (item.source_kind, item.source_ref)
        found = existing.get(key) if item.source_ref is not None else None
        row = await _write_event(ctx, program, item, found)
        if found is None:
            created.append(row.id)
            if item.source_ref is not None:
                existing[key] = row
        elif row.id not in created and row.id not in updated:
            updated.append(row.id)
        rows.append(row)
    await ctx.db.flush()
    for name, ids in (("schedule.event.created", created), ("schedule.event.updated", updated)):
        for event_id in ids:
            await events.publish(ctx, name, {"event_id": event_id, "program_id": program.id})
    if created or updated:
        await events.publish(ctx, "calendar.changed", {"program_id": program.id})
    unique = list({r.id: r for r in rows}.values())
    return EventCreateManyResult(
        items=[event_out(r) for r in unique], created_ids=created, updated_ids=updated
    )


_NULLABLE_EVENT = {"course_id", "term_id", "type_code", "location", "note"}


async def update_event(ctx: Ctx, inp: EventUpdateInput) -> OneOffEvent:
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
        await check_type_code(ctx, program.id, inp.type_code)
    for field in ("title", "course_id", "term_id", "type_code", "location", "note"):
        if field in sent:
            setattr(row, field, getattr(inp, field))
    if sent & {"start_at", "end_at", "all_day"}:
        all_day = inp.all_day if inp.all_day is not None else row.all_day
        start = inp.start_at or row.start_at
        end = inp.end_at or row.end_at
        if inp.start_at is not None and inp.end_at is None:
            tz = program_tz(program)
            if all_day:  # keep the number of local days, which a DST change would shift
                days = row.end_at.astimezone(tz).date() - row.start_at.astimezone(tz).date()
                end = rules.local_midnight(_aware(start, tz).astimezone(tz).date() + days, tz)
            else:
                end = _aware(start, tz) + (row.end_at - row.start_at)  # keep the duration
        row.start_at, row.end_at = _normalize_times(start, end, all_day, program_tz(program))
        row.all_day = all_day
    row.updated_at = ctx.now
    await ctx.db.flush()
    await announce(
        ctx, program.id, "schedule.event.updated", {"event_id": row.id, "fields": sorted(sent)}
    )
    return event_out(row)


async def delete_event(ctx: Ctx, event_id: str) -> None:
    row = await _event_row(ctx, event_id)
    await ctx.db.delete(row)
    await ctx.db.flush()
    await announce(ctx, row.program_id, "schedule.event.deleted", {"event_id": row.id})
