"""Committing an import (M08 §5): items are written in order, each in its own savepoint."""

from collections.abc import Awaitable, Callable, Sequence
from datetime import date, datetime, time
from typing import Any

import structlog
from sqlalchemy import select, update

from semestra.core.context import Ctx
from semestra.core.errors import AppError, not_found
from semestra.core.events import events
from semestra.core.storage import get_storage
from semestra.modules.academics import service as academics
from semestra.modules.imports import build, dates, deps
from semestra.modules.imports.models import ImportsItem, ImportsSession
from semestra.modules.imports.schemas import (
    CommitInput,
    ImportSessionDetail,
)
from semestra.modules.imports.service.context import _term_dates_of, revalidate, target_of
from semestra.modules.imports.service.create import event_data
from semestra.modules.imports.service.rows import detail, for_agent, get_session_row, session_items
from semestra.modules.imports.service.uploads import _after_commit_delete, session_uploads

log = structlog.get_logger()


# Commit order (M08 §2): courses first, then what hangs off them.
TYPE_ORDER = {
    "course": 0,
    "course_patch": 0,
    "assessment_patch": 2,
    "task_patch": 2,
    "category": 1,
    "assessment": 2,
    "meeting": 2,
    "event": 2,
    "task": 2,
}


# Called inside the commit transaction after every item was written; raising rolls back the
# whole commit (M08 §5). `created` maps item ids to the ids written in the target modules.
CommitHook = Callable[[Ctx, ImportsSession, dict[str, str]], Awaitable[None]]


_commit_hooks: dict[str, list[CommitHook]] = {}


def register_commit_hook(source_kind: str, fn: CommitHook) -> CommitHook:
    _commit_hooks.setdefault(source_kind, []).append(fn)
    return fn


class _Commit:
    """State of one commit: what each item wrote, and how refs resolve."""

    def __init__(self, ctx: Ctx, row: ImportsSession, items: Sequence[ImportsItem]) -> None:
        self.ctx = ctx
        self.row = row
        self.target = target_of(row)
        self.by_id = {i.id: i for i in items}
        self.term_id: str | None = self.target.term_id
        self.categories: dict[str, dict[str, str]] = {}  # course id → key → category id
        self.terms: dict[str, Any] = {}

    def written(self, item_id: str) -> str | None:
        item = self.by_id.get(item_id)
        if item is None or item.decision == "reject" or not item.result:
            return None
        return item.result.get("created_id") or item.result.get("updated_id")

    def course_id(self, ref: str | None) -> str | None:
        if ref is None:
            return None
        if ref.startswith("course:"):
            return ref.removeprefix("course:")
        found = self.written(ref.removeprefix("item:"))
        if found is None:
            raise AppError("import.course_ref_missing", 422)
        return found

    async def term(self, ref: str | None, course_id: str | None, day: date | None) -> str:
        if ref is not None:
            return ref.removeprefix("term:")
        course_terms: list[str] | None = None
        if course_id is not None:
            course = await academics.course_out(
                self.ctx, await academics.get_course_row(self.ctx, course_id)
            )
            course_terms = list(course.term_ids)
        spans = {t: await self.term_dates(t) for t in course_terms or []}
        found = dates.pick_term(self.term_id, course_terms, day, spans)
        if found is None:
            raise AppError("import.term_unresolved", 422)
        return found

    async def term_dates(self, term_id: str) -> dates.TermDates:
        if term_id not in self.terms:
            self.terms[term_id] = await _term_dates_of(
                self.ctx, await academics.get_term_row(self.ctx, term_id)
            )
        return self.terms[term_id]

    async def category_ids(self, course_id: str) -> dict[str, str]:
        if course_id not in self.categories:
            book = await deps.call(self.ctx, "grading.gradebook.get", {"course_id": course_id})
            self.categories[course_id] = {c["key"]: c["id"] for c in book["categories"]}
        return self.categories[course_id]


def _local_iso(day: date, at: time | None) -> str:
    return datetime.combine(day, at or time(0, 0)).isoformat()


async def _write_course(c: _Commit, item: ImportsItem) -> dict[str, Any]:
    """Creates a course in the session's Program."""
    ctx, data, program_id = c.ctx, item.data, c.row.program_id
    term_ids = data.get("term_ids") or ([c.term_id] if c.term_id else [])
    if not term_ids:
        raise AppError("import.term_unresolved", 422)
    fields = {
        k: data[k]
        for k in ("code", "title", "alias", "credits", "instructors", "description",
                  "website_url", "planned_terms")
        if data.get(k) is not None
    }  # fmt: skip
    out = await deps.call(
        ctx,
        "academics.course.create",
        {"program_id": program_id, "term_ids": term_ids, **fields},
    )
    return {"created_id": out["id"]}


async def _write_course_patch(c: _Commit, item: ImportsItem) -> dict[str, Any]:
    """Applies the accepted field changes to an existing course."""
    ctx, data = c.ctx, item.data
    changes = {
        name: change["new"] for name, change in data["changes"].items() if change.get("apply", True)
    }
    if not changes:
        return {"updated_id": data["course_id"], "reused": True}
    out = await deps.call(
        ctx, "academics.course.update", {"course_id": data["course_id"], **changes}
    )
    return {"updated_id": out["id"]}


async def _write_category(c: _Commit, item: ImportsItem) -> dict[str, Any]:
    """Creates a grading category, or reuses the course's one with the same key."""
    ctx, data = c.ctx, item.data
    course_id = c.course_id(data.get("course_ref"))
    assert course_id is not None
    key = data.get("key") or build.slug_key(data["name"])
    known = await c.category_ids(course_id)
    if key in known:
        return {"created_id": known[key], "reused": True}
    out = await deps.call(
        ctx,
        "grading.category.create",
        {"course_id": course_id, "name": data["name"], "key": key},
    )
    known[key] = out["id"]
    return {"created_id": out["id"]}


async def _write_assessment(c: _Commit, item: ImportsItem) -> dict[str, Any]:
    """Creates an assessment; its category is a written item or a built-in key."""
    ctx, data = c.ctx, item.data
    course_id = c.course_id(data.get("course_ref"))
    assert course_id is not None
    category_id: str | None = None
    ref = data.get("category_ref")
    if isinstance(ref, str) and ref.startswith("item:"):
        category_id = c.written(ref.removeprefix("item:"))
    elif isinstance(ref, str) and ref.startswith("key:"):
        key = ref.removeprefix("key:")
        known = await c.category_ids(course_id)
        category_id = known.get(key)
        if category_id is None:
            name = next((t["name"] for t in _builtin_categories() if t["key"] == key), key.title())
            out = await deps.call(
                ctx,
                "grading.category.create",
                {"course_id": course_id, "name": name, "key": key},
            )
            category_id = known[key] = out["id"]
    assessment = {
        "title": data["title"],
        "category_id": category_id,
        "weight": data.get("weight", 0),
        "due_date": data.get("due_date"),
        "due_time": data.get("due_time") if data.get("due_date") else None,
        "note": data.get("note"),
        "source_kind": "lms" if c.row.source_kind == "lms" else "syllabus",
        "source_ref": data.get("source_ref") or f"import:{item.id}",
    }
    out = await deps.call(
        ctx,
        "grading.assessment.create_many",
        {"course_id": course_id, "assessments": [assessment]},
    )
    if out["created"]:
        return {"created_id": out["created"][0]["id"]}
    return {"created_id": out["skipped"][0]["assessment_id"], "reused": True}


async def _write_meeting(c: _Commit, item: ImportsItem) -> dict[str, Any]:
    """Creates or updates a weekly meeting with its cancelled days."""
    ctx, data = c.ctx, item.data
    course_id = c.course_id(data.get("course_ref"))
    assert course_id is not None
    first = date.fromisoformat(data["first_date"]) if data.get("first_date") else None
    last = date.fromisoformat(data["last_date"]) if data.get("last_date") else None
    term_id = await c.term(data.get("term_ref"), course_id, first)
    weeks = (await c.term_dates(term_id)).weeks
    start_week, end_week, problem = dates.meeting_weeks(
        first, last, data.get("start_week"), data.get("end_week"), weeks
    )
    if problem:
        # Never placed in the term's first week instead; validation flags most of these.
        raise AppError(problem, 422, term_id=term_id)
    meeting = {
        "term_id": term_id,
        "section_code": data.get("section_code", ""),
        "type_code": data.get("type_code", "LEC"),
        "weekday": data["weekday"],
        "start_time": data["start_time"],
        "end_time": data["end_time"],
        "recurrence": data.get("recurrence", "weekly"),
        "start_week": start_week or 1,
        "end_week": end_week,
        "location": data.get("location"),
        "instructor": data.get("instructor"),
        "source_kind": c.row.source_kind,
        "source_ref": data.get("source_ref") or f"import:{item.id}",
    }
    out = await deps.call(
        ctx, "schedule.meeting.create_many", {"course_id": course_id, "meetings": [meeting]}
    )
    meeting_id = (out["created_ids"] or out["updated_ids"])[0]
    cancelled = set(data.get("exceptions") or [])
    # A repeated import takes back the cancellations it wrote before that the file no longer
    # has; the user's own changes stay.
    for exc in out["items"][0]["exceptions"]:
        day = str(exc["original_date"])
        if exc["imported"] and day not in cancelled:
            await deps.call(
                ctx,
                "schedule.exception.delete",
                {"meeting_id": meeting_id, "original_date": day},
            )
    skipped: list[dict[str, str]] = []
    for day in data.get("exceptions") or []:
        try:
            await deps.call(
                ctx,
                "schedule.exception.upsert",
                {
                    "meeting_id": meeting_id,
                    "original_date": day,
                    "kind": "cancelled",
                    "imported": True,
                },
            )
        except AppError as exc:
            # Not a class day of the meeting (a break week, outside its weeks): reported so
            # the user is told which dates were left out.
            skipped.append({"date": day, "code": exc.code})
    result: dict[str, Any] = (
        {"created_id": meeting_id} if out["created_ids"] else {"updated_id": meeting_id}
    )
    if skipped:
        result["skipped_exceptions"] = skipped
    return result


async def _write_event(c: _Commit, item: ImportsItem) -> dict[str, Any]:
    """Creates a calendar event (course or term scoped)."""
    ctx, data, program_id = c.ctx, item.data, c.row.program_id
    course_id = c.course_id(data.get("course_ref"))
    if not data.get("date"):
        raise AppError("import.date_unresolved", 422)
    day = date.fromisoformat(data["date"])
    end_day = date.fromisoformat(data["end_date"]) if data.get("end_date") else day
    all_day = bool(data.get("all_day")) or not data.get("start_time")
    start_at = _local_iso(day, None if all_day else time.fromisoformat(data["start_time"]))
    end_time = str(data.get("end_time") or data.get("start_time") or "00:00")
    # All-day: any time on the last day makes it inclusive.
    end_at = _local_iso(end_day, time(12, 0) if all_day else time.fromisoformat(end_time))
    term_ref = data.get("term_ref")
    term_id = term_ref.removeprefix("term:") if term_ref else c.term_id
    event = {
        "title": data["title"],
        "start_at": start_at,
        "end_at": end_at,
        "all_day": all_day,
        "course_id": course_id,
        "term_id": term_id if course_id is None else None,
        "type_code": data.get("type_code"),
        "location": data.get("location"),
        "source_kind": c.row.source_kind,
        "source_ref": data.get("source_ref") or f"import:{item.id}",
    }
    out = await deps.call(
        ctx, "schedule.event.create_many", {"program_id": program_id, "events": [event]}
    )
    if out["created_ids"]:
        return {"created_id": out["created_ids"][0]}
    return {"updated_id": out["updated_ids"][0]}


async def _write_patch(c: _Commit, item: ImportsItem) -> dict[str, Any]:
    """Applies the accepted changes to an existing assessment or task."""
    ctx, data = c.ctx, item.data
    kind = item.type.removesuffix("_patch")
    target_id = data[f"{kind}_id"]
    changes = {
        name: change.get("new")
        for name, change in data["changes"].items()
        if change.get("apply", True)
    }
    if not changes:
        return {"updated_id": target_id, "reused": True}
    if "due_date" in changes or "due_time" in changes:
        old = {n: ch.get("old") for n, ch in data["changes"].items()}
        changes.setdefault("due_date", old.get("due_date"))
        changes.setdefault("due_time", old.get("due_time"))
        if not changes["due_date"]:
            changes["due_time"] = None
    if "score" in changes:  # {points_earned, points_possible}, or None to clear
        score = changes.pop("score") or {"points_earned": None, "points_possible": None}
        changes.update(score)
    name = "grading.assessment.update" if kind == "assessment" else "tasks.item.update"
    out = await deps.call(ctx, name, {f"{kind}_id": target_id, **changes})
    return {"updated_id": out.get("id", target_id)}


async def _write_task(c: _Commit, item: ImportsItem) -> dict[str, Any]:
    """Creates a task, or reuses the one with the same source."""
    ctx, data, program_id = c.ctx, item.data, c.row.program_id
    course_id = c.course_id(data.get("course_ref"))
    task = {
        "title": data["title"],
        "notes": data.get("notes") or "",
        "due_date": data.get("due_date"),
        "due_time": data.get("due_time") if data.get("due_date") else None,
        "priority": data.get("priority") if data.get("priority") != "none" else None,
        "course_id": course_id,
        "source_kind": {"lms": "lms", "agent": "agent"}.get(c.row.source_kind, "syllabus"),
        "source_ref": (data.get("source_ref") or f"import:{item.id}")[:200],
    }
    out = await deps.call(
        ctx, "tasks.item.create_many", {"program_id": program_id, "items": [task]}
    )
    if out["created"]:
        return {"created_id": out["created"][0]["id"]}
    return {"created_id": out["skipped"][0]["task_id"], "reused": True}


_WRITERS: dict[str, Callable[[_Commit, ImportsItem], Awaitable[dict[str, Any]]]] = {
    "course": _write_course,
    "course_patch": _write_course_patch,
    "category": _write_category,
    "assessment": _write_assessment,
    "meeting": _write_meeting,
    "event": _write_event,
    "assessment_patch": _write_patch,
    "task_patch": _write_patch,
    "task": _write_task,
}


async def _write(c: _Commit, item: ImportsItem) -> dict[str, Any]:
    """Writes one item through its target capability; returns the item's result."""
    writer = _WRITERS.get(item.type)
    if writer is None:
        raise AppError("common.validation", 422)
    return await writer(c, item)


def _builtin_categories() -> list[dict[str, str]]:
    from semestra.modules.grading.presets import BUILTIN_CATEGORIES

    return BUILTIN_CATEGORIES


async def commit(ctx: Ctx, inp: CommitInput) -> tuple[ImportSessionDetail, dict[str, int]]:
    row = await get_session_row(ctx, inp.session_id)
    if row.status in ("discarded", "committing"):
        raise AppError("import.session_closed", 409, state=row.status)
    if row.status in ("extracting", "failed"):
        raise AppError("import.session_not_ready", 409, state=row.status)
    await _claim(ctx, row)
    items = await session_items(ctx, row.id)
    c = _Commit(ctx, row, items)
    await _apply_wizard_courses(ctx, row, items, inp, c)
    created, counts = await _write_items(c, items, inp.item_ids)

    for hook in _commit_hooks.get(row.source_kind, []):
        await hook(ctx, row, created)
    await _file_uploads(ctx, row, c)

    row.status = "committed"
    row.committed_at = row.committed_at or ctx.now
    row.text = None
    await revalidate(ctx, row, items)
    await events.publish(ctx, "imports.session.committed", {**event_data(row), **counts})
    failed = {i.id for i in items if i.result and i.result.get("error_code")}
    return await detail(ctx, row, item_ids=failed if for_agent(ctx) else None), counts


async def _claim(ctx: Ctx, row: ImportsSession) -> None:
    """Claims the session with a conditional write: a second commit sent at the same time (a
    double click, a repeated tool call) finds it taken instead of writing every item again.
    It is also the write before the first SAVEPOINT: SQLite (pysqlite) would otherwise make that
    savepoint the outer transaction and commit it on release, so a failing hook could not roll
    back."""
    claimed = await ctx.db.execute(
        update(ImportsSession)
        .where(
            ImportsSession.id == row.id,
            ImportsSession.status == row.status,
            ImportsSession.updated_at == row.updated_at,
        )
        .values(status="committing", updated_at=ctx.now)
        .execution_options(synchronize_session=False)
    )
    if claimed.rowcount != 1:  # pyright: ignore[reportAttributeAccessIssue]
        now = await ctx.db.scalar(select(ImportsSession.status).where(ImportsSession.id == row.id))
        if now != row.status:  # another commit took it (or the session was discarded)
            raise AppError("import.session_closed", 409, state=now)
        # Same status, newer version: an item was edited while this commit was sent. Nothing
        # was written; sending it again commits what the session holds now.
        raise AppError("import.session_changed", 409)
    row.status = "committing"
    row.updated_at = ctx.now


async def _apply_wizard_courses(
    ctx: Ctx, row: ImportsSession, items: list[ImportsItem], inp: CommitInput, c: _Commit
) -> None:
    """The term wizard created (or picked) the courses itself: their items count as written,
    and course items it left out are rejected with what belongs to them."""
    if inp.wizard_courses is None:
        if target_of(row).kind == "term_wizard":
            raise AppError("import.term_unresolved", 422)
        return
    if target_of(row).kind != "term_wizard":
        raise AppError("common.validation", 422, errors=[{"loc": ["wizard_courses"]}])
    mapped = {w.item_id: w.course_id for w in inp.wizard_courses}
    for item_id, course_id in mapped.items():
        item = c.by_id.get(item_id)
        if item is None or item.type != "course":
            raise not_found()
        course = await academics.course_out(ctx, await academics.get_course_row(ctx, course_id))
        if course.program_id != row.program_id:
            raise not_found()
        item.result = {"created_id": course_id, "reused": True}
        item.decision = "accept"
        if c.term_id is None and course.term_ids:
            c.term_id = course.term_ids[-1]
    # Course items the wizard did not create were removed there, with what belongs to them.
    dropped = {
        f"item:{i.id}" for i in items if i.type == "course" and i.id not in mapped and not i.result
    }
    for item in items:
        if f"item:{item.id}" in dropped or item.data.get("course_ref") in dropped:
            item.decision = "reject"
    if c.term_id is not None:
        target = dict(row.target)
        target["term_id"] = c.term_id
        row.target = target


async def _write_items(
    c: _Commit, items: list[ImportsItem], item_ids: Sequence[str] | None
) -> tuple[dict[str, str], dict[str, int]]:
    """Writes the accepted items not written yet (only `item_ids` if given), each in its own
    savepoint so a failing one keeps its error and the rest go on. Returns the written ids by
    item id, and the counts."""
    ctx = c.ctx
    wanted = set(item_ids) if item_ids is not None else None
    todo = sorted(
        (
            i
            for i in items
            if i.decision == "accept"
            and not (i.result and not i.result.get("error_code"))
            and (wanted is None or i.id in wanted)
        ),
        key=lambda i: (TYPE_ORDER[i.type], i.position),
    )
    created: dict[str, str] = {}
    counts = {"created": 0, "updated": 0, "failed": 0}
    for item in todo:
        pending = len(ctx.after_commit)
        try:
            async with ctx.db.begin_nested():
                result = await _write(c, item)
        except AppError as exc:
            del ctx.after_commit[pending:]  # events of the rolled-back write
            item.result = {"error_code": exc.code, "error_params": _jsonable(exc.params)}
            counts["failed"] += 1
            continue
        item.result = result
        target_id = result.get("created_id") or result.get("updated_id")
        if target_id:
            created[item.id] = target_id
        counts["updated" if result.get("updated_id") or result.get("reused") else "created"] += 1
    for item in items:
        if item.result and not item.result.get("error_code"):
            target_id = item.result.get("created_id") or item.result.get("updated_id")
            if target_id:
                created.setdefault(item.id, target_id)
    return created, counts


def _jsonable(params: dict[str, Any]) -> dict[str, Any]:
    return {
        k: v for k, v in params.items() if isinstance(v, str | int | float | bool | list | dict)
    }


async def _file_uploads(ctx: Ctx, row: ImportsSession, c: _Commit) -> None:
    """A syllabus becomes a file of its course (M07), once that course exists, unless the user
    unticked "Also save to the course files" (`source_meta.keep_files: false`)."""
    if row.source_kind != "syllabus" or row.source_meta.get("keep_files") is False:
        return
    uploads = await session_uploads(ctx, row.id)
    if not uploads:
        return
    target = target_of(row)
    course_ids = [target.course_id] if target.course_id else []
    if not course_ids:
        course_ids = [
            cid
            for i in c.by_id.values()
            if i.type in ("course", "course_patch") and (cid := c.written(i.id))
        ]
    if len(course_ids) != 1:
        return  # several courses from several files: which file is whose is not tracked
    storage = get_storage(ctx)
    refs = [dict(r) for r in row.source_refs]
    for upload in uploads:
        key = upload.storage_key
        try:
            # The upload's row goes first, so the copy is not counted against the quota twice;
            # the savepoint brings it back if the copy is refused.
            async with ctx.db.begin_nested():
                await ctx.db.delete(upload)
                await ctx.db.flush()
                moved = await deps.move_to_course(
                    ctx, course_id=course_ids[0], filename=upload.filename, chunks=storage.open(key)
                )
                if moved is None:
                    raise AppError("import.target_unavailable", 422, capability="files")
        except AppError as exc:
            log.info("import_upload_not_filed", code=exc.code)
            for ref in refs:
                if ref.get("upload_id") == upload.id:
                    ref["warning_code"] = "import.upload_not_filed"
            continue
        _after_commit_delete(ctx, [key])
    row.source_refs = refs
