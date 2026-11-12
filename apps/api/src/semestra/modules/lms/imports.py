"""Imports from the LMS through M08 (M09 §4, §5): courses, assignments, syllabus and updates.

Everything goes through an M08 session; nothing is written before its commit, and every import
waits for the user's review (destination category, weight and type can be changed there). What
the commit needs to know about the LMS (which external course a course item is, which assignment
an assessment came from) is kept in the session's
`source_meta.lms.items`, keyed by item id. The commit hook writes course links and imported refs
in the commit's transaction.
"""

import re
from collections import Counter
from collections.abc import Callable, Collection
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.errors import AppError, not_found
from semestra.core.events import events
from semestra.modules.academics import service as academics
from semestra.modules.grading import service as grading
from semestra.modules.grading.models import GradingAssessment
from semestra.modules.imports import build, register_commit_hook
from semestra.modules.imports import service as imports
from semestra.modules.imports.models import ImportsSession
from semestra.modules.imports.schemas import Confidence, NewItem, SessionCreateInput, SessionTarget
from semestra.modules.lms import html, reads, service
from semestra.modules.lms.errors import lms_error
from semestra.modules.lms.models import LmsCourseLink, LmsImportedRef
from semestra.modules.lms.schemas.io import (
    AssessmentRef,
    AssignmentBinding,
    AssignmentBindInput,
    AssignmentsImportInput,
    CoursesImportInput,
    ExternalCourse,
    ImportStarted,
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


async def _session(
    ctx: Ctx, program_id: str, target: SessionTarget, meta: dict[str, Any]
) -> ImportsSession:
    detail = await imports.create_session(
        ctx,
        SessionCreateInput(program_id=program_id, source_kind="lms", target=target),
        module_meta=meta,
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
    ids = {n.key: item.id for item, n in zip(items, new, strict=True) if n.key}
    meta = dict(row.source_meta)
    lms = dict(meta.get("lms", {}))
    # Added to what a resumed session already holds.
    lms["items"] = {**lms.get("items", {}), **{ids[k]: v for k, v in by_key.items() if k in ids}}
    if "groups" in lms:  # Canvas group id -> its category item, for the next resume
        lms["groups"] = {g: ids.get(ref, ref) for g, ref in lms["groups"].items()}
    meta["lms"] = lms
    row.source_meta = meta
    row.source_refs = [*row.source_refs, *refs][:50]
    await ctx.db.flush()
    return ImportStarted(session_id=row.id, program_id=row.program_id, count=len(items))


async def _unfinished(ctx: Ctx, link_id: str, course_id: str) -> ImportsSession | None:
    """The course's assignment import still waiting for review: importing again resumes it
    (M08 §6.2), so an import the user closed is never left behind next to a new one."""
    rows = await ctx.db.scalars(
        select(ImportsSession)
        .where(
            ImportsSession.user_id == ctx.user_id,
            ImportsSession.source_kind == "lms",
            ImportsSession.status == "ready",
        )
        .order_by(ImportsSession.created_at.desc())
    )
    for row in rows:
        lms = row.source_meta.get("lms") or {}
        if (
            lms.get("kind") == "assignments"
            and lms.get("link_id") == link_id
            and row.target.get("course_id") == course_id
        ):
            return row
    return None


# --- courses --------------------------------------------------------------------------------


def new_courses(listed: dict[str, ExternalCourse], external_ids: list[str]) -> list[ExternalCourse]:
    """The requested courses an import creates: still on the LMS, not yet a course of this
    Program. The assistant's card counts the same ones."""
    out: list[ExternalCourse] = []
    for external_id in dict.fromkeys(external_ids):
        course = listed.get(external_id)
        if course is not None and course.linked_course_id is None:
            out.append(course)
    return out


async def import_courses(ctx: Ctx, inp: CoursesImportInput) -> ImportStarted:
    await academics.get_program_row(ctx, inp.program_id)
    if inp.term_wizard and ctx.delegated:
        # The app's wizard creates the term afterwards; an assistant creates it first.
        raise AppError(
            "common.validation", 422, errors=[{"loc": ["term_wizard"], "code": "wizard_only"}]
        )
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
    for course in new_courses(wanted, inp.external_course_ids):
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


def weights_of(assignments: list[dict[str, Any]]) -> dict[str, float]:
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


def worth_points(a: dict[str, Any]) -> bool:
    """An assignment worth points goes into the gradebook; one worth none is only a to-do."""
    return bool(a.get("points")) and float(a["points"]) > 0


def new_assignments(
    listed: dict[str, dict[str, Any]], external_ids: list[str], done: Collection[str]
) -> list[dict[str, Any]]:
    """The requested assignments an import creates: still on the LMS and not imported before
    (M09 §11: importing twice creates one). The assistant's card counts the same ones."""
    return [listed[i] for i in dict.fromkeys(external_ids) if i in listed and i not in done]


def to_gradebook(
    listed: dict[str, dict[str, Any]], external_ids: list[str], done: dict[str, dict[str, str]]
) -> list[dict[str, Any]]:
    """The requested assignments "Add to gradebook" moves: still on the LMS and imported as a
    to-do only."""
    return [
        listed[i]
        for i in dict.fromkeys(external_ids)
        if i in listed and done.get(i, {}).get("kind") == "task"
    ]


async def import_assignments(ctx: Ctx, inp: AssignmentsImportInput) -> ImportStarted:
    """The one import of assignments (M09 §4): those worth points become assessments (each with
    its to-do, M05), the others to-dos. The user reviews it before anything is written."""
    return await _import(ctx, inp.course_id, inp.external_ids, gradebook=False)


async def add_to_gradebook(ctx: Ctx, inp: AssignmentsImportInput) -> ImportStarted:
    """Assignments imported as to-dos go into the gradebook: an assessment each, which takes the
    to-do over (M05), and the import record moves to it."""
    return await _import(ctx, inp.course_id, inp.external_ids, gradebook=True)


async def _import(
    ctx: Ctx, course_id: str, external_ids: list[str], *, gradebook: bool
) -> ImportStarted:
    link, b = await service.require_link(ctx, course_id)
    service.require_feature(b, "assignments")
    data, _ = await reads.raw_assignments(ctx, course_id, refresh=True)
    by_id = {a["external_id"]: a for a in data}
    done = await reads.imported_targets(ctx, link.id)
    picked = (
        [(a, "assessment") for a in to_gradebook(by_id, external_ids, done)]
        if gradebook
        else [
            (a, "assessment" if worth_points(a) else "task")
            for a in new_assignments(by_id, external_ids, done)
        ]
    )
    if not picked:
        raise AppError("import.no_content", 422)
    row = await _unfinished(ctx, link.id, course_id)
    if row is not None:
        lms = row.source_meta.get("lms") or {}
        have = {str(v["external_id"]) for v in (lms.get("items") or {}).values()}
        picked = [(a, kind) for a, kind in picked if str(a["external_id"]) not in have]
        if not picked:  # nothing new: back to its review
            return ImportStarted(session_id=row.id, program_id=row.program_id, count=0)
    else:
        row = await _session(
            ctx,
            link.program_id,
            SessionTarget(kind="course", course_id=course_id),
            {
                "provider": b.row.provider,
                "connection_id": b.row.id,
                "lms": {"kind": "assignments", "link_id": link.id, "groups": {}},
            },
        )
    program = await academics.get_program_row(ctx, link.program_id)
    tz = ZoneInfo(program.timezone)
    weights = weights_of(data)
    course_ref = f"course:{course_id}"
    new: list[NewItem] = []
    refs: list[dict[str, Any]] = []
    by_key: dict[str, dict[str, Any]] = {}
    # Canvas group id -> its category: an item key here, or the id of one a resumed session has.
    groups: dict[str, str] = dict((row.source_meta.get("lms") or {}).get("groups") or {})
    category_of = await _group_categories(ctx, link.program_id, course_id, data, done)
    for a, kind in picked:
        external_id = str(a["external_id"])
        due_date, due_time = _local(a.get("due_at"), tz)
        ref = source_ref(b.row.id, external_id)
        note = a.get("web_url")
        key = f"a{len(new)}"
        if kind == "assessment":
            item: dict[str, Any] = {"course_ref": course_ref, "title": a["name"][:200]}
            group = a.get("group_name")
            if group:
                # Canvas groups are told apart by id: two groups may share a name or a slug.
                group_key = str(a.get("group_id") or group)
                if group_key not in groups:
                    groups[group_key] = f"g{len(new)}"
                    # An existing category's key goes into it; none creates one (M08 §2).
                    into = category_of(group_key, group)
                    new.append(
                        NewItem(
                            key=groups[group_key],
                            type="category",
                            data={
                                "course_ref": course_ref,
                                "name": group[:200],
                                **({"key": into} if into else {}),
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
            # A grade already on the platform comes along, so it needs no second review.
            item.update(platform_score(a) or {})
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
        }
        refs.append(
            {"lms_course_id": link.external_course_id, "filename": a["name"], "status": "done"}
        )
    lms = dict(row.source_meta.get("lms") or {})
    row.source_meta = {**row.source_meta, "lms": {**lms, "groups": groups}}
    return await _fill(ctx, row, new, refs[:50], by_key)


async def _group_categories(
    ctx: Ctx,
    program_id: str,
    course_id: str,
    data: list[dict[str, Any]],
    done: dict[str, dict[str, str]],
) -> Callable[[str, str], str | None]:
    """Which course category each assignment group goes into (`build.match_category`): where
    its assignments imported before are now, else by its name or what its assignments are."""
    categories = await grading.course_categories(ctx, program_id, course_id)
    members: dict[str, list[dict[str, Any]]] = {}
    for a in data:
        if a.get("group_name"):
            members.setdefault(str(a.get("group_id") or a["group_name"]), []).append(a)
    earlier = await grading.category_keys(
        ctx, [t["id"] for t in done.values() if t["kind"] == "assessment"]
    )

    def category_of(group_key: str, name: str) -> str | None:
        group = members.get(group_key, [])
        placed = Counter(
            earlier[t["id"]]
            for a in group
            if (t := done.get(str(a["external_id"]))) and t["id"] in earlier
        )
        return build.match_category(
            name,
            categories,
            previous=placed.most_common(1)[0][0] if placed else None,
            contents=[(str(a.get("name") or ""), a.get("raw_kind") == "quiz") for a in group],
        )

    return category_of


def snapshot(a: dict[str, Any], weight: float | None = None) -> dict[str, Any]:
    """What the sync compares (M09 §4.1). The weight is the effective one from the
    assignment's group, so a group weight or sibling change shows up as an update too. The
    score is the grade on the platform, so a new or changed grade is offered once."""
    return {
        "title": a.get("name"),
        "due_at": a.get("due_at"),
        "points": a.get("points"),
        "weight": weight,
        "score": platform_score(a),
    }


def bound_snapshot(platform: dict[str, Any]) -> dict[str, Any]:
    """The import record of an assignment bound to an assessment made by hand: binding itself
    changes nothing. Due date, weight and grade count as never set from the platform, so the
    sync fills in what the assessment lacks and asks where both have a value that differs; the
    title stays the platform's, so a name the user chose is kept until the platform renames it."""
    return {**platform, "due_at": None, "weight": None, "score": None}


def platform_score(a: dict[str, Any]) -> dict[str, float] | None:
    """The user's graded score on the platform as points, or None while there is none (not
    graded, not posted, or an assignment worth no points)."""
    submission = a.get("submission") or {}
    score, points = submission.get("score"), a.get("points")
    if score is None or not points or points <= 0 or score < 0:
        return None
    return {"points_earned": float(score), "points_possible": float(points)}


# --- binding --------------------------------------------------------------------------------


async def _assessment(ctx: Ctx, assessment_id: str) -> GradingAssessment:
    row = (await grading.find_assessment_rows(ctx, [assessment_id])).get(assessment_id)
    if row is None:
        raise not_found("assessment", assessment_id)
    return row


async def _item_ref(ctx: Ctx, link_id: str, external_id: str) -> LmsImportedRef | None:
    return await ctx.db.scalar(
        select(LmsImportedRef).where(
            LmsImportedRef.link_id == link_id,
            LmsImportedRef.external_kind == "assignment",
            LmsImportedRef.external_id == external_id,
        )
    )


def _track(
    ref: LmsImportedRef, kind: str, target_id: str, snap: dict[str, Any], now: datetime
) -> None:
    """The ref now follows this object: whatever it was waiting for (new, ignored, a conflict
    of an earlier object) is over."""
    ref.target_kind, ref.target_id, ref.snapshot = kind, target_id, snap
    ref.imported_at = now
    ref.dismissed_at = ref.removed_at = None
    ref.conflicts = {}


async def _ref_of(ctx: Ctx, assessment_id: str) -> LmsImportedRef | None:
    return await ctx.db.scalar(
        select(LmsImportedRef).where(
            LmsImportedRef.user_id == ctx.user_id,
            LmsImportedRef.external_kind == "assignment",
            LmsImportedRef.target_kind == "assessment",
            LmsImportedRef.target_id == assessment_id,
        )
    )


async def bind_assignment(ctx: Ctx, inp: AssignmentBindInput) -> AssignmentBinding:
    """Binds an assessment made by hand to an assignment of its course not imported yet (M09 §4):
    it becomes that assignment's one Semestra object, as if imported, and follows it from then
    on. Binding changes nothing of the assessment; the next sync fills in what it lacks and asks
    where its due date, weight or grade differs from the platform's (`bound_snapshot`)."""
    row = await _assessment(ctx, inp.assessment_id)
    link, b = await service.require_link(ctx, row.course_id)
    service.require_feature(b, "assignments")
    if row.source_kind == "lms":
        raise lms_error("lms.assessment_already_bound")
    data, _ = await reads.raw_assignments(ctx, row.course_id, refresh=True)
    a = next((x for x in data if str(x["external_id"]) == inp.assignment_id), None)
    if a is None:
        raise lms_error("lms.not_found")
    if inp.assignment_id in await reads.imported_targets(ctx, link.id):
        raise lms_error("lms.assignment_already_imported", title=a["name"])
    await grading.set_source(ctx, row.id, ("lms", source_ref(b.row.id, inp.assignment_id)))
    snap = bound_snapshot(snapshot(a, weights_of(data).get(inp.assignment_id)))
    ref = await _item_ref(ctx, link.id, inp.assignment_id)  # offered as new until now
    if ref is None:
        ref = LmsImportedRef(
            user_id=ctx.user_id,
            link_id=link.id,
            external_kind="assignment",
            external_id=inp.assignment_id,
        )
        ctx.db.add(ref)
    _track(ref, "assessment", row.id, snap, ctx.now)
    await ctx.db.flush()
    await events.publish(ctx, "lms.course.imports_recorded", {"course_id": row.course_id})
    return AssignmentBinding(
        assessment_id=row.id, course_id=row.course_id, assignment_id=inp.assignment_id
    )


async def unbind_assignment(ctx: Ctx, inp: AssessmentRef) -> AssignmentBinding:
    """The assessment stops following its platform assignment, imported or bound: it stays as it
    is, as one made by hand, and the assignment can be imported or bound again."""
    row = await _assessment(ctx, inp.assessment_id)
    ref = await _ref_of(ctx, row.id)
    if ref is None and row.source_kind != "lms":
        raise lms_error("lms.assessment_not_bound")
    if ref is not None:
        await ctx.db.delete(ref)
    # Also when the course was unlinked meanwhile (its import records went with the link).
    await grading.set_source(ctx, row.id, None)
    await ctx.db.flush()
    await events.publish(ctx, "lms.course.imports_recorded", {"course_id": row.course_id})
    return AssignmentBinding(assessment_id=row.id, course_id=row.course_id, assignment_id=None)


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
        ),
        module_meta={
            "provider": b.row.provider,
            "connection_id": b.row.id,
            "lms": {"kind": "syllabus"},
        },
    )
    return ImportStarted(session_id=detail.id, program_id=link.program_id, count=0)


# --- commit hook ----------------------------------------------------------------------------


async def on_commit(ctx: Ctx, row: ImportsSession, created: dict[str, str]) -> None:
    """Runs in the M08 commit's transaction: links imported courses and records imported
    assignments (M09 §5)."""
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
            if taken is not None and taken.course_id != course_id:
                # Another session linked this platform course meanwhile: the course just
                # created would be a duplicate, so roll the commit back.
                raise lms_error("lms.course_already_linked")
            if taken is not None or await service.link_row(ctx, course_id) is not None:
                continue  # an existing course that is linked already: keep that link
            await service.create_link(
                ctx, course_id=course_id, connection=connection, external=external
            )
        return
    if kind != "assignments":
        return
    items = {i.id: i for i in await imports.session_items(ctx, row.id)}
    bound = {
        str(i.data["existing_assessment_id"])
        for i in items.values()
        if i.type == "assessment" and i.data.get("existing_assessment_id")
    }
    links: dict[str, LmsCourseLink] = {}
    for link_id in {info["link_id"] for info in meta.values()}:
        link = await ctx.db.get(LmsCourseLink, link_id)
        if link is None or link.user_id != ctx.user_id:
            # Unlinked or linked to another platform course since the session started (a
            # relink replaces the row): roll the whole commit back rather than write untracked
            # items.
            raise lms_error("lms.course_not_linked")
        links[link_id] = link
    for item_id, info in meta.items():
        item = items.get(item_id)
        if item is None:
            continue
        link = links[info["link_id"]]
        target_id = created.get(item_id)
        if target_id is None or item.type not in ("assessment", "task"):
            continue
        # What the sync compares later: a to-do has no grade to follow (an item may have been
        # switched in the review).
        snap = {**info["snapshot"], **({} if item.type == "assessment" else {"score": None})}
        if str(item.data.get("existing_assessment_id")) in bound:
            snap = bound_snapshot(info["snapshot"])
        ref = await _item_ref(ctx, link.id, info["external_id"])
        if ref is None:
            ref = LmsImportedRef(
                user_id=row.user_id,
                link_id=link.id,
                external_kind="assignment",
                external_id=info["external_id"],
            )
            ctx.db.add(ref)
        elif ref.target_kind == "assessment" and item.type == "task":
            # Another session put it into the gradebook meanwhile: roll this commit back.
            raise lms_error("lms.assignment_already_imported", title=item.data.get("title", ""))
        elif ref.target_kind == item.type:
            ref.target_id = target_id  # imported again meanwhile: the same object
            continue
        # New, ignored before, or added to the gradebook (the assessment took the to-do over,
        # M05, and is now the one Semestra object of this assignment).
        _track(ref, item.type, target_id, snap, ctx.now)
    await ctx.db.flush()
    # What each course reports as new or imported has changed.
    for link in links.values():
        await events.publish(ctx, "lms.course.imports_recorded", {"course_id": link.course_id})


register_commit_hook("lms", on_commit)
