"""Lists and tasks (M05). Capabilities, subscribers and the auto-task sync call into here."""

from collections.abc import Iterable, Sequence
from datetime import date, datetime, time
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import Select, and_, case, delete, func, or_, select, true, update

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


async def announce_item(
    ctx: Ctx, kind: str, row: TasksItem, *, calendar: bool, changed: Sequence[str] = ()
) -> None:
    data = {
        "task_id": row.id,
        "program_id": row.program_id,
        "course_id": row.course_id,
        "changed": list(changed),
    }
    await events.publish(ctx, f"tasks.item.{kind}", data)
    # Tasks made from assessments are not in the `tasks.due` source (the assessment is).
    if calendar and row.source_kind != "assessment":
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
        await _delete_rows(ctx, row.program_id, items)
    else:
        await _to_inbox(ctx, items)
    await ctx.db.delete(row)
    await ctx.db.flush()
    await events.publish(
        ctx, "tasks.list.deleted", {"list_id": list_id, "program_id": row.program_id}
    )
    return result


async def _delete_rows(ctx: Ctx, program_id: str, rows: Sequence[TasksItem]) -> None:
    """Deletes tasks in one statement and announces them as one `tasks.item.deleted` with
    `task_ids` (the LMS module forgets what it imported as those tasks)."""
    if not rows:
        return
    ids = [r.id for r in rows]
    await ctx.db.execute(delete(TasksItem).where(TasksItem.id.in_(ids)))
    await events.publish(
        ctx, "tasks.item.deleted", {"task_ids": ids, "program_id": program_id, "changed": []}
    )
    if any(r.due_date and r.source_kind != "assessment" for r in rows):
        await events.publish(ctx, "calendar.changed", {"program_id": program_id})


async def _to_inbox(ctx: Ctx, items: Iterable[TasksItem]) -> None:
    """Moves tasks to the end of the Program's inbox, keeping their relative order."""
    ordered = sorted(items, key=lambda i: (i.position, i.created_at))
    if not ordered:
        return
    top = await ctx.db.scalar(
        select(func.max(TasksItem.position)).where(
            TasksItem.user_id == ctx.user_id,
            TasksItem.program_id == ordered[0].program_id,
            TasksItem.list_id.is_(None),
            TasksItem.id.not_in([i.id for i in ordered]),
        )
    )
    for item in ordered:
        top = rules.position_between(top, None)
        item.list_id = None
        item.position = top
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
    terms: dict[tuple[str, date | None], str | None] | None = None,
) -> TasksItem:
    """Validates and inserts one task (no events). Shared by the capabilities and auto tasks.
    `terms` caches inferred terms by (course, due date) across a batch."""
    _check_due(fields.due_date, fields.due_time)
    list_row = await _check_refs(
        ctx, program, term_id=fields.term_id, course_id=fields.course_id, list_id=fields.list_id
    )
    term_id = fields.term_id
    if term_id is None and fields.course_id is not None:
        key = (fields.course_id, fields.due_date)
        if terms is not None and key in terms:
            term_id = terms[key]
        else:
            term_id = await infer_term(ctx, program, fields.course_id, fields.due_date)
            if terms is not None:
                terms[key] = term_id
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
    await announce_item(ctx, "created", row, calendar=row.due_date is not None)
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
    terms: dict[tuple[str, date | None], str | None] = {}
    for index, fields in enumerate(items):
        if fields.source_ref is not None:
            key = (fields.source_kind, fields.source_ref)
            existing = seen.get(key) or getattr(await existing_by_source(ctx, *key), "id", None)
            if existing is not None:
                skipped.append(TaskSkipped(index=index, task_id=existing))
                continue
        row = await create_task_row(
            ctx, program, fields, default_priority=defaults.default_priority, terms=terms
        )
        if fields.source_ref is not None:
            seen[(fields.source_kind, fields.source_ref)] = row.id
        created.append(row)
    for row in created:
        await announce_item(ctx, "created", row, calendar=row.due_date is not None)
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
    due_date, due_time = _resolved_due(row, inp)
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
        await announce_item(
            ctx,
            "updated",
            row,
            calendar=row.due_date is not None or had_due,
            changed=changed,
        )
    return task_out(row, _now_local(ctx, program))


def _resolved_due(row: TasksItem, inp: TaskUpdateInput) -> tuple[date | None, time | None]:
    """The due date and time a partial update leaves; clearing the date clears the time."""
    sent = inp.model_fields_set
    due_date = inp.due_date if "due_date" in sent else row.due_date
    due_time = _clean_time(inp.due_time) if "due_time" in sent else row.due_time
    if due_date is None and "due_time" not in sent:
        due_time = None
    return due_date, due_time


def _guard_managed(row: TasksItem, inp: TaskUpdateInput) -> None:
    """A task made from an assessment takes its title, due date and course from it (auto.py);
    a change here would be overwritten by the next sync, so it is refused instead. Sending the
    values it already has is fine."""
    if row.source_kind != "assessment":
        return
    sent = inp.model_fields_set - {"task_id"}
    due_date, due_time = _resolved_due(row, inp)
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
        await announce_item(
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
        index = len(siblings)
    else:
        index = next((n for n, s in enumerate(siblings) if s.id == inp.before_task_id), None)
        if index is None:
            raise not_found()
    previous = siblings[index - 1].position if index else None
    following = siblings[index].position if index < len(siblings) else None
    position = rules.position_between(previous, following)
    if not rules.fits_between(position, previous, following):
        # The gap is used up (many moves into one spot): space the whole list out again.
        order = [*siblings[:index], row, *siblings[index:]]
        for n, item in enumerate(order, start=1):
            item.position = n * rules.POSITION_STEP
        position = row.position
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
    await announce_item(ctx, "updated", row, calendar=False, changed=[*changed, "position"])
    return task_out(row, _now_local(ctx, program))


async def delete_task(ctx: Ctx, task_id: str) -> None:
    row = await get_item_row(ctx, task_id)
    had_due = row.due_date is not None
    await ctx.db.delete(row)
    await ctx.db.flush()
    await announce_item(ctx, "deleted", row, calendar=had_due)


async def _completed_rows(ctx: Ctx, inp: TaskClearInput) -> list[TasksItem]:
    """The completed tasks `clear_completed` deletes (its card counts the same rows)."""
    term_id = await _term_for_view(ctx, inp.term_id, inp.list_id)
    stmt = _program_query(
        select(TasksItem),
        ctx,
        inp.program_id,
        term_id=term_id,
        course_id=inp.course_id,
        list_id=inp.list_id,
    ).where(TasksItem.completed_at.is_not(None))
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
    await _delete_rows(ctx, program.id, rows)
    return TaskClearResult(deleted=len(rows))


# --- reading tasks --------------------------------------------------------------------------


def _term_filter(term_id: str | None) -> Any:
    """A term's view includes tasks that belong to no term, so none is hidden from every term."""
    if term_id is None:
        return None
    return (TasksItem.term_id == term_id) | TasksItem.term_id.is_(None)


async def _term_for_view(ctx: Ctx, term_id: str | None, list_id: str | None) -> str | None:
    """The term filter of a view. A term's own list shows all of its tasks: one whose course
    puts it in another term (a year-long course) is still in the list it was filed in."""
    if term_id is None or list_id is None:
        return term_id
    row = await ctx.db.get(TasksList, list_id)
    return None if row is not None and row.term_id is not None else term_id


async def program_rows(
    ctx: Ctx,
    program_id: str,
    *,
    term_id: str | None = None,
    course_id: str | None = None,
    list_id: str | None = None,
    open_only: bool = False,
    due_from: date | None = None,
    due_to: date | None = None,
) -> list[TasksItem]:
    """Tasks of the Program. `open_only` leaves out completed ones and `due_from`/`due_to` the
    ones due outside those days (or not due at all): completed tasks pile up over the years, so
    readers that do not need them should not load them."""
    stmt = _program_query(
        select(TasksItem), ctx, program_id, term_id=term_id, course_id=course_id, list_id=list_id
    )
    if open_only:
        stmt = stmt.where(TasksItem.completed_at.is_(None))
    return list(await ctx.db.scalars(_due_range(stmt, due_from, due_to)))


def _due_range[S: Select[Any]](stmt: S, due_from: date | None, due_to: date | None) -> S:
    if due_from is not None:
        stmt = stmt.where(TasksItem.due_date >= due_from)
    if due_to is not None:
        stmt = stmt.where(TasksItem.due_date <= due_to)
    return stmt


def _program_query[S: Select[Any]](
    stmt: S,
    ctx: Ctx,
    program_id: str,
    *,
    term_id: str | None = None,
    course_id: str | None = None,
    list_id: str | None = None,
) -> S:
    stmt = stmt.where(TasksItem.user_id == ctx.user_id, TasksItem.program_id == program_id)
    if (cond := _term_filter(term_id)) is not None:
        stmt = stmt.where(cond)
    if course_id is not None:
        stmt = stmt.where(TasksItem.course_id == course_id)
    if list_id is not None:
        stmt = stmt.where(TasksItem.list_id == list_id)
    return stmt


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


def _view_where(view: View, today: date, *, open_: bool, done: bool) -> Any:
    """The SQL condition of a view: its unfinished tasks (`open_`) and/or the finished ones it
    would show had they not been finished (`done`). `today` keeps its finished tasks whatever
    their date, like `scheduled`."""
    if view == "completed":
        return TasksItem.completed_at.is_not(None)
    match view:
        case "today":
            shared, unfinished = TasksItem.due_date.is_not(None), TasksItem.due_date <= today
        case "scheduled":
            shared, unfinished = TasksItem.due_date.is_not(None), true()
        case "inbox":
            shared, unfinished = TasksItem.list_id.is_(None), true()
        case "flagged":
            shared, unfinished = TasksItem.flagged.is_(True), true()
        case _:
            shared, unfinished = true(), true()
    parts = []
    if open_:
        parts.append(and_(TasksItem.completed_at.is_(None), unfinished))
    if done:
        parts.append(TasksItem.completed_at.is_not(None))
    return and_(shared, or_(*parts))


_PRIORITY_RANK = case(rules.PRIORITY_RANK, value=TasksItem.priority, else_=len(rules.PRIORITY_RANK))
# Earliest first, undated last, a date without a time before the timed ones.
_DUE_ORDER = (
    TasksItem.due_date.is_(None),
    TasksItem.due_date,
    TasksItem.due_time.is_not(None),
    TasksItem.due_time,
)


def _order_by(sort: str, view: View) -> tuple[Any, ...]:
    if view == "completed":
        return (TasksItem.completed_at.desc(), TasksItem.id.desc())
    match sort:
        case "due":
            return (*_DUE_ORDER, TasksItem.position, TasksItem.id)
        case "priority":
            return (_PRIORITY_RANK, *_DUE_ORDER, TasksItem.position, TasksItem.id)
        case "created":
            return (TasksItem.created_at.desc(), TasksItem.id.desc())
    return (TasksItem.position, TasksItem.created_at, TasksItem.id)


def _sorted(rows: list[TasksItem], sort: str, view: View) -> list[TasksItem]:
    """Python order, for what SQL cannot sort the same way (titles, compared normalized)."""
    if sort == "title" and view != "completed":
        return sorted(rows, key=lambda r: (academic_rules.normalize(r.title), r.id))
    return rows


async def query_tasks(ctx: Ctx, inp: TaskQueryInput) -> TaskPage:
    """Filters, orders and pages in SQL; only a fuzzy search or the title order (both
    normalized in Python) read every matching row."""
    program = await academics.get_program_row(ctx, inp.program_id)
    now_local = _now_local(ctx, program)
    term_id = await _term_for_view(ctx, inp.term_id, inp.list_id)
    stmt = _program_query(
        select(TasksItem),
        ctx,
        program.id,
        term_id=term_id,
        course_id=inp.course_id,
        list_id=inp.list_id,
    )
    if inp.view != "completed":
        stmt = stmt.where(
            _view_where(
                inp.view,
                now_local.date(),
                open_=not inp.only_completed,
                done=inp.only_completed or inp.include_completed,
            )
        )
    else:
        stmt = stmt.where(_view_where("completed", now_local.date(), open_=False, done=True))
    stmt = _due_range(stmt, inp.due_from, inp.due_to).order_by(*_order_by(inp.sort, inp.view))
    offset = int(inp.cursor) if inp.cursor and inp.cursor.isdigit() else 0
    if inp.search or (inp.sort == "title" and inp.view != "completed"):
        wanted = list(await ctx.db.scalars(stmt))
        if inp.search:
            search = inp.search
            wanted = [r for r in wanted if rules.match_score(search, r.title, r.notes) >= 0.35]
        wanted = _sorted(wanted, inp.sort, inp.view)
        total = len(wanted)
        page = wanted[offset : offset + inp.limit]
    else:
        total = await ctx.db.scalar(
            select(func.count()).select_from(stmt.order_by(None).subquery())
        )
        total = total or 0
        page = list(await ctx.db.scalars(stmt.offset(offset).limit(inp.limit)))
    more = offset + inp.limit < total
    return TaskPage(
        items=[task_out(r, now_local) for r in page],
        next_cursor=str(offset + inp.limit) if more else None,
        total=total,
    )


async def find_tasks(ctx: Ctx, inp: TaskFindInput) -> TaskCandidates:
    program_id = inp.program_id or (ctx.scope.program_id if ctx.scope else None)
    if program_id is None:
        raise AppError(
            "common.validation", 422, errors=[{"loc": ["program_id"], "code": "missing"}]
        )
    await academics.get_program_row(ctx, program_id)
    scored = [
        (rules.match_score(inp.query, r.title, r.notes), r)
        for r in await program_rows(ctx, program_id, open_only=not inp.include_completed)
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
    open_ = TasksItem.completed_at.is_(None)
    due = TasksItem.due_date.is_not(None)
    now_time = now_local.time().replace(tzinfo=None)
    overdue = or_(
        TasksItem.due_date < today,
        and_(TasksItem.due_date == today, TasksItem.due_time < now_time),
    )

    def n(*where: Any) -> Any:
        return func.count().filter(*where)

    columns: Any = select(
        n(open_, due, TasksItem.due_date <= today),
        n(open_, overdue),
        n(open_, due),
        n(open_),
        n(open_, TasksItem.list_id.is_(None)),
        n(open_, TasksItem.flagged),
        n(TasksItem.completed_at.is_not(None)),
    )
    stmt = _program_query(columns, ctx, program.id, term_id=term_id, course_id=course_id)
    totals = tuple((await ctx.db.execute(stmt)).one())

    async def per(column: Any) -> dict[str, int]:
        grouped: Any = select(column, func.count())
        stmt: Any = _program_query(grouped, ctx, program.id, term_id=term_id, course_id=course_id)
        stmt = stmt.where(open_, column.is_not(None)).group_by(column)
        result: Any = await ctx.db.execute(stmt)
        return dict(result.all())

    lists = await per(TasksItem.list_id)
    courses = await per(TasksItem.course_id)
    if term_id is not None:
        # A term's own lists count all their tasks, as the list shows them (`_term_for_view`).
        own = select(TasksList.id).where(
            TasksList.user_id == ctx.user_id, TasksList.term_id.is_not(None)
        )
        per_list = select(TasksItem.list_id, func.count()).where(
            TasksItem.user_id == ctx.user_id,
            TasksItem.program_id == program.id,
            TasksItem.completed_at.is_(None),
            TasksItem.list_id.in_(own),
        )
        if course_id is not None:
            per_list = per_list.where(TasksItem.course_id == course_id)
        for list_id, count in (await ctx.db.execute(per_list.group_by(TasksItem.list_id))).all():
            if list_id is not None:
                lists[list_id] = count
    today_n, overdue_n, scheduled_n, all_n, inbox_n, flagged_n, completed_n = totals
    return TaskCounts(
        today=today_n,
        overdue=overdue_n,
        scheduled=scheduled_n,
        all=all_n,
        inbox=inbox_n,
        flagged=flagged_n,
        completed=completed_n,
        lists=lists,
        courses=courses,
    )


# --- cleanup after academic changes ---------------------------------------------------------


async def detach_course(ctx: Ctx, course_id: str) -> None:
    """The course's tasks stay, without it. Its assessments go with it (in one statement, without
    `grading.assessment.deleted`), so their tasks are settled here the way `auto` would: an
    unfinished one is deleted, a finished one becomes an ordinary task nothing keeps in sync."""
    managed = list(
        await ctx.db.scalars(
            select(TasksItem).where(
                TasksItem.user_id == ctx.user_id,
                TasksItem.course_id == course_id,
                TasksItem.source_kind == "assessment",
            )
        )
    )
    unfinished = [r for r in managed if r.completed_at is None]
    if unfinished:
        await _delete_rows(ctx, unfinished[0].program_id, unfinished)
    for row in managed:
        if row.completed_at is not None:
            row.source_kind, row.source_ref = "manual", None
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
