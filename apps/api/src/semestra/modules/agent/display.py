"""What the chat shows for a tool call (M12 §6.1): names instead of ids, and a few counts; and
the confirmation card of a write without its own preview (M12 §3.5): what changes, before → after.

The model never sees this. Labels are the user's own data (a term's name, a course code, a
file name); the UI words the line in its language around them. A call whose ids cannot be
resolved simply shows fewer details: never an id.
"""

import re
from collections.abc import Awaitable, Callable, Iterable
from datetime import date, datetime, time
from decimal import Decimal
from enum import Enum
from typing import Any

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules.academics import service as academics
from semestra.modules.agent.models import AgentAttachment

# (ctx, ids, the call's arguments) → id → label
Resolver = Callable[[Ctx, list[str], dict[str, Any]], Awaitable[dict[str, str]]]

# Keyed by (a capability name or a prefix of it such as its module, or None for any; the
# argument's name without `_id`/`_ids`). The longest prefix wins.
_RESOLVERS: dict[tuple[str | None, str], Resolver] = {}


def resolver(field: str, module: str | None = None) -> Callable[[Resolver], Resolver]:
    def register(fn: Resolver) -> Resolver:
        _RESOLVERS[(module, field)] = fn
        return fn

    return register


def _lookup[T](table: dict[tuple[str | None, str], T], capability: str, field: str) -> T | None:
    parts = capability.split(".")
    for n in range(len(parts), 0, -1):
        found = table.get((".".join(parts[:n]), field))
        if found is not None:
            return found
    return table.get((None, field))


async def _each(
    ids: Iterable[str], label: Callable[[str], Awaitable[str | None]]
) -> dict[str, str]:
    out: dict[str, str] = {}
    for id_ in ids:
        try:
            found = await label(id_)
        except AppError:
            continue
        if found:
            out[id_] = found
    return out


@resolver("program")
async def _program(ctx: Ctx, ids: list[str], args: dict[str, Any]) -> dict[str, str]:
    async def label(id_: str) -> str:
        return (await academics.get_program_row(ctx, id_)).name

    return await _each(ids, label)


@resolver("term")
async def _term(ctx: Ctx, ids: list[str], args: dict[str, Any]) -> dict[str, str]:
    async def label(id_: str) -> str:
        return (await academics.get_term_row(ctx, id_)).name

    return await _each(ids, label)


@resolver("continue_course")
@resolver("course")
async def _course(ctx: Ctx, ids: list[str], args: dict[str, Any]) -> dict[str, str]:
    async def label(id_: str) -> str:
        row = await academics.get_course_row(ctx, id_)
        return row.code or row.title

    return await _each(ids, label)


@resolver("id", module="agent.attachment")
@resolver("attachment")
async def _attachment(ctx: Ctx, ids: list[str], args: dict[str, Any]) -> dict[str, str]:
    async def label(id_: str) -> str | None:
        row = await ctx.db.get(AgentAttachment, id_)
        return row.name if row is not None and row.user_id == ctx.user_id else None

    return await _each(ids, label)


@resolver("item", module="files")
@resolver("file_item")
async def _file(ctx: Ctx, ids: list[str], args: dict[str, Any]) -> dict[str, str]:
    from semestra.modules.files import service as files

    async def label(id_: str) -> str:
        return (await files.get_item(ctx, id_)).display_name

    return await _each(ids, label)


@resolver("session", module="imports")
async def _import_session(ctx: Ctx, ids: list[str], args: dict[str, Any]) -> dict[str, str]:
    from semestra.modules.imports import service as imports

    async def label(id_: str) -> str | None:
        row = await imports.get_session_row(ctx, id_)
        names = [str(r["filename"]) for r in row.source_refs if r.get("filename")]
        return ", ".join(names) or None

    return await _each(ids, label)


@resolver("item", module="imports")
async def _import_item(ctx: Ctx, ids: list[str], args: dict[str, Any]) -> dict[str, str]:
    from semestra.modules.imports import service as imports

    session_id = args.get("session_id")
    if not isinstance(session_id, str):
        return {}
    try:
        await imports.get_session_row(ctx, session_id)
    except AppError:
        return {}
    wanted = set(ids)
    out: dict[str, str] = {}
    for item in await imports.items_of(ctx, session_id):
        if item.id not in wanted:
            continue
        data = item.data
        found = data.get("code") or data.get("title") or data.get("section_code")
        if isinstance(found, str) and found:
            out[item.id] = found
    return out


@resolver("before_task")
@resolver("task")
async def _task(ctx: Ctx, ids: list[str], args: dict[str, Any]) -> dict[str, str]:
    from semestra.modules.tasks import service as tasks

    async def label(id_: str) -> str:
        return (await tasks.get_item_row(ctx, id_)).title

    return await _each(ids, label)


@resolver("list", module="tasks")
async def _task_list(ctx: Ctx, ids: list[str], args: dict[str, Any]) -> dict[str, str]:
    from semestra.modules.tasks import service as tasks

    async def label(id_: str) -> str:
        return (await tasks.get_list_row(ctx, id_)).name

    return await _each(ids, label)


@resolver("parent", module="files")
@resolver("folder")
async def _folder(ctx: Ctx, ids: list[str], args: dict[str, Any]) -> dict[str, str]:
    from semestra.modules.files import service as files

    async def label(id_: str) -> str:
        return (await files.get_folder(ctx, id_)).name

    return await _each(ids, label)


async def _owned(
    ctx: Ctx, model: type[Any], ids: list[str], name: Callable[[Any], str | None]
) -> dict[str, str]:
    """Labels read straight from the user's own rows (modules without a public getter)."""

    async def label(id_: str) -> str | None:
        row = await ctx.db.get(model, id_)
        return name(row) if row is not None and row.user_id == ctx.user_id else None

    return await _each(ids, label)


@resolver("assessment")
async def _assessment(ctx: Ctx, ids: list[str], args: dict[str, Any]) -> dict[str, str]:
    from semestra.modules.grading.models import GradingAssessment

    return await _owned(ctx, GradingAssessment, ids, lambda row: row.title)


@resolver("category")
async def _category(ctx: Ctx, ids: list[str], args: dict[str, Any]) -> dict[str, str]:
    from semestra.modules.grading.models import GradingCategory

    return await _owned(ctx, GradingCategory, ids, lambda row: row.name)


@resolver("meeting")
async def _meeting(ctx: Ctx, ids: list[str], args: dict[str, Any]) -> dict[str, str]:
    from semestra.modules.schedule import meetings as schedule

    async def label(id_: str) -> str:
        return await schedule.meeting_label(ctx, id_)

    return await _each(ids, label)


@resolver("event_type")
async def _event_type(ctx: Ctx, ids: list[str], args: dict[str, Any]) -> dict[str, str]:
    from semestra.modules.schedule.models import ScheduleEventType

    return await _owned(ctx, ScheduleEventType, ids, lambda row: f"{row.code} {row.name}")


@resolver("event")
async def _event(ctx: Ctx, ids: list[str], args: dict[str, Any]) -> dict[str, str]:
    from semestra.modules.schedule.models import ScheduleEvent

    return await _owned(ctx, ScheduleEvent, ids, lambda row: row.title)


@resolver("instance")
async def _instance(ctx: Ctx, ids: list[str], args: dict[str, Any]) -> dict[str, str]:
    """A board card by what the user calls it: a habit's or counter's name, a note's first line.
    Read as stored (a card its board only generates has nothing to show yet)."""
    from semestra.modules.layouts import service as layouts
    from semestra.modules.layouts.models import LayoutsCardSetting

    return await _owned(ctx, LayoutsCardSetting, ids, lambda row: layouts.card_name(row.settings))


@resolver("scope")
async def _scope(ctx: Ctx, ids: list[str], args: dict[str, Any]) -> dict[str, str]:
    """A settings level or a board, by the `scope_type` beside it (`today` is a Program's)."""
    kind = args.get("scope_type")
    by_kind: dict[Any, Resolver] = {
        "program": _program,
        "today": _program,
        "term": _term,
        "course": _course,
    }
    fn = by_kind.get(kind)
    return await fn(ctx, ids, args) if fn is not None else {}


async def _lms_program(ctx: Ctx, args: dict[str, Any]) -> str | None:
    program_id = args.get("program_id")
    if isinstance(program_id, str):
        return program_id
    course_id = args.get("course_id")
    if isinstance(course_id, str):
        try:
            return (await academics.get_course_row(ctx, course_id)).program_id
        except AppError:
            return None
    return None


@resolver("connection", module="lms")
async def _lms_connection(ctx: Ctx, ids: list[str], args: dict[str, Any]) -> dict[str, str]:
    from semestra.modules.lms.models import LmsConnection

    return await _owned(ctx, LmsConnection, ids, lambda row: row.display_name)


@resolver("external_course", module="lms")
async def _lms_course(ctx: Ctx, ids: list[str], args: dict[str, Any]) -> dict[str, str]:
    """Courses on the Program's LMS, from the cached course list (`lms.course.list`)."""
    from semestra.modules.lms import previews

    program_id = await _lms_program(ctx, args)
    if program_id is None:
        return {}
    return await previews.external_course_labels(ctx, program_id, ids)


@resolver("external", module="lms.assignment")
async def _lms_assignment(ctx: Ctx, ids: list[str], args: dict[str, Any]) -> dict[str, str]:
    """Assignments of a linked course, from the cached list (`lms.assignment.list`)."""
    from semestra.modules.lms import previews

    course_id = args.get("course_id")
    if not isinstance(course_id, str):
        return {}
    return await previews.assignment_labels(ctx, course_id, ids)


@resolver("file", module="lms")
async def _lms_file(ctx: Ctx, ids: list[str], args: dict[str, Any]) -> dict[str, str]:
    from semestra.modules.lms import previews

    course_id = args.get("course_id")
    if not isinstance(course_id, str):
        return {}
    return await previews.file_labels(ctx, course_id, ids)


# A `*_ref` value that points at a record: `course:<id>`, `term:<id>`, or an import's `item:<id>`.
_REF = re.compile(r"^(course|term|item):(.+)$")


def _ref(value: Any) -> tuple[str, str] | None:
    found = _REF.match(value) if isinstance(value, str) else None
    return (found.group(1), found.group(2)) if found else None


def _id_fields(args: dict[str, Any]) -> list[tuple[str, list[str]]]:
    """(argument name without `_id`/`_ids`, ids) for every id argument, nested ones included, in
    argument order. A top-level `id` counts as field `id`; a `*_ref` value as its kind."""
    found: list[tuple[str, list[str]]] = []
    if isinstance(args.get("id"), str):
        found.append(("id", [args["id"]]))

    def walk(value: Any) -> None:
        if isinstance(value, list):
            for each in value:  # pyright: ignore[reportUnknownVariableType]
                walk(each)
            return
        if not isinstance(value, dict):
            return
        for key, inner in value.items():  # pyright: ignore[reportUnknownVariableType]
            name = str(key)  # pyright: ignore[reportUnknownArgumentType]
            if name.endswith("_id") and isinstance(inner, str):
                found.append((name.removesuffix("_id"), [inner]))
            elif name.endswith("_ids") and isinstance(inner, list):
                ids = [str(i) for i in inner if isinstance(i, str)]  # pyright: ignore[reportUnknownVariableType]
                found.append((name.removesuffix("_ids"), ids))
            elif name.endswith("_ref") and (ref := _ref(inner)) is not None:
                found.append((ref[0], [ref[1]]))
            else:
                walk(inner)

    walk(args)
    return found


async def labels(ctx: Ctx, capability: str, args: dict[str, Any]) -> list[str]:
    """The names behind the id arguments of a call, in argument order, without repeats."""
    out: list[str] = []
    for field, ids in _id_fields(args):
        fn = _lookup(_RESOLVERS, capability, field)
        if fn is None or not ids:
            continue
        found = await fn(ctx, ids, args)
        out += [found[i] for i in ids if i in found and found[i] not in out]
    return out


def _named(payload: Any) -> str | None:
    """A created or read object's own name (`{name}`, or `{term: {name}}`)."""
    if not isinstance(payload, dict):
        return None
    for key in ("code", "name", "title"):
        value = payload.get(key)  # pyright: ignore[reportUnknownMemberType]
        if isinstance(value, str) and value:
            return value
    objects = [v for v in payload.values() if isinstance(v, dict)]  # pyright: ignore[reportUnknownVariableType]
    return _named(objects[0]) if len(objects) == 1 else None  # pyright: ignore[reportUnknownArgumentType]


async def describe(ctx: Ctx, capability: str, args: dict[str, Any], payload: Any) -> dict[str, Any]:
    """`target`: what the call was about, by name; `count`: how many items it read; and, for
    imports, the session's counts. Keys with nothing to say are left out."""
    out: dict[str, Any] = {}
    names = await labels(ctx, capability, args)
    own = _named(payload)
    if own and own not in names:
        names.append(own)
    if names:
        out["target"] = names
    if isinstance(payload, dict):
        items = payload.get("items")  # pyright: ignore[reportUnknownMemberType]
        if isinstance(items, list):
            out["count"] = len(items)  # pyright: ignore[reportUnknownArgumentType]
        for key in ("changed", "created", "updated", "failed"):
            value = payload.get(key)  # pyright: ignore[reportUnknownMemberType]
            if isinstance(value, int) and not isinstance(value, bool):
                out[key] = value
        summary = payload.get("summary")  # pyright: ignore[reportUnknownMemberType]
        if isinstance(summary, dict) and isinstance(summary.get("accepted"), dict):  # pyright: ignore[reportUnknownMemberType]
            out["accepted"] = summary["accepted"]
            out["issues"] = sum(int(n) for n in (summary.get("issues") or {}).values())  # pyright: ignore[reportUnknownMemberType, reportUnknownArgumentType, reportUnknownVariableType]
    return out


# --- confirmation cards of writes without their own preview (M12 §3.5) -----------------------

# (ctx, id) → the record an update is about, as stored (None when it is not the user's).
Loader = Callable[[Ctx, str], Awaitable[Any]]
# Capability → (the argument holding its own record's id, how that record is read). Named
# explicitly: the first id of an input can be a parent (a scale's Program), not the record.
_RECORDS: dict[str, tuple[str, Loader]] = {}

# Writes that change one existing record: the card shows its values before → after.
_CHANGES_ONE = ("update", "move")


def _owned_row(model: type[Any]) -> Loader:
    async def load(ctx: Ctx, id_: str) -> Any:
        row = await ctx.db.get(model, id_)
        return row if row is not None and row.user_id == ctx.user_id else None

    return load


async def _card_settings(ctx: Ctx, instance_id: str) -> Any:
    """A card instance's settings, as fields (a sticky note's `content`)."""
    from types import SimpleNamespace

    from semestra.modules.layouts.models import LayoutsCardSetting

    row = await _owned_row(LayoutsCardSetting)(ctx, instance_id)
    return SimpleNamespace(**row.settings) if row is not None else None


def _register_records() -> None:
    from semestra.modules.academics.models import (
        AcademicsCourse,
        AcademicsProgram,
        AcademicsTerm,
    )
    from semestra.modules.files.models import FilesFolder, FilesItem
    from semestra.modules.grading.models import GradingCategory, GradingCourseResult
    from semestra.modules.schedule.models import ScheduleEvent, ScheduleEventType, ScheduleMeeting
    from semestra.modules.tasks.models import TasksItem, TasksList

    for names, field, load in (
        (("academics.program.update",), "program_id", _owned_row(AcademicsProgram)),
        (("academics.term.update",), "term_id", _owned_row(AcademicsTerm)),
        (("academics.course.update",), "course_id", _owned_row(AcademicsCourse)),
        (("grading.course_result.update",), "course_id", _owned_row(GradingCourseResult)),
        (("grading.category.update",), "category_id", _owned_row(GradingCategory)),
        (("tasks.item.update", "tasks.item.move"), "task_id", _owned_row(TasksItem)),
        (("tasks.list.update",), "list_id", _owned_row(TasksList)),
        (("files.item.update",), "item_id", _owned_row(FilesItem)),
        (("files.folder.update",), "folder_id", _owned_row(FilesFolder)),
        (("schedule.meeting.update",), "meeting_id", _owned_row(ScheduleMeeting)),
        (("schedule.event.update",), "event_id", _owned_row(ScheduleEvent)),
        (("schedule.event_type.update",), "event_type_id", _owned_row(ScheduleEventType)),
        (("sticky.note.update",), "instance_id", _card_settings),
    ):
        for name in names:
            _RECORDS[name] = (field, load)


def _value(value: Any) -> Any:
    """A stored value as the card shows it, in the form the model sends it."""
    if isinstance(value, time):
        return value.isoformat(timespec="minutes" if not value.second else "seconds")
    if isinstance(value, date | datetime):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, Enum):
        return value.value
    return value


def _same(before: Any, after: Any) -> bool:
    """Whether a sent value is what is stored: the same moment in another offset is no change."""
    if isinstance(before, str) and isinstance(after, str) and "T" in before and "T" in after:
        try:
            return datetime.fromisoformat(before) == datetime.fromisoformat(after)
        except ValueError:
            pass
    return before == after


# Ids of things in the app's catalog, not records: shown as values the UI names (a kind of card).
_CATALOG = {"card_id": "card"}


def _is_id(key: str) -> bool:
    return key not in _CATALOG and (key in ("id", "fields") or key.endswith(("_id", "_ids")))


async def _shown(ctx: Ctx, capability: str, value: Any, args: dict[str, Any]) -> Any:
    """An argument's value as people read it: without ids (the card names them in `target`),
    `*_ref` values by name (`course: APS105`) and internal refs left out; None when nothing is
    left (an object that only held ids and its `kind`)."""
    if isinstance(value, dict):
        kept: dict[str, Any] = {}
        for k, v in value.items():  # pyright: ignore[reportUnknownVariableType]
            key = str(k)  # pyright: ignore[reportUnknownArgumentType]
            if _is_id(key):
                continue
            if key.endswith("_ref"):
                ref = _ref(v)
                fn = _lookup(_RESOLVERS, capability, ref[0]) if ref else None
                found = (await fn(ctx, [ref[1]], args)).get(ref[1]) if ref and fn else None
                if found:
                    kept[key.removesuffix("_ref")] = found
                continue
            shown = await _shown(ctx, capability, v, args)
            if shown is not None:
                kept[key] = shown
        return kept if set(kept) - {"kind"} else None
    if isinstance(value, list):
        items = [await _shown(ctx, capability, v, args) for v in value]  # pyright: ignore[reportUnknownVariableType]
        kept_items = [v for v in items if v is not None]
        return kept_items if kept_items or not value else None
    return value


async def _name_of(ctx: Ctx, capability: str, field: str, id_: Any, args: dict[str, Any]) -> Any:
    if not isinstance(id_, str):
        return None
    fn = _lookup(_RESOLVERS, capability, field)
    return (await fn(ctx, [id_], args)).get(id_) if fn is not None else None


async def preview(ctx: Ctx, capability: str, args: dict[str, Any]) -> dict[str, Any]:
    """The card of a write without its own preview: each argument as a change, ids by name.

    For an update (or move) of one record, each sent field shows its stored value before → the
    new one; null shows as cleared, and a changed id (`list_id`) as the names before → after.
    A reorder shows the new order by name. `target` names the remaining ids."""
    if not _RECORDS:
        _register_records()
    verb = capability.rsplit(".", 1)[-1]
    primary, load = _RECORDS.get(capability, (None, None))
    row: Any = None
    if verb in _CHANGES_ONE and primary and load and isinstance(args.get(primary), str):
        row = await load(ctx, args[primary])
    changes: list[dict[str, Any]] = []
    named: set[str] = set()  # id arguments shown as changes, so not in `target`
    for key, value in args.items():
        if key == primary or key == "fields" or (key == "scope_type" and "scope_id" in args):
            continue  # the scope's kind only says how `target` names it
        if key in _CATALOG:
            changes.append({"field": _CATALOG[key], "after": value})
            named.add(key)
            continue
        if key.endswith("_ids") and verb == "reorder" and isinstance(value, list):
            field = key.removesuffix("_ids")
            names = [await _name_of(ctx, capability, field, v, args) for v in value]  # pyright: ignore[reportUnknownVariableType]
            changes.append({"field": "order", "after": [n for n in names if n]})
            named.add(key)
            continue
        if _is_id(key):
            if row is None or not hasattr(row, key):
                continue
            field = key.removesuffix("_id")
            before = await _name_of(ctx, capability, field, getattr(row, key), args)
            after = await _name_of(ctx, capability, field, value, args)
            named.add(key)
            if value is not None and after is None:
                continue  # an id that names nothing: the card has nothing to say about it
            if value != getattr(row, key):
                changes.append({"field": field, "before": before, "after": after})
            continue
        if value is None:
            # Clearing a value of a record; elsewhere null only means "not given".
            if row is not None:
                change: dict[str, Any] = {"field": key, "after": None}
                if hasattr(row, key):
                    change["before"] = _value(getattr(row, key))
                changes.append(change)
            continue
        if key.endswith("_ref"):
            # `course:<id>` by name; other refs (`source_ref`) are bookkeeping.
            ref = _ref(value)
            name = await _name_of(ctx, capability, ref[0], ref[1], args) if ref else None
            if name:
                changes.append({"field": key.removesuffix("_ref"), "after": name})
            named.add(key)
            continue
        shown = await _shown(ctx, capability, value, args)
        if shown is None:
            continue
        change = {"field": key, "after": shown}
        if row is not None and hasattr(row, key):
            before = _value(getattr(row, key))
            if not _same(before, shown):
                change["before"] = before
        changes.append(change)
    out: dict[str, Any] = {"changes": changes}
    rest = {k: v for k, v in args.items() if k not in named}
    names = await labels(ctx, capability, rest)
    if names:
        out["target"] = " · ".join(names)
    return out
