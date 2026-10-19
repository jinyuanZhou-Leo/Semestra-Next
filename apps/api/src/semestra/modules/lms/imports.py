"""Imports from the LMS through M08 (M09 §4, §5): courses, assignments, syllabus and updates.

Everything goes into an M08 session the user reviews; nothing is written before the commit.
What the commit needs to know about the LMS (which external course a course item is, which
assignment an assessment came from) is kept in the session's `source_meta.lms.items`, keyed
by item id. The commit hook writes course links and imported refs in the commit's transaction.
"""

import re
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules.academics import service as academics
from semestra.modules.grading.models import GradingAssessment
from semestra.modules.imports import register_commit_hook
from semestra.modules.imports import service as imports
from semestra.modules.imports.models import ImportsItem, ImportsSession
from semestra.modules.imports.schemas import Confidence, NewItem, SessionCreateInput, SessionTarget
from semestra.modules.lms import html, reads, service
from semestra.modules.lms.errors import lms_error
from semestra.modules.lms.models import LmsCourseLink, LmsImportedRef
from semestra.modules.lms.schemas.io import (
    AssignmentsImportInput,
    AssignmentUpdate,
    CoursesImportInput,
    FieldUpdate,
    ImportStarted,
    ImportTarget,
    UpdatesOutput,
)

MAX_TEXT = 100_000
CODE = re.compile(r"\b([A-Z]{2,5}\s?\d{2,4}[A-Z0-9]{0,3})\b")


def source_ref(connection_id: str, assignment_id: str) -> str:
    """What the gradebook (M03) and tasks (M05) dedupe re-imports by."""
    return f"lms:{connection_id}:assignment:{assignment_id}"


def course_code(raw: str | None) -> str | None:
    """`APS105H1 F LEC0101` → `APS105H1`; codes that don't look like one are kept (cut)."""
    if not raw:
        return None
    match = CODE.search(raw.upper())
    return (match.group(1).replace(" ", "") if match else raw.strip())[:32] or None


def _slug(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:32].strip("-")
    return slug or "lms"


async def _session(
    ctx: Ctx, program_id: str, target: SessionTarget, meta: dict[str, Any]
) -> ImportsSession:
    detail = await imports.create_session(
        ctx,
        SessionCreateInput(
            program_id=program_id, source_kind="lms", target=target, source_meta=meta
        ),
    )
    return await imports.get_session_row(ctx, detail.id)


async def _fill(
    ctx: Ctx,
    row: ImportsSession,
    new: list[NewItem],
    refs: list[dict[str, Any]],
    by_key: dict[str, dict[str, Any]],
) -> ImportStarted:
    if not new:
        raise AppError("import.no_content", 422)
    items = await imports.add_items(ctx, row, new)
    lms_items = {
        item.id: by_key[n.key] for item, n in zip(items, new, strict=True) if n.key in by_key
    }
    meta = dict(row.source_meta)
    meta["lms"] = {**meta.get("lms", {}), "items": lms_items}
    row.source_meta = meta
    row.source_refs = refs
    await ctx.db.flush()
    return ImportStarted(session_id=row.id, program_id=row.program_id, count=len(items))


# --- courses --------------------------------------------------------------------------------


async def import_courses(ctx: Ctx, inp: CoursesImportInput) -> ImportStarted:
    await academics.get_program_row(ctx, inp.program_id)
    if inp.term_wizard:
        target = SessionTarget(kind="term_wizard", start_date=inp.start_date, end_date=inp.end_date)
    elif inp.term_id is not None:
        term = await academics.get_term_row(ctx, inp.term_id)
        if term.program_id != inp.program_id:
            raise AppError("common.not_found", 404)
        target = SessionTarget(kind="term", term_id=inp.term_id)
    else:
        raise AppError("common.validation", 422, errors=[{"loc": ["term_id"], "code": "missing"}])
    listing = await service.external_courses(ctx, inp.program_id, include_past=True)
    wanted = {c.external_id: c for c in listing.items}
    connection_id = listing.connection_id
    row = await _session(
        ctx,
        inp.program_id,
        target,
        {"provider": listing.provider, "connection_id": connection_id, "lms": {"kind": "courses"}},
    )
    new: list[NewItem] = []
    refs: list[dict[str, Any]] = []
    by_key: dict[str, dict[str, Any]] = {}
    for external_id in dict.fromkeys(inp.external_course_ids):
        course = wanted.get(external_id)
        if course is None or course.linked_course_id is not None:
            continue  # gone, or already a course of this Program
        key = f"c{len(new)}"
        data: dict[str, Any] = {"title": course.name[:200]}
        if code := course_code(course.code):
            data["code"] = code
        if course.code:
            data["alias"] = course.code.strip()[:40]
        if course.web_url:
            data["website_url"] = course.web_url[:500]
        new.append(NewItem(key=key, type="course", data=data))
        by_key[key] = {
            "external_id": course.external_id,
            "code": course.code,
            "name": course.name,
            "term": course.term,
            "web_url": course.web_url,
        }
        refs.append(
            {"lms_course_id": course.external_id, "filename": course.name, "status": "done"}
        )
    return await _fill(ctx, row, new, refs, by_key)


# --- assignments ----------------------------------------------------------------------------


def _local(due_at: str | None, tz: ZoneInfo) -> tuple[str | None, str | None]:
    if not due_at:
        return None, None
    local = datetime.fromisoformat(due_at).astimezone(tz)
    return local.date().isoformat(), local.time().replace(microsecond=0).isoformat()


def _weights(assignments: list[dict[str, Any]]) -> dict[str, float]:
    """Each assignment's share of the course grade, from its group's weight and its points
    (equal shares when the group has no points). Only for courses that weight their groups."""
    groups: dict[str, list[dict[str, Any]]] = {}
    for a in assignments:
        if a.get("group_weight") is not None and a.get("group_id"):
            groups.setdefault(a["group_id"], []).append(a)
    out: dict[str, float] = {}
    for members in groups.values():
        weight = float(members[0]["group_weight"])
        points = sum(float(a.get("points") or 0) for a in members)
        for a in members:
            share = (float(a.get("points") or 0) / points) if points else 1 / len(members)
            out[a["external_id"]] = round(weight * share, 2)
    return out


async def import_assignments(ctx: Ctx, inp: AssignmentsImportInput) -> ImportStarted:
    link, b = await service.require_link(ctx, inp.course_id)
    service.require_feature(b, "assignments")
    data, _ = await reads.raw_assignments(ctx, inp.course_id, refresh=True)
    by_id = {a["external_id"]: a for a in data}
    done = await reads.imported_targets(ctx, link.id)
    program = await academics.get_program_row(ctx, link.program_id)
    tz = ZoneInfo(program.timezone)
    weights = _weights(data)
    row = await _session(
        ctx,
        link.program_id,
        SessionTarget(kind="course", course_id=inp.course_id),
        {
            "provider": b.row.provider,
            "connection_id": b.row.id,
            "lms": {"kind": "assignments", "link_id": link.id},
        },
    )
    course_ref = f"course:{inp.course_id}"
    new: list[NewItem] = []
    refs: list[dict[str, Any]] = []
    by_key: dict[str, dict[str, Any]] = {}
    groups: dict[str, str] = {}  # Canvas group id -> category item key
    slugs: set[str] = set()
    for external_id in dict.fromkeys(inp.external_ids):
        a = by_id.get(external_id)
        if a is None or external_id in done:
            continue  # gone, or imported before (M09 §11: importing twice creates one)
        due_date, due_time = _local(a.get("due_at"), tz)
        ref = source_ref(b.row.id, external_id)
        note = a.get("web_url")
        key = f"a{len(new)}"
        if inp.as_kind == "assessment":
            item: dict[str, Any] = {"course_ref": course_ref, "title": a["name"][:200]}
            group = a.get("group_name")
            if group:
                # Canvas groups are told apart by id: two groups may share a name or a slug.
                group_key = str(a.get("group_id") or group)
                if group_key not in groups:
                    groups[group_key] = f"g{len(groups)}"
                    slug = _slug(group)
                    if slug in slugs:
                        slug = f"{slug[:20].strip('-')}-{_slug(group_key)}"[:32].strip("-")
                    slugs.add(slug)
                    new.append(
                        NewItem(
                            key=groups[group_key],
                            type="category",
                            data={
                                "course_ref": course_ref,
                                "name": group[:200],
                                "key": slug,
                                **(
                                    {"weight_total": a["group_weight"]}
                                    if a.get("group_weight") is not None
                                    else {}
                                ),
                            },
                        )
                    )
                item["category_ref"] = f"item:{groups[group_key]}"
            confidence: dict[str, Confidence] = {}
            if external_id in weights:
                item["weight"] = weights[external_id]
            else:
                confidence = {"weight": "low"}  # left for the user to fill in
            item.update(due_date=due_date, due_time=due_time, note=note, source_ref=ref)
            new.append(NewItem(key=key, type="assessment", data=item, confidence=confidence))
        else:
            item = {
                "course_ref": course_ref,
                "title": a["name"][:200],
                "due_date": due_date,
                "due_time": due_time,
                "notes": note,
                "source_ref": ref,
            }
            new.append(NewItem(key=key, type="task", data=item))
        by_key[key] = {
            "external_id": external_id,
            "link_id": link.id,
            "snapshot": snapshot(a, weights.get(external_id)),
            "updated_at": a.get("updated_at"),
        }
        refs.append(
            {"lms_course_id": link.external_course_id, "filename": a["name"], "status": "done"}
        )
    return await _fill(ctx, row, new, refs[:50], by_key)


def snapshot(a: dict[str, Any], weight: float | None = None) -> dict[str, Any]:
    """What update detection compares (M09 §4). The weight is the effective one from the
    assignment's group, so a group weight or sibling change shows up as an update too."""
    return {
        "title": a.get("name"),
        "due_at": a.get("due_at"),
        "points": a.get("points"),
        "weight": weight,
    }


# --- syllabus -------------------------------------------------------------------------------


async def import_syllabus(ctx: Ctx, course_id: str) -> ImportStarted:
    link, b = await service.require_link(ctx, course_id)
    service.require_feature(b, "syllabus")
    text = (await reads.syllabus(ctx, course_id, refresh=True)).html
    plain = html.to_text(text)
    if not plain:
        raise AppError("import.no_content", 422)
    detail = await imports.create_session(
        ctx,
        SessionCreateInput(
            program_id=link.program_id,
            source_kind="text",
            target=SessionTarget(kind="course", course_id=course_id),
            text=plain[:MAX_TEXT],
            source_meta={
                "provider": b.row.provider,
                "connection_id": b.row.id,
                "lms": {"kind": "syllabus"},
            },
        ),
    )
    return ImportStarted(session_id=detail.id, program_id=link.program_id, count=0)


# --- updates --------------------------------------------------------------------------------


async def _refs(ctx: Ctx, link_id: str) -> list[LmsImportedRef]:
    return list(
        await ctx.db.scalars(
            select(LmsImportedRef).where(
                LmsImportedRef.link_id == link_id, LmsImportedRef.external_kind == "assignment"
            )
        )
    )


def _same_time(a: Any, b: Any) -> bool:
    if a is None or b is None:
        return a == b
    return datetime.fromisoformat(a).astimezone(UTC) == datetime.fromisoformat(b).astimezone(UTC)


async def check_updates(ctx: Ctx, course_id: str, refresh: bool = False) -> UpdatesOutput:
    link, _ = await service.require_link(ctx, course_id)
    refs = await _refs(ctx, link.id)
    if not link.sync_enabled or not refs:
        return UpdatesOutput(course_id=course_id, count=0, items=[])
    data, _ = await reads.raw_assignments(ctx, course_id, refresh)
    by_id = {a["external_id"]: a for a in data}
    weights = _weights(data)
    items: list[AssignmentUpdate] = []
    for ref in refs:
        a = by_id.get(ref.external_id)
        if a is None:
            continue
        now, then = snapshot(a, weights.get(ref.external_id)), ref.snapshot
        changes: dict[str, FieldUpdate] = {}
        if now["title"] != then.get("title"):
            changes["title"] = FieldUpdate(old=then.get("title"), new=now["title"])
        if not _same_time(now["due_at"], then.get("due_at")):
            changes["due_at"] = FieldUpdate(old=then.get("due_at"), new=now["due_at"])
        # Points only matter here through the weight they give (imports don't copy points), so
        # an unweighted course's point change is nothing the user could apply.
        if (
            now["points"] != then.get("points")
            and ref.target_kind == "assessment"
            and ref.external_id in weights
        ):
            changes["points"] = FieldUpdate(old=then.get("points"), new=now["points"])
        # Snapshots from before weights were recorded have no "weight" key: nothing to compare.
        if (
            ref.target_kind == "assessment"
            and "weight" in then
            and now["weight"] is not None
            and now["weight"] != then["weight"]
        ):
            changes["weight"] = FieldUpdate(old=then["weight"], new=now["weight"])
        if changes:
            items.append(
                AssignmentUpdate(
                    external_id=ref.external_id,
                    name=a["name"],
                    target=ImportTarget(kind=ref.target_kind, id=ref.target_id),  # pyright: ignore[reportArgumentType]
                    changes=changes,
                )
            )
    return UpdatesOutput(course_id=course_id, count=len(items), items=items)


async def _current_weight(ctx: Ctx, target: ImportTarget) -> float | None:
    """The assessment's weight now, so the review shows what a new weight replaces."""
    if target.kind != "assessment":
        return None
    row = await ctx.db.get(GradingAssessment, target.id)
    return row.weight if row is not None and row.user_id == ctx.user_id else None


async def review_updates(ctx: Ctx, course_id: str) -> ImportStarted:
    """An M08 session with one patch item per changed assignment; rejecting an item dismisses
    the change (its snapshot is updated either way on commit)."""
    link, b = await service.require_link(ctx, course_id)
    updates = await check_updates(ctx, course_id, refresh=True)
    if not updates.items:
        raise AppError("import.no_content", 422)
    data, _ = await reads.raw_assignments(ctx, course_id, refresh=False)
    by_id = {a["external_id"]: a for a in data}
    weights = _weights(data)
    program = await academics.get_program_row(ctx, link.program_id)
    tz = ZoneInfo(program.timezone)
    row = await _session(
        ctx,
        link.program_id,
        SessionTarget(kind="course", course_id=course_id),
        {
            "provider": b.row.provider,
            "connection_id": b.row.id,
            "lms": {"kind": "updates", "link_id": link.id},
        },
    )
    new: list[NewItem] = []
    by_key: dict[str, dict[str, Any]] = {}
    for update in updates.items:
        a = by_id[update.external_id]
        changes: dict[str, dict[str, Any]] = {}
        if "title" in update.changes:
            changes["title"] = {"old": update.changes["title"].old, "new": a["name"][:200]}
        if "due_at" in update.changes:
            old_date, old_time = _local(update.changes["due_at"].old, tz)
            new_date, new_time = _local(a.get("due_at"), tz)
            changes["due_date"] = {"old": old_date, "new": new_date}
            changes["due_time"] = {"old": old_time, "new": new_time}
        if (
            "points" in update.changes or "weight" in update.changes
        ) and update.external_id in weights:
            old = await _current_weight(ctx, update.target)
            if old != weights[update.external_id]:
                changes["weight"] = {"old": old, "new": weights[update.external_id]}
        key = f"u{len(new)}"
        target = update.target
        id_field = "assessment_id" if target.kind == "assessment" else "task_id"
        by_key[key] = {
            "external_id": update.external_id,
            "link_id": link.id,
            "snapshot": snapshot(a, weights.get(update.external_id)),
            "updated_at": a.get("updated_at"),
        }
        if not changes:  # points or weight moved but the assessment already has that weight
            by_key[key]["dismiss_only"] = True
        new.append(
            NewItem(
                key=key,
                type=f"{target.kind}_patch",  # pyright: ignore[reportArgumentType]
                data={id_field: target.id, "label": a["name"][:200], "changes": changes},
            )
        )
    refs = [
        {"lms_course_id": link.external_course_id, "filename": link.external_name, "status": "done"}
    ]
    return await _fill(ctx, row, new, refs, by_key)


# --- commit hook ----------------------------------------------------------------------------


def _parse_time(value: Any) -> datetime | None:
    return datetime.fromisoformat(value) if isinstance(value, str) and value else None


async def on_commit(ctx: Ctx, row: ImportsSession, created: dict[str, str]) -> None:
    """Runs in the M08 commit's transaction: links imported courses, records imported
    assignments, refreshes snapshots of reviewed updates (M09 §5)."""
    lms = row.source_meta.get("lms") or {}
    kind = lms.get("kind")
    meta: dict[str, dict[str, Any]] = lms.get("items") or {}
    if kind == "courses":
        connection = await service.get_connection_row(ctx, row.source_meta["connection_id"])
        binding = await service.binding_row(ctx, row.program_id)
        if binding is None or binding.connection_id != connection.id:
            # The Program moved to another connection since the session started: its courses
            # are still created, but links must use the Program's current connection.
            return
        for item_id, external in meta.items():
            course_id = created.get(item_id)
            if course_id is None:
                continue
            taken = await ctx.db.scalar(
                select(LmsCourseLink).where(
                    LmsCourseLink.program_id == row.program_id,
                    LmsCourseLink.connection_id == connection.id,
                    LmsCourseLink.external_course_id == external["external_id"],
                )
            )
            if taken is not None or await service.link_row(ctx, course_id) is not None:
                continue  # linked meanwhile: keep that link
            await service.create_link(
                ctx, course_id=course_id, connection=connection, external=external
            )
        return
    if kind not in ("assignments", "updates"):
        return
    items = {
        i.id: i
        for i in await ctx.db.scalars(select(ImportsItem).where(ImportsItem.session_id == row.id))
    }
    links: dict[str, LmsCourseLink] = {}
    for link_id in {info["link_id"] for info in meta.values()}:
        link = await ctx.db.get(LmsCourseLink, link_id)
        if link is None:
            # Unlinked or linked to another platform course since the session started (a
            # relink replaces the row): roll the whole commit back rather than write untracked
            # items or apply changes from the old course.
            raise lms_error("lms.course_not_linked")
        links[link_id] = link
    for item_id, info in meta.items():
        item = items.get(item_id)
        if item is None:
            continue
        link = links[info["link_id"]]
        if kind == "updates":
            # Accepted or rejected, the user has seen this version: stop reporting it.
            target_kind = item.type.removesuffix("_patch")
            target_id = item.data.get(f"{target_kind}_id")
            ref = await ctx.db.scalar(
                select(LmsImportedRef).where(
                    LmsImportedRef.link_id == link.id,
                    LmsImportedRef.external_kind == "assignment",
                    LmsImportedRef.external_id == info["external_id"],
                    LmsImportedRef.target_kind == target_kind,
                    LmsImportedRef.target_id == target_id,
                )
            )
            # A failed patch keeps the old snapshot, so the change is offered again.
            failed = bool(item.result and item.result.get("error_code"))
            if ref is not None and item.decision != "pending" and not failed:
                ref.snapshot = info["snapshot"]
                ref.external_updated_at = _parse_time(info.get("updated_at"))
            continue
        target_id = created.get(item_id)
        if target_id is None or item.type not in ("assessment", "task"):
            continue
        exists = await ctx.db.scalar(
            select(LmsImportedRef).where(
                LmsImportedRef.link_id == link.id,
                LmsImportedRef.external_kind == "assignment",
                LmsImportedRef.external_id == info["external_id"],
                LmsImportedRef.target_kind == item.type,
            )
        )
        if exists is not None:
            exists.target_id = target_id
            continue
        ctx.db.add(
            LmsImportedRef(
                user_id=row.user_id,
                link_id=link.id,
                external_kind="assignment",
                external_id=info["external_id"],
                target_kind=item.type,
                target_id=target_id,
                snapshot=info["snapshot"],
                external_updated_at=_parse_time(info.get("updated_at")),
                imported_at=ctx.now,
            )
        )
    await ctx.db.flush()


register_commit_hook("lms", on_commit)
