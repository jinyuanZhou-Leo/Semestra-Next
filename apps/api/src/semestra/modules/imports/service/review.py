"""Reviewing an import: editing, deciding and discarding items (M08 §4)."""

import contextlib
from collections.abc import Sequence
from typing import Any

from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.errors import AppError, not_found
from semestra.modules.academics import service as academics
from semestra.modules.imports import deps
from semestra.modules.imports.models import ImportsItem, ImportsSession
from semestra.modules.imports.schemas import (
    STRICT_MODELS,
    BulkDecideInput,
    ImportSession,
    ImportSessionDetail,
    ImportSessionPage,
    ItemUpdateInput,
    NewItem,
)
from semestra.modules.imports.service.context import revalidate, target_of
from semestra.modules.imports.service.create import _require_open, _validated_data
from semestra.modules.imports.service.rows import (
    detail,
    for_agent,
    get_session_row,
    session_items,
    session_out,
)
from semestra.modules.imports.service.uploads import _delete_uploads, session_uploads


async def update_item(ctx: Ctx, inp: ItemUpdateInput) -> ImportSessionDetail:
    row = await get_session_row(ctx, inp.session_id)
    items = await session_items(ctx, row.id)
    item = next((i for i in items if i.id == inp.item_id), None)
    if item is None:
        raise not_found()
    before = {i.id: (i.decision, list(i.issues or [])) for i in items}
    # After a commit only the items that failed can still be fixed and retried.
    failed = bool(item.result and item.result.get("error_code"))
    if not (row.status == "committed" and failed):
        _require_open(row)
    if inp.type is not None and inp.type != item.type:
        item.type, item.data = inp.type, _switched(item, inp.type)
        item.confidence = {}
    if inp.data is not None:
        # Nulls are dropped before validation below, so a misspelt field set to null is caught here.
        fields = STRICT_MODELS[item.type].model_fields
        unknown = [name for name in inp.data if name not in fields]
        if unknown:
            errors = [{"loc": ["data", name], "code": "extra_forbidden"} for name in unknown]
            raise AppError("common.validation", 422, errors=errors)
        merged = {**item.data, **inp.data}
        if item.type.endswith("_patch") and "changes" in inp.data:
            merged["changes"] = {**item.data.get("changes", {}), **inp.data["changes"]}
        for name in ("course_ref", "category_ref"):
            ref = merged.get(name)
            if (
                isinstance(ref, str)
                and ref.startswith("item:")
                and ref.removeprefix("item:") not in {i.id for i in items}
            ):
                raise AppError("import.course_ref_missing", 422, ref=ref)
        # Fields set to null are dropped (the drafts store only what is known).
        item.data = _validated_data(
            item.type, {k: v for k, v in merged.items() if v is not None}, strict=True
        )
        # Edited by hand: the model's certainty no longer applies to those fields.
        item.confidence = {k: v for k, v in item.confidence.items() if k not in inp.data}
        if item.result and item.result.get("error_code"):
            item.result = None  # a fixed failure can be retried
    if inp.decision is not None:
        for each in _with_contents(items, [item]) if inp.decision == "reject" else [item]:
            if each is item or not _written(each):
                each.decision = inp.decision
    await revalidate(ctx, row, items)
    # The edited item and those whose decision or issues changed with it (a rejected course
    # takes its items along; a weight fixes its course's total): a review list merges these.
    touched = {item.id} | {
        i.id for i in items if before[i.id] != (i.decision, list(i.issues or []))
    }
    return await detail(ctx, row, item_ids=touched if inp.only_touched or for_agent(ctx) else None)


def _with_contents(items: list[ImportsItem], chosen: list[ImportsItem]) -> list[ImportsItem]:
    """The chosen items and what belongs to the courses among them (their meetings,
    assessments, ...): rejecting a course leaves those out too, whichever tool rejected it.
    Accepting does not cascade: a course's items rejected one by one stay rejected."""
    courses = {f"item:{i.id}" for i in chosen if i.type == "course"}
    picked = {i.id for i in chosen}
    return chosen + [i for i in items if i.id not in picked and i.data.get("course_ref") in courses]


def _written(item: ImportsItem) -> bool:
    return bool(item.result and not item.result.get("error_code"))


def _switched(item: ImportsItem, to: str) -> dict[str, Any]:
    """The same draft as the other kind: an assessment of a course ↔ a task (M09 lets the user
    pick for each LMS assignment). Fields the other kind lacks are held, so switching back
    restores them."""
    if item.type not in ("assessment", "task"):
        raise AppError("common.validation", 422, errors=[{"loc": ["type"], "code": "invalid"}])
    data = item.data
    common = {k: data[k] for k in ("course_ref", "title", "due_date", "due_time", "due_text",
                                    "source_ref") if data.get(k) is not None}  # fmt: skip
    restored = data.get("held") or {}
    if to == "task":
        if data.get("note"):
            common["notes"] = data["note"]
        held = {k: data[k] for k in ("category_ref", "weight") if data.get(k) is not None}
        return _validated_data("task", {**restored, **common, "held": held or None})
    if not str(common.get("course_ref", "")).startswith(("course:", "item:")):
        raise AppError("import.course_ref_missing", 422)
    if data.get("notes"):
        common["note"] = str(data["notes"])[:2000]
    held = {"priority": data["priority"]} if data.get("priority", "none") != "none" else {}
    return _validated_data("assessment", {**restored, **common, "held": held or None})


def _decided(items: list[ImportsItem], inp: BulkDecideInput) -> list[ImportsItem]:
    """The items `bulk_decide` changes: those matching every filter (a rejected course takes
    its contents along), not written yet and not already decided that way."""
    chosen = [
        item
        for item in items
        if (inp.types is None or item.type in inp.types)
        and (inp.item_ids is None or item.id in inp.item_ids)
        and (inp.issue_codes is None or any(i["code"] in inp.issue_codes for i in item.issues))
    ]
    if inp.decision == "reject":
        chosen = _with_contents(items, chosen)
    return [i for i in chosen if not _written(i) and i.decision != inp.decision]


def _label(data: dict[str, Any]) -> str | None:
    found = data.get("code") or data.get("title") or data.get("name") or data.get("section_code")
    return str(found) if found else None


def _by_type(drafts: Sequence[tuple[str, dict[str, Any]]]) -> list[dict[str, Any]]:
    """How many items of each type (`import_<type>`), the courses by name."""
    changes: list[dict[str, Any]] = []
    courses = [n for t, data in drafts if t == "course" and (n := _label(data))]
    if courses:
        changes.append({"field": "import_course", "after": courses[:10], "count": len(courses)})
    counts: dict[str, int] = {}
    for t, _ in drafts:
        if t != "course":
            counts[t] = counts.get(t, 0) + 1
    return changes + [{"field": f"import_{t}", "after": n} for t, n in counts.items()]


async def preview_bulk_decide(ctx: Ctx, inp: BulkDecideInput) -> dict[str, Any]:
    """The assistant's confirmation card (M12 §3.5): how many items of each type it keeps or
    leaves out (the same selection as `bulk_decide`)."""
    row = await get_session_row(ctx, inp.session_id)
    items = _decided(await session_items(ctx, row.id), inp)
    changes = [
        {"field": "decision", "after": inp.decision},
        *_by_type([(i.type, i.data) for i in items]),
    ]
    if not items:
        changes.append({"field": "import_items", "after": 0})
    return {"target": _files(row), "changes": changes}


async def preview_update_item(ctx: Ctx, inp: ItemUpdateInput) -> dict[str, Any]:
    """The item's fields before → after (null clears one), its type and its decision."""
    row = await get_session_row(ctx, inp.session_id)
    items = await session_items(ctx, row.id)
    item = next((i for i in items if i.id == inp.item_id), None)
    if item is None:
        raise not_found()
    changes: list[dict[str, Any]] = []
    if inp.type is not None and inp.type != item.type:
        changes.append({"field": "type", "before": item.type, "after": inp.type})
    for key, value in (inp.data or {}).items():
        if key in ("source_ref", "held"):
            continue
        before = item.data.get(key)
        if key.endswith("_ref"):
            key = key.removesuffix("_ref")
            before, value = await _ref_name(ctx, items, before), await _ref_name(ctx, items, value)
        if before != value:
            changes.append({"field": key, "before": before, "after": value})
    if inp.decision is not None and inp.decision != item.decision:
        changes.append({"field": "decision", "before": item.decision, "after": inp.decision})
    return {
        "target": " · ".join(p for p in (_label(item.data), _files(row)) if p),
        "changes": changes,
    }


async def preview_add_items(ctx: Ctx, session_id: str, new: Sequence[NewItem]) -> dict[str, Any]:
    """Counts per type of what is added, new courses by name."""
    row = await get_session_row(ctx, session_id)
    return {"target": _files(row), "changes": _by_type([(n.type, n.data) for n in new])}


def _files(row: ImportsSession) -> str | None:
    return ", ".join(str(r["filename"]) for r in row.source_refs if r.get("filename")) or None


async def _ref_name(ctx: Ctx, items: Sequence[ImportsItem], ref: Any) -> str | None:
    """A `course_ref`/`category_ref` by name: an item of the session, a course or a term."""
    if not isinstance(ref, str):
        return None
    kind, _, id_ = ref.partition(":")
    with contextlib.suppress(AppError):
        if kind == "item":
            found = next((i for i in items if i.id == id_), None)
            return _label(found.data) if found is not None else None
        if kind == "course":
            course = await academics.get_course_row(ctx, id_)
            return course.code or course.title
        if kind == "term":
            return (await academics.get_term_row(ctx, id_)).name
    return None


async def bulk_decide(ctx: Ctx, inp: BulkDecideInput) -> tuple[int, ImportSessionDetail]:
    row = await get_session_row(ctx, inp.session_id)
    _require_open(row)
    items = await session_items(ctx, row.id)
    changed = 0
    for item in _decided(items, inp):
        item.decision = inp.decision
        changed += 1
    await revalidate(ctx, row, items)
    return changed, await detail(ctx, row, item_ids=set() if for_agent(ctx) else None)


async def list_sessions(
    ctx: Ctx, program_id: str, cursor: str | None, limit: int
) -> ImportSessionPage:
    await academics.get_program_row(ctx, program_id)
    rows = (
        await ctx.db.scalars(
            select(ImportsSession)
            .where(ImportsSession.user_id == ctx.user_id, ImportsSession.program_id == program_id)
            .order_by(ImportsSession.created_at.desc(), ImportsSession.id.desc())
        )
    ).all()
    offset = int(cursor) if cursor and cursor.isdigit() else 0
    page = rows[offset : offset + limit]
    more = offset + limit < len(rows)
    return ImportSessionPage(
        items=[session_out(r) for r in page], next_cursor=str(offset + limit) if more else None
    )


async def discard(ctx: Ctx, session_id: str) -> ImportSession:
    row = await get_session_row(ctx, session_id)
    if row.status == "committed":
        raise AppError("import.session_closed", 409, state=row.status)
    if row.status != "discarded":
        await _delete_uploads(ctx, await session_uploads(ctx, row.id))
        if row.job_id is not None and deps.has_capability("core.job.cancel"):
            with contextlib.suppress(AppError):
                await deps.call(ctx, "core.job.cancel", {"job_id": row.job_id})
        row.status = "discarded"
        row.text = None
        row.updated_at = ctx.now
        await ctx.db.flush()
    return session_out(row)


async def commit_preview(ctx: Ctx, session_id: str) -> dict[str, Any]:
    row = await get_session_row(ctx, session_id)
    items = await session_items(ctx, row.id)
    waiting = [
        i
        for i in items
        if i.decision == "accept" and not (i.result and not i.result.get("error_code"))
    ]
    changes = _by_type([(i.type, i.data) for i in waiting])
    rejected = sum(1 for i in items if i.decision == "reject")
    if rejected:
        changes.append({"field": "import_rejected", "after": rejected})
    pending = sum(1 for i in items if i.decision == "pending")
    if pending:
        changes.append({"field": "import_pending", "after": pending})
    issues = sum(len(i.issues) for i in waiting)
    if issues:
        changes.append({"field": "import_issues", "after": issues})
    target = target_of(row)
    into: str | None = None
    with contextlib.suppress(AppError):
        if target.course_id is not None:
            course = await academics.get_course_row(ctx, target.course_id)
            into = course.code or course.title
        elif target.term_id is not None:
            into = (await academics.get_term_row(ctx, target.term_id)).name
    target_text = " → ".join(p for p in (_files(row), into) if p)
    return {"target": target_text, "changes": changes}
