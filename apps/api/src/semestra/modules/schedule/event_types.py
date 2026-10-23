"""Class and event types of a Program (M04 §2): LEC/PRA/TUT and custom ones."""

from collections.abc import Sequence
from typing import Any

from sqlalchemy import func, select

from semestra.core.context import Ctx
from semestra.core.db import new_id
from semestra.core.errors import AppError, not_found
from semestra.modules.academics import service as academics
from semestra.modules.schedule.common import announce, columns, program_course_ids
from semestra.modules.schedule.models import (
    ScheduleEvent,
    ScheduleEventType,
    ScheduleMeeting,
)
from semestra.modules.schedule.schemas import (
    EventType,
    EventTypeCreateInput,
    EventTypeRef,
    EventTypeUpdateInput,
)

BUILTIN_TYPES = (
    ("LEC", "Lecture", "presentation"),
    ("PRA", "Practical", "flask-conical"),
    ("TUT", "Tutorial", "users"),
)


async def ensure_event_types(ctx: Ctx, program_id: str) -> None:
    """A new Program gets the built-in LEC/PRA/TUT (`academics.program.created`)."""
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


async def type_rows(ctx: Ctx, program_id: str) -> list[ScheduleEventType]:
    """The Program's types, in order. Reads only: the built-in ones are written once, when the
    Program is created."""
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
    return [EventType.model_validate(columns(r)) for r in await type_rows(ctx, program_id)]


async def type_row(ctx: Ctx, type_id: str) -> ScheduleEventType:
    row = await ctx.db.get(ScheduleEventType, type_id)
    if row is None or row.user_id != ctx.user_id:
        raise not_found("type", type_id)
    return row


async def check_type_code(ctx: Ctx, program_id: str, code: str | None) -> None:
    if code is None:
        return
    if code not in {t.code for t in await type_rows(ctx, program_id)}:
        raise AppError(
            "common.validation", 422, errors=[{"loc": ["type_code"], "code": "unknown_type"}]
        )


async def create_event_type(ctx: Ctx, inp: EventTypeCreateInput) -> EventType:
    await academics.get_program_row(ctx, inp.program_id)
    rows = await type_rows(ctx, inp.program_id)
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
    await announce(ctx, row.program_id, "schedule.event_type.created", {"event_type_id": row.id})
    return EventType.model_validate(columns(row))


async def update_event_type(ctx: Ctx, inp: EventTypeUpdateInput) -> EventType:
    row = await type_row(ctx, inp.event_type_id)
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
    await announce(ctx, row.program_id, "schedule.event_type.updated", {"event_type_id": row.id})
    return EventType.model_validate(columns(row))


async def delete_event_type(ctx: Ctx, type_id: str) -> None:
    row = await type_row(ctx, type_id)
    if row.builtin:
        raise AppError("common.validation", 422, errors=[{"loc": ["builtin"], "code": "fixed"}])
    meetings = await ctx.db.scalar(
        select(func.count())
        .select_from(ScheduleMeeting)
        .where(
            ScheduleMeeting.user_id == ctx.user_id,
            ScheduleMeeting.course_id.in_(await program_course_ids(ctx, row.program_id)),
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
    await announce(ctx, row.program_id, "schedule.event_type.deleted", {"event_type_id": row.id})


async def reorder_event_types(ctx: Ctx, program_id: str, ids: Sequence[str]) -> list[EventType]:
    await academics.get_program_row(ctx, program_id)
    rows = await type_rows(ctx, program_id)
    wanted = [i for i in dict.fromkeys(ids) if i in {r.id for r in rows}]
    rest = [r.id for r in rows if r.id not in wanted]
    position = {type_id: i for i, type_id in enumerate([*wanted, *rest])}
    for r in rows:
        r.position = position[r.id]
    await ctx.db.flush()
    await announce(ctx, program_id, "schedule.event_type.updated", {"fields": ["position"]})
    return await list_event_types(ctx, program_id)


async def preview_event_type_delete(ctx: Ctx, inp: EventTypeRef) -> dict[str, Any]:
    row = await type_row(ctx, inp.event_type_id)
    return {"target": f"{row.code} {row.name}", "changes": []}
