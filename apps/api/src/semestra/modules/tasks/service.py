"""Lists and tasks (M05). Capabilities, subscribers and the auto-task sync call into here."""

from collections import defaultdict
from collections.abc import Iterable, Sequence
from datetime import date, datetime, time
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import delete, func, select, update

from semestra.core.context import Ctx
from semestra.core.db import new_id
from semestra.core.errors import AppError, not_found
from semestra.core.events import events
from semestra.modules.academics import rules as academic_rules
from semestra.modules.academics import service as academics
from semestra.modules.academics.models import AcademicsProgram
from semestra.modules.settings import service as settings_service
from semestra.modules.tasks import rules
from semestra.modules.tasks.models import TasksItem, TasksList
from semestra.modules.tasks.schemas import (
    Task,
    TaskCandidate,
    TaskCandidates,
    TaskClearInput,
    TaskClearResult,
    TaskCounts,
    TaskCreateInput,
    TaskCreateManyInput,
    TaskCreateManyResult,
    TaskFields,
    TaskFindInput,
    TaskList,
    TaskListCreateInput,
    TaskListDeleteInput,
    TaskListDeleteResult,
    TaskListOut,
    TaskListUpdateInput,
    TaskMoveInput,
    TaskPage,
    TaskQueryInput,
    TaskRef,
    TaskSkipped,
    TaskUpdateInput,
    View,
)
from semestra.modules.tasks.settings import TasksSettings

# --- loading --------------------------------------------------------------------------------


async def get_item_row(ctx: Ctx, task_id: str) -> TasksItem:
    row = await ctx.db.get(TasksItem, task_id)
    if row is None or row.user_id != ctx.user_id:
        raise not_found("task", task_id)
    return row


async def get_list_row(ctx: Ctx, list_id: str) -> TasksList:
    row = await ctx.db.get(TasksList, list_id)
    if row is None or row.user_id != ctx.user_id:
        raise not_found("list", list_id)
    return row


# Targets for the assistant's confirmation cards of deletes (M12 §3.5): what goes, by name.


async def preview_item_delete(ctx: Ctx, inp: TaskRef) -> dict[str, Any]:
    row = await get_item_row(ctx, inp.task_id)
    return {"target": row.title, "changes": []}


async def preview_list_delete(ctx: Ctx, inp: TaskListDeleteInput) -> dict[str, Any]:
    row = await get_list_row(ctx, inp.list_id)
    return {"target": row.name, "changes": [{"field": "delete_tasks", "after": inp.delete_tasks}]}


async def program_settings(ctx: Ctx, program_id: str) -> TasksSettings:
    resolved = await settings_service.get_values(ctx, "tasks", "program", program_id)
    return TasksSettings.model_validate(resolved.values)


def _now_local(ctx: Ctx, program: AcademicsProgram) -> datetime:
    return ctx.now.astimezone(ZoneInfo(program.timezone))


def task_out(row: TasksItem, now_local: datetime) -> Task:
    return Task(
        id=row.id,
        program_id=row.program_id,
        term_id=row.term_id,
        course_id=row.course_id,
        list_id=row.list_id,
        title=row.title,
        notes=row.notes,
        due_date=row.due_date,
        due_time=row.due_time,
        priority=row.priority,  # pyright: ignore[reportArgumentType]
        flagged=row.flagged,
        completed_at=row.completed_at,
        overdue=rules.is_overdue(
            row.due_date, row.due_time, row.completed_at is not None, now_local
        ),
        position=row.position,
        source_kind=row.source_kind,  # pyright: ignore[reportArgumentType]
        source_ref=row.source_ref,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def item_out(ctx: Ctx, row: TasksItem) -> Task:
    program = await academics.get_program_row(ctx, row.program_id)
    return task_out(row, _now_local(ctx, program))


def _list_out(row: TasksList) -> TaskList:
    return TaskList(
        id=row.id,
        program_id=row.program_id,
        term_id=row.term_id,
        name=row.name,
        color=row.color,
        icon=row.icon,
        position=row.position,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


# --- events ---------------------------------------------------------------------------------


async def _announce(
    ctx: Ctx, kind: str, row: TasksItem, *, calendar: bool, changed: Sequence[str] = ()
) -> None:
    data = {
        "task_id": row.id,
        "program_id": row.program_id,
        "course_id": row.course_id,
        "changed": list(changed),
    }
    await events.publish(ctx, f"tasks.item.{kind}", data)
    if calendar:
        await events.publish(ctx, "calendar.changed", {"program_id": row.program_id})


# --- lists ----------------------------------------------------------------------------------


async def _program_lists(ctx: Ctx, program_id: str) -> list[TasksList]:
    rows = await ctx.db.scalars(
        select(TasksList)
        .where(TasksList.user_id == ctx.user_id, TasksList.program_id == program_id)
        .order_by(TasksList.position, TasksList.created_at, TasksList.id)
    )
    return list(rows)


async def list_lists(ctx: Ctx, program_id: str) -> TaskListOut:
    await academics.get_program_row(ctx, program_id)
    return TaskListOut(items=[_list_out(r) for r in await _program_lists(ctx, program_id)])


async def _ensure_unique_name(
    ctx: Ctx, program_id: str, term_id: str | None, name: str, exclude_id: str | None = None
) -> None:
    wanted = academic_rules.normalize(name)
    for other in await _program_lists(ctx, program_id):
        if (
            other.id != exclude_id
            and other.term_id == term_id
            and academic_rules.normalize(other.name) == wanted
        ):
            raise AppError("tasks.list_name_conflict", 409, name=name)


async def create_list(ctx: Ctx, inp: TaskListCreateInput) -> TaskList:
    program = await academics.get_program_row(ctx, inp.program_id)
    if inp.term_id is not None:
        term = await academics.get_term_row(ctx, inp.term_id)
        if term.program_id != program.id:
            raise not_found()
    await _ensure_unique_name(ctx, program.id, inp.term_id, inp.name)
    existing = await _program_lists(ctx, program.id)
    row = TasksList(
        id=new_id(),
        user_id=ctx.user_id,
        program_id=program.id,
        term_id=inp.term_id,
        name=inp.name,
        color=inp.color,
        icon=inp.icon,
        position=max((r.position for r in existing), default=-1) + 1,
        created_at=ctx.now,
        updated_at=ctx.now,
    )
    ctx.db.add(row)
    await ctx.db.flush()
    await events.publish(ctx, "tasks.list.created", {"list_id": row.id, "program_id": program.id})
    return _list_out(row)


async def update_list(ctx: Ctx, inp: TaskListUpdateInput) -> TaskList:
    row = await get_list_row(ctx, inp.list_id)
    sent = inp.model_fields_set - {"list_id"}
    if "name" in sent:
        if inp.name is None:
            raise AppError(
                "common.validation", 422, errors=[{"loc": ["name"], "code": "none_not_allowed"}]
            )
        await _ensure_unique_name(ctx, row.program_id, row.term_id, inp.name, row.id)
        row.name = inp.name
    if "color" in sent:
        row.color = inp.color
    if "icon" in sent:
        row.icon = inp.icon
    row.updated_at = ctx.now
    await ctx.db.flush()
    await events.publish(
        ctx, "tasks.list.updated", {"list_id": row.id, "program_id": row.program_id}
    )
    return _list_out(row)


async def delete_list(ctx: Ctx, list_id: str, *, delete_tasks: bool) -> TaskListDeleteResult:
    row = await get_list_row(ctx, list_id)
    items = list(await ctx.db.scalars(select(TasksItem).where(TasksItem.list_id == row.id)))
    result = TaskListDeleteResult(
        deleted_task_count=len(items) if delete_tasks else 0,
        moved_task_count=0 if delete_tasks else len(items),
    )
    if delete_tasks:
        for item in items:
            await ctx.db.delete(item)
    else:
        await _to_inbox(ctx, items)
    await ctx.db.delete(row)
    await ctx.db.flush()
    await events.publish(
        ctx, "tasks.list.deleted", {"list_id": list_id, "program_id": row.program_id}
    )
    if any(i.due_date for i in items) and delete_tasks:
        await events.publish(ctx, "calendar.changed", {"program_id": row.program_id})
    return result


async def _to_inbox(ctx: Ctx, items: Iterable[TasksItem]) -> None:
    """Moves tasks to the end of the Program's inbox, keeping their relative order."""
    ordered = sorted(items, key=lambda i: (i.position, i.created_at))
    for item in ordered:
        item.list_id = None
        item.position = await _next_position(ctx, item.program_id, None, exclude=item.id)
        item.updated_at = ctx.now
    await ctx.db.flush()


async def reorder_lists(ctx: Ctx, program_id: str, list_ids: Sequence[str]) -> TaskListOut:
    await academics.get_program_row(ctx, program_id)
    rows = await _program_lists(ctx, program_id)
    by_id = {r.id: r for r in rows}
    missing = next((i for i in list_ids if i not in by_id), None)
    if missing is not None:
        raise not_found("list", missing)
    named = list(dict.fromkeys(list_ids))
    order = [by_id[i] for i in named] + [r for r in rows if r.id not in set(named)]
    for position, row in enumerate(order):
        row.position = position
    await ctx.db.flush()
    await events.publish(ctx, "tasks.list.updated", {"list_id": None, "program_id": program_id})
    return TaskListOut(items=[_list_out(r) for r in order])


# --- creating and changing tasks -----------------------------------------------------------


def _clean_time(value: time | None) -> time | None:
    return None if value is None else value.replace(second=0, microsecond=0, tzinfo=None)


async def _next_position(
    ctx: Ctx, program_id: str, list_id: str | None, *, exclude: str | None = None
) -> float:
    stmt = select(func.max(TasksItem.position)).where(
        TasksItem.user_id == ctx.user_id, TasksItem.program_id == program_id
    )
    stmt = stmt.where(TasksItem.list_id == list_id if list_id else TasksItem.list_id.is_(None))
    if exclude:
        stmt = stmt.where(TasksItem.id != exclude)
    top = await ctx.db.scalar(stmt)
    return rules.position_between(top, None)


async def infer_term(
    ctx: Ctx, program: AcademicsProgram, course_id: str, due: date | None
) -> str | None:
    """The course's term that contains the due date, else the one running today, else its
    earliest term (M05 §3). Year-long tasks therefore follow their due date."""
    course = await academics.course_out(ctx, await academics.get_course_row(ctx, course_id))
    terms = [t for t in await academics.program_terms(ctx, program.id) if t.id in course.term_ids]
    if not terms:
        return None
    today = academics.program_today(ctx, program)
    for day in (due, today):
        if day is not None:
            for term in terms:
                if term.start_date <= day <= term.end_date:
                    return term.id
    return terms[0].id


async def _check_refs(
    ctx: Ctx,
    program: AcademicsProgram,
    *,
    term_id: str | None,
    course_id: str | None,
    list_id: str | None,
) -> TasksList | None:
    """Every referenced entity must exist and belong to the Program. Returns the list row."""
    if term_id is not None:
        term = await academics.get_term_row(ctx, term_id)
        if term.program_id != program.id:
            raise not_found()
    if course_id is not None:
        course = await academics.get_course_row(ctx, course_id)
        if course.program_id != program.id:
            raise AppError("tasks.course_not_in_program", 422, course_id=course_id)
    if list_id is None:
        return None
    row = await get_list_row(ctx, list_id)
    if row.program_id != program.id:
        raise not_found()
    return row


def _check_due(due_date: date | None, due_time: time | None) -> None:
    if due_time is not None and due_date is None:
        raise AppError("tasks.invalid_due", 422)


async def create_task_row(
    ctx: Ctx,
    program: AcademicsProgram,
    fields: TaskFields,
    *,
    default_priority: str,
    completed: bool = False,
) -> TasksItem:
    """Validates and inserts one task (no events). Shared by the capabilities and auto tasks."""
    _check_due(fields.due_date, fields.due_time)
    list_row = await _check_refs(
        ctx, program, term_id=fields.term_id, course_id=fields.course_id, list_id=fields.list_id
    )
    term_id = fields.term_id
    if term_id is None and fields.course_id is not None:
        term_id = await infer_term(ctx, program, fields.course_id, fields.due_date)
    if term_id is None and list_row is not None:
        term_id = list_row.term_id
    row = TasksItem(
        id=new_id(),
        user_id=ctx.user_id,
        program_id=program.id,
        term_id=term_id,
        course_id=fields.course_id,
        list_id=fields.list_id,
        title=fields.title,
        notes=fields.notes,
        due_date=fields.due_date,
        due_time=_clean_time(fields.due_time),
        priority=fields.priority or default_priority,
        flagged=fields.flagged,
        completed_at=ctx.now if completed else None,
        position=await _next_position(ctx, program.id, fields.list_id),
        source_kind=fields.source_kind,
        source_ref=fields.source_ref,
        created_at=ctx.now,
        updated_at=ctx.now,
    )
    ctx.db.add(row)
    await ctx.db.flush()
    return row


# Tasks of these kinds are kept in sync by the app (assessment sync, LMS imports); the
# assistant or an MCP client creating one would hide it from the calendar or have it rewritten.
_APP_SOURCES = {"assessment", "lms"}


def _caller_source(ctx: Ctx, fields: TaskFields, loc: list[str | int]) -> TaskFields:
    """The source kind an assistant or MCP client may give: agent by default, never one the app
    manages itself. HTTP (the app, imports) keeps what it sends."""
    if ctx.surface == "http":
        return fields
    if "source_kind" not in fields.model_fields_set:
        return fields.model_copy(update={"source_kind": "agent"})
    if fields.source_kind in _APP_SOURCES:
        raise AppError(
            "common.validation", 422, errors=[{"loc": [*loc, "source_kind"], "code": "not_allowed"}]
        )
    return fields


async def check_create(ctx: Ctx, inp: TaskCreateInput) -> None:
    _caller_source(ctx, inp, [])


async def check_create_many(ctx: Ctx, inp: TaskCreateManyInput) -> None:
    for i, fields in enumerate(inp.items):
        _caller_source(ctx, fields, ["items", i])


async def check_update(ctx: Ctx, inp: TaskUpdateInput) -> None:
    _guard_managed(await get_item_row(ctx, inp.task_id), inp)


async def create_task(ctx: Ctx, program_id: str, fields: TaskFields) -> Task:
    fields = _caller_source(ctx, fields, [])
    program = await academics.get_program_row(ctx, program_id)
    defaults = await program_settings(ctx, program.id)
    row = await create_task_row(ctx, program, fields, default_priority=defaults.default_priority)
    await _announce(ctx, "created", row, calendar=row.due_date is not None)
    return task_out(row, _now_local(ctx, program))


async def existing_by_source(ctx: Ctx, source_kind: str, source_ref: str) -> TasksItem | None:
    return await ctx.db.scalar(
        select(TasksItem).where(
            TasksItem.user_id == ctx.user_id,
            TasksItem.source_kind == source_kind,
            TasksItem.source_ref == source_ref,
        )
    )


async def create_tasks(
    ctx: Ctx, program_id: str, items: Sequence[TaskFields]
) -> TaskCreateManyResult:
    items = [_caller_source(ctx, f, ["items", i]) for i, f in enumerate(items)]
    program = await academics.get_program_row(ctx, program_id)
    defaults = await program_settings(ctx, program.id)
    now_local = _now_local(ctx, program)
    created: list[TasksItem] = []
    skipped: list[TaskSkipped] = []
    seen: dict[tuple[str, str], str] = {}
    for index, fields in enumerate(items):
        if fields.source_ref is not None:
            key = (fields.source_kind, fields.source_ref)
            existing = seen.get(key) or getattr(await existing_by_source(ctx, *key), "id", None)
            if existing is not None:
                skipped.append(TaskSkipped(index=index, task_id=existing))
                continue
        row = await create_task_row(
            ctx, program, fields, default_priority=defaults.default_priority
        )
        if fields.source_ref is not None:
            seen[(fields.source_kind, fields.source_ref)] = row.id
        created.append(row)
    for row in created:
        await _announce(ctx, "created", row, calendar=row.due_date is not None)
    return TaskCreateManyResult(created=[task_out(r, now_local) for r in created], skipped=skipped)


_REQUIRED = {"title", "notes", "priority", "flagged"}
_EDITABLE = {"title", "notes", "due_date", "due_time", "priority", "flagged"}


async def update_task(ctx: Ctx, inp: TaskUpdateInput) -> Task:
    row = await get_item_row(ctx, inp.task_id)
    program = await academics.get_program_row(ctx, row.program_id)
    sent = inp.model_fields_set - {"task_id"}
    bad = sorted(f for f in sent & _REQUIRED if getattr(inp, f) is None)
    if bad:
        raise AppError(
            "common.validation", 422, errors=[{"loc": [f], "code": "none_not_allowed"} for f in bad]
        )
    due_date = inp.due_date if "due_date" in sent else row.due_date
    due_time = _clean_time(inp.due_time) if "due_time" in sent else row.due_time
    if due_date is None and "due_time" not in sent:
        due_time = None  # clearing the date clears the time with it
    _check_due(due_date, due_time)
    course_id = inp.course_id if "course_id" in sent else row.course_id
    _guard_managed(row, inp)
    list_id = inp.list_id if "list_id" in sent else row.list_id
    term_id = inp.term_id if "term_id" in sent else row.term_id
    list_row = await _check_refs(
        ctx,
        program,
        term_id=inp.term_id if "term_id" in sent else None,
        course_id=inp.course_id if "course_id" in sent else None,
        list_id=inp.list_id if "list_id" in sent else None,
    )
    had_due = row.due_date is not None
    changed: list[str] = []
    for name in sorted(sent & _EDITABLE - {"due_date", "due_time"}):
        value = getattr(inp, name)
        if getattr(row, name) != value:
            setattr(row, name, value)
            changed.append(name)
    if (row.due_date, row.due_time) != (due_date, due_time):
        row.due_date, row.due_time = due_date, due_time
        changed.append("due")
    if "term_id" not in sent and ("course_id" in sent or "due" in changed) and course_id:
        term_id = await infer_term(ctx, program, course_id, due_date)
    elif "term_id" not in sent and "list_id" in sent and list_row and list_row.term_id:
        term_id = list_row.term_id
    for name, value in (("term_id", term_id), ("course_id", course_id)):
        if getattr(row, name) != value:
            setattr(row, name, value)
            changed.append(name)
    if row.list_id != list_id:
        row.list_id = list_id
        row.position = await _next_position(ctx, row.program_id, list_id, exclude=row.id)
        changed.append("list_id")
    if changed:
        row.updated_at = ctx.now
        await ctx.db.flush()
        await _announce(
            ctx,
            "updated",
            row,
            calendar=row.due_date is not None or had_due,
            changed=changed,
        )
    return task_out(row, _now_local(ctx, program))


def _guard_managed(row: TasksItem, inp: TaskUpdateInput) -> None:
    """A task made from an assessment takes its title, due date and course from it (auto.py);
    a change here would be overwritten by the next sync, so it is refused instead. Sending the
    values it already has is fine."""
    if row.source_kind != "assessment":
        return
    sent = inp.model_fields_set - {"task_id"}
    due_date = inp.due_date if "due_date" in sent else row.due_date
    due_time = _clean_time(inp.due_time) if "due_time" in sent else row.due_time
    if due_date is None and "due_time" not in sent:
        due_time = None
    course_id = inp.course_id if "course_id" in sent else row.course_id
    managed = [
        name
        for name, differs in (
            ("title", "title" in sent and inp.title != row.title),
            ("due", (row.due_date, row.due_time) != (due_date, due_time)),
            ("course_id", course_id != row.course_id),
        )
        if differs
    ]
    if managed:
        raise AppError(
            "tasks.managed_by_assessment", 409, assessment_id=row.source_ref, fields=managed
        )


async def set_completed(ctx: Ctx, task_id: str, completed: bool) -> Task:
    row = await get_item_row(ctx, task_id)
    if completed != (row.completed_at is not None):
        row.completed_at = ctx.now if completed else None
        row.updated_at = ctx.now
        await ctx.db.flush()
        await _announce(
            ctx,
            "completed" if completed else "updated",
            row,
            calendar=row.due_date is not None,
            changed=["completed_at"],
        )
    return await item_out(ctx, row)


async def move_task(ctx: Ctx, inp: TaskMoveInput) -> Task:
    row = await get_item_row(ctx, inp.task_id)
    program = await academics.get_program_row(ctx, row.program_id)
    list_id = inp.list_id if "list_id" in inp.model_fields_set else row.list_id
    list_row = await _check_refs(ctx, program, term_id=None, course_id=None, list_id=list_id)
    siblings = sorted(
        (
            await ctx.db.scalars(
                select(TasksItem).where(
                    TasksItem.user_id == ctx.user_id,
                    TasksItem.program_id == row.program_id,
                    TasksItem.list_id == list_id if list_id else TasksItem.list_id.is_(None),
                    TasksItem.id != row.id,
                )
            )
        ).all(),
        key=lambda i: (i.position, i.created_at),
    )
    if inp.before_task_id is None:
        position = rules.position_between(siblings[-1].position if siblings else None, None)
    else:
        index = next((n for n, s in enumerate(siblings) if s.id == inp.before_task_id), None)
        if index is None:
            raise not_found()
        previous = siblings[index - 1].position if index else None
        position = rules.position_between(previous, siblings[index].position)
    changed: list[str] = []
    if row.list_id != list_id:
        row.list_id = list_id
        changed.append("list_id")
        if list_row is not None and list_row.term_id and row.term_id != list_row.term_id:
            row.term_id = list_row.term_id
            changed.append("term_id")
    row.position = position
    row.updated_at = ctx.now
    await ctx.db.flush()
    await _announce(ctx, "updated", row, calendar=False, changed=[*changed, "position"])
    return task_out(row, _now_local(ctx, program))


async def delete_task(ctx: Ctx, task_id: str) -> None:
    row = await get_item_row(ctx, task_id)
    had_due = row.due_date is not None
    await ctx.db.delete(row)
    await ctx.db.flush()
    await _announce(ctx, "deleted", row, calendar=had_due)


async def _completed_rows(ctx: Ctx, inp: TaskClearInput) -> list[TasksItem]:
    """The completed tasks `clear_completed` deletes (its card counts the same rows)."""
    stmt = select(TasksItem).where(
        TasksItem.user_id == ctx.user_id,
        TasksItem.program_id == inp.program_id,
        TasksItem.completed_at.is_not(None),
    )
    if inp.list_id is not None:
        stmt = stmt.where(TasksItem.list_id == inp.list_id)
    if inp.term_id is not None:
        stmt = stmt.where(_term_filter(inp.term_id))
    if inp.course_id is not None:
        stmt = stmt.where(TasksItem.course_id == inp.course_id)
    return list(await ctx.db.scalars(stmt.order_by(TasksItem.completed_at.desc())))


async def preview_clear_completed(ctx: Ctx, inp: TaskClearInput) -> dict[str, Any]:
    """The assistant's confirmation card (M12 §3.5): how many tasks go, the latest by title."""
    await academics.get_program_row(ctx, inp.program_id)
    titles = [r.title for r in await _completed_rows(ctx, inp)]
    return {
        "changes": [{"field": "tasks", "before": titles[:10], "after": None, "count": len(titles)}]
    }


async def clear_completed(ctx: Ctx, inp: TaskClearInput) -> TaskClearResult:
    program = await academics.get_program_row(ctx, inp.program_id)
    rows = await _completed_rows(ctx, inp)
    for row in rows:
        await ctx.db.delete(row)
    await ctx.db.flush()
    if rows:
        await events.publish(
            ctx,
            "tasks.item.deleted",
            {"task_ids": [r.id for r in rows], "program_id": program.id, "changed": []},
        )
        if any(r.due_date for r in rows):
            await events.publish(ctx, "calendar.changed", {"program_id": program.id})
    return TaskClearResult(deleted=len(rows))


# --- reading tasks --------------------------------------------------------------------------


def _term_filter(term_id: str | None) -> Any:
    """A term's view includes tasks that belong to no term, so none is hidden from every term."""
    if term_id is None:
        return None
    return (TasksItem.term_id == term_id) | TasksItem.term_id.is_(None)


async def program_rows(
    ctx: Ctx,
    program_id: str,
    *,
    term_id: str | None = None,
    course_id: str | None = None,
    list_id: str | None = None,
) -> list[TasksItem]:
    stmt = select(TasksItem).where(
        TasksItem.user_id == ctx.user_id, TasksItem.program_id == program_id
    )
    if (cond := _term_filter(term_id)) is not None:
        stmt = stmt.where(cond)
    if course_id is not None:
        stmt = stmt.where(TasksItem.course_id == course_id)
    if list_id is not None:
        stmt = stmt.where(TasksItem.list_id == list_id)
    return list(await ctx.db.scalars(stmt))


def _in_view(row: TasksItem, view: View, today: date) -> bool:
    done = row.completed_at is not None
    match view:
        case "completed":
            return done
        case "today":
            return not done and row.due_date is not None and row.due_date <= today
        case "scheduled":
            return not done and row.due_date is not None
        case "inbox":
            return not done and row.list_id is None
        case "flagged":
            return not done and row.flagged
        case "all":
            return not done
    return False  # pragma: no cover


def _sorted(rows: list[TasksItem], sort: str, view: View) -> list[TasksItem]:
    if view == "completed":
        return sorted(rows, key=lambda r: r.completed_at or r.created_at, reverse=True)
    match sort:
        case "due":
            return sorted(
                rows, key=lambda r: (rules.due_sort_key(r.due_date, r.due_time), r.position)
            )
        case "priority":
            return sorted(
                rows,
                key=lambda r: (
                    rules.PRIORITY_RANK[r.priority],
                    rules.due_sort_key(r.due_date, r.due_time),
                    r.position,
                ),
            )
        case "created":
            return sorted(rows, key=lambda r: (r.created_at, r.id), reverse=True)
        case "title":
            return sorted(rows, key=lambda r: (academic_rules.normalize(r.title), r.id))
    return sorted(rows, key=lambda r: (r.position, r.created_at, r.id))


async def query_tasks(ctx: Ctx, inp: TaskQueryInput) -> TaskPage:
    program = await academics.get_program_row(ctx, inp.program_id)
    now_local = _now_local(ctx, program)
    today = now_local.date()
    rows = await program_rows(
        ctx, program.id, term_id=inp.term_id, course_id=inp.course_id, list_id=inp.list_id
    )
    if inp.only_completed and inp.view != "completed":
        wanted = [r for r in rows if _completed_in_view(r, inp.view)]
    else:
        wanted = [
            r
            for r in rows
            if _in_view(r, inp.view, today)
            or (
                inp.include_completed
                and inp.view != "completed"
                and _completed_in_view(r, inp.view)
            )
        ]
    if inp.due_from is not None:
        wanted = [r for r in wanted if r.due_date is not None and r.due_date >= inp.due_from]
    if inp.due_to is not None:
        wanted = [r for r in wanted if r.due_date is not None and r.due_date <= inp.due_to]
    if inp.search:
        wanted = [r for r in wanted if rules.match_score(inp.search, r.title, r.notes) >= 0.35]
    wanted = _sorted(wanted, inp.sort, inp.view)
    offset = int(inp.cursor) if inp.cursor and inp.cursor.isdigit() else 0
    page = wanted[offset : offset + inp.limit]
    more = offset + inp.limit < len(wanted)
    return TaskPage(
        items=[task_out(r, now_local) for r in page],
        next_cursor=str(offset + inp.limit) if more else None,
    )


def _completed_in_view(row: TasksItem, view: View) -> bool:
    """Completed tasks that a view would show had they not been completed."""
    if row.completed_at is None:
        return False
    match view:
        case "today" | "scheduled":
            return row.due_date is not None
        case "inbox":
            return row.list_id is None
        case "flagged":
            return row.flagged
    return True


async def find_tasks(ctx: Ctx, inp: TaskFindInput) -> TaskCandidates:
    program_id = inp.program_id or (ctx.scope.program_id if ctx.scope else None)
    if program_id is None:
        raise AppError(
            "common.validation", 422, errors=[{"loc": ["program_id"], "code": "missing"}]
        )
    await academics.get_program_row(ctx, program_id)
    scored = [
        (rules.match_score(inp.query, r.title, r.notes), r)
        for r in await program_rows(ctx, program_id)
        if inp.include_completed or r.completed_at is None
    ]
    best = sorted(
        ((s, r) for s, r in scored if s >= 0.35), key=lambda pair: (-pair[0], pair[1].id)
    )[: inp.limit]
    return TaskCandidates(
        items=[
            TaskCandidate(
                task_id=r.id,
                title=r.title,
                course_id=r.course_id,
                due_date=r.due_date,
                completed=r.completed_at is not None,
                source_kind=r.source_kind,  # pyright: ignore[reportArgumentType]
                score=s,
            )
            for s, r in best
        ]
    )


async def counts(
    ctx: Ctx, program_id: str, term_id: str | None, course_id: str | None = None
) -> TaskCounts:
    program = await academics.get_program_row(ctx, program_id)
    now_local = _now_local(ctx, program)
    today = now_local.date()
    rows = await program_rows(ctx, program.id, term_id=term_id, course_id=course_id)
    open_rows = [r for r in rows if r.completed_at is None]
    lists: dict[str, int] = defaultdict(int)
    courses: dict[str, int] = defaultdict(int)
    for r in open_rows:
        if r.list_id:
            lists[r.list_id] += 1
        if r.course_id:
            courses[r.course_id] += 1
    return TaskCounts(
        today=sum(_in_view(r, "today", today) for r in rows),
        overdue=sum(rules.is_overdue(r.due_date, r.due_time, False, now_local) for r in open_rows),
        scheduled=sum(_in_view(r, "scheduled", today) for r in rows),
        all=len(open_rows),
        inbox=sum(_in_view(r, "inbox", today) for r in rows),
        flagged=sum(_in_view(r, "flagged", today) for r in rows),
        completed=len(rows) - len(open_rows),
        lists=dict(lists),
        courses=dict(courses),
    )


# --- cleanup after academic changes ---------------------------------------------------------


async def detach_course(ctx: Ctx, course_id: str) -> None:
    await ctx.db.execute(
        update(TasksItem)
        .where(TasksItem.user_id == ctx.user_id, TasksItem.course_id == course_id)
        .values(course_id=None, updated_at=ctx.now)
    )


async def remove_term(ctx: Ctx, term_id: str) -> None:
    """The term's lists go; their tasks (and the term's other tasks) lose the term and the
    former land in the inbox."""
    lists = list(await ctx.db.scalars(select(TasksList).where(TasksList.term_id == term_id)))
    for list_row in lists:
        items = await ctx.db.scalars(select(TasksItem).where(TasksItem.list_id == list_row.id))
        await _to_inbox(ctx, items)
        await ctx.db.delete(list_row)
    await ctx.db.execute(
        update(TasksItem)
        .where(TasksItem.user_id == ctx.user_id, TasksItem.term_id == term_id)
        .values(term_id=None, updated_at=ctx.now)
    )
    await ctx.db.flush()


async def remove_program(ctx: Ctx, program_id: str) -> None:
    await ctx.db.execute(
        delete(TasksItem).where(
            TasksItem.user_id == ctx.user_id, TasksItem.program_id == program_id
        )
    )
    await ctx.db.execute(
        delete(TasksList).where(
            TasksList.user_id == ctx.user_id, TasksList.program_id == program_id
        )
    )
