"""The assignments stage of the course sync (M09 §4.1), and the user's answers to what it asks.

Imported assignments follow the platform field by field (title, due date, weight, grade; a to-do
only title and due date), each field decided by `rules.merge` from its snapshot (the platform
value last applied), its Semestra value and the platform value now. Values the sync writes are
logged (`LmsSyncChange`, which the user can put back); the user answers what it asks field by
field (`answer`), and keeps or deletes an assignment gone from the platform (`resolve`).
Assignments not imported yet that are due later are kept as new items until the user imports or
ignores them.

All values are compared in the Program's time zone and kept in one form (`rules.platform_value`),
which is also what the change log and conflicts hold: a due date is `{date, time}` (time null for
a date only), a grade `{points_earned, points_possible}` or `{score_percentage}`, a weight a
number, a title a string.
"""

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.errors import not_found
from semestra.core.events import events
from semestra.modules.academics import service as academics
from semestra.modules.grading import service as grading
from semestra.modules.grading.models import GradingAssessment
from semestra.modules.imports import deps
from semestra.modules.lms import reads
from semestra.modules.lms import settings as lms_settings
from semestra.modules.lms.errors import lms_error
from semestra.modules.lms.imports import advance, snapshot, taken_in, weights_of
from semestra.modules.lms.models import LmsCourseLink, LmsImportedRef, LmsSyncChange
from semestra.modules.lms.rules import Action, diverged, merge, platform_value, same
from semestra.modules.lms.schemas.sync import SyncField
from semestra.modules.lms.service import Bound
from semestra.modules.lms.sync import UPDATED, Applied, StageResult, hold, register_sync_stage
from semestra.modules.tasks.models import TasksItem

KIND = "assignment"
FIELDS: dict[str, tuple[SyncField, ...]] = {
    "assessment": ("title", "due_at", "weight", "score"),
    "task": ("title", "due_at"),
}


# --- values ----------------------------------------------------------------------------------


def _assessment_values(row: GradingAssessment, tz: ZoneInfo) -> dict[str, Any]:
    due = None
    if row.due_at is not None:
        local = row.due_at.astimezone(tz)
        time = (
            local.time().replace(second=0, microsecond=0).isoformat() if row.due_has_time else None
        )
        due = {"date": local.date().isoformat(), "time": time}
    if row.points_earned is not None and row.points_possible is not None:
        score: dict[str, float] | None = {
            "points_earned": row.points_earned,
            "points_possible": row.points_possible,
        }
    elif row.score_percentage is not None:
        score = {"score_percentage": row.score_percentage}
    else:
        score = None
    return {"title": row.title, "due_at": due, "weight": row.weight, "score": score}


def _task_values(row: TasksItem) -> dict[str, Any]:
    due = None
    if row.due_date is not None:
        time = row.due_time.replace(second=0, microsecond=0).isoformat() if row.due_time else None
        due = {"date": row.due_date.isoformat(), "time": time}
    return {"title": row.title, "due_at": due}


async def local_values(
    ctx: Ctx, refs: list[LmsImportedRef], tz: ZoneInfo
) -> dict[str, dict[str, Any]]:
    """The Semestra values of each imported ref's object, by ref id (missing objects left out)."""
    assessments = await grading.find_assessment_rows(
        ctx, [r.target_id for r in refs if r.target_kind == "assessment" and r.target_id]
    )
    task_ids = [r.target_id for r in refs if r.target_kind == "task" and r.target_id]
    tasks = (
        {
            t.id: t
            for t in await ctx.db.scalars(
                select(TasksItem).where(
                    TasksItem.user_id == ctx.user_id, TasksItem.id.in_(task_ids)
                )
            )
        }
        if task_ids
        else {}
    )
    out: dict[str, dict[str, Any]] = {}
    for ref in refs:
        if ref.target_kind == "assessment" and ref.target_id in assessments:
            out[ref.id] = _assessment_values(assessments[ref.target_id], tz)
        elif ref.target_kind == "task" and ref.target_id in tasks:
            out[ref.id] = _task_values(tasks[ref.target_id])
    return out


def differences(
    ref: LmsImportedRef, local: dict[str, Any], tz: ZoneInfo
) -> list[tuple[SyncField, Any, Any]]:
    """The fields of an imported object that the user set apart from the platform and nobody is
    asked about: `(field, mine, platform)`, the platform value being the last one seen. A field
    the platform leaves empty (no due date, no grade yet, no weight) is the user's to fill in."""
    out: list[tuple[SyncField, Any, Any]] = []
    for name in FIELDS[ref.target_kind or "task"]:
        if name in ref.conflicts:
            continue
        raw = ref.snapshot.get(name)
        # Its base is the value as first taken (in the zone of then), so a change of the
        # Program's zone since is not taken for the user's own (the next sync follows that).
        base, p, mine = (
            platform_value(name, raw, taken_in(ref, tz)),
            platform_value(name, raw, tz),
            local.get(name),
        )
        if diverged(name, base, mine, p):
            out.append((name, mine, p))
    return out


def _args(name: str, value: Any) -> dict[str, Any]:
    """The update arguments that set one field to a value in the common form."""
    if name == "due_at":
        return {
            "due_date": value["date"] if value else None,
            "due_time": value["time"] if value else None,
        }
    if name == "score":
        if value is None:
            return {"points_earned": None, "points_possible": None, "score_percentage": None}
        return dict(value)
    return {name: value}


async def write(ctx: Ctx, ref: LmsImportedRef, name: str, value: Any) -> None:
    """Sets one field of the ref's object, through its module's capability."""
    kind = ref.target_kind
    capability = "grading.assessment.update" if kind == "assessment" else "tasks.item.update"
    await deps.call(ctx, capability, {f"{kind}_id": ref.target_id, **_args(name, value)})


# --- the stage -------------------------------------------------------------------------------


def _new(a: dict[str, Any], now: datetime) -> bool:
    """What is offered as new: due later (one past due or without a date is left to the user,
    who can still import it from the platform's list)."""
    due = a.get("due_at")
    return bool(due) and datetime.fromisoformat(due) > now


async def _log(ctx: Ctx, ref: LmsImportedRef, name: str, old: Any, new: Any, title: str) -> Applied:
    change = LmsSyncChange(
        user_id=ctx.user_id, ref_id=ref.id, field=name, old=old, new=new, at=ctx.now
    )
    ctx.db.add(change)
    await ctx.db.flush()
    return Applied(change_id=change.id, name=title, field=name)


async def _follow(
    ctx: Ctx,
    ref: LmsImportedRef,
    platform: dict[str, Any],
    local: dict[str, Any],
    tz: ZoneInfo,
    title: str,
    follow: frozenset[str],
) -> list[Applied]:
    """Brings one imported object's fields up to the platform, as `rules.merge` decides.
    `follow` holds the fields whose automatic update is on."""
    applied: list[Applied] = []
    snap, conflicts = dict(ref.snapshot), dict(ref.conflicts)
    for name in FIELDS[ref.target_kind or "task"]:
        if name not in platform:
            continue
        p = platform_value(name, platform[name], tz)
        s = platform_value(name, snap.get(name), taken_in(ref, tz))
        mine = local.get(name)
        match merge(name, s, mine, p, name in follow):
            case Action.CLEAR:
                # Nothing to follow, and nothing left to offer of what the platform had before.
                snap[name] = None
                conflicts.pop(name, None)
            case Action.AGREE:
                advance(snap, ref.target_kind, name, platform[name], tz)
                conflicts.pop(name, None)
            case Action.KEEP:
                # A question about a platform value since taken back has nothing left to ask.
                conflicts.pop(name, None)
            case Action.CONFLICT | Action.ASK as action:
                edited = action is Action.CONFLICT
                conflicts[name] = {"value": p, "raw": platform[name], "edited": edited}
            case Action.APPLY:
                await write(ctx, ref, name, p)
                applied.append(await _log(ctx, ref, name, mine, p, title))
                advance(snap, ref.target_kind, name, platform[name], tz)
                conflicts.pop(name, None)
    if snap != ref.snapshot:
        ref.snapshot = snap
    if conflicts != ref.conflicts:
        ref.conflicts = conflicts
    return applied


async def run(ctx: Ctx, link: LmsCourseLink, b: Bound) -> StageResult:
    data, truncated = await reads.raw_assignments(ctx, link.course_id, True, linked=(link, b))
    await hold(ctx, link)
    by_id = {str(a["external_id"]): a for a in data}
    weights = weights_of(data)
    program = await academics.get_program_row(ctx, link.program_id)
    tz = ZoneInfo(program.timezone)
    refs = list(
        await ctx.db.scalars(
            select(LmsImportedRef).where(
                LmsImportedRef.link_id == link.id, LmsImportedRef.external_kind == KIND
            )
        )
    )
    imported = [r for r in refs if r.target_id is not None]
    follow = lms_settings.followed(await lms_settings.account(ctx))
    local = await local_values(ctx, imported, tz)
    result = StageResult()
    for ref in refs:
        a = by_id.get(ref.external_id)
        if ref.target_id is None:
            if a is None and truncated:
                pass  # a cut-off list says nothing about what is missing from it
            elif a is None or (ref.dismissed_at is None and not _new(a, ctx.now)):
                await ctx.db.delete(ref)  # gone, or no longer new: nothing to offer
                continue
            else:
                ref.snapshot = snapshot(a, weights.get(ref.external_id))
            result.pending += ref.dismissed_at is None
            continue
        if a is None:
            if not truncated and ref.removed_at is None:
                ref.removed_at = ctx.now
            result.pending += ref.removed_at is not None
            continue
        ref.removed_at = None
        if ref.id not in local:
            continue  # its object is being deleted
        platform = snapshot(a, weights.get(ref.external_id))
        if ref.target_kind != "assessment":
            platform.pop("score", None)
        result.applied += await _follow(
            ctx, ref, platform, local[ref.id], tz, str(a["name"]), follow
        )
        result.pending += len(ref.conflicts)
    known = {r.external_id for r in refs}
    for external_id, a in by_id.items():
        if external_id not in known and _new(a, ctx.now):
            ctx.db.add(
                LmsImportedRef(
                    user_id=ctx.user_id,
                    link_id=link.id,
                    external_kind=KIND,
                    external_id=external_id,
                    snapshot=snapshot(a, weights.get(external_id)),
                )
            )
            result.pending += 1
    await ctx.db.flush()
    if result.applied:
        await events.publish(ctx, "lms.course.imports_recorded", {"course_id": link.course_id})
    return result


async def _enabled(ctx: Ctx, link: LmsCourseLink, b: Bound) -> bool:
    del ctx, link
    return "assignments" in b.provider.features


register_sync_stage("assignments", run, order=20, enabled=_enabled)


# --- the user's answers ----------------------------------------------------------------------


async def _ref(ctx: Ctx, ref_id: str) -> tuple[LmsImportedRef, LmsCourseLink]:
    """The item an answer is about, read again once the write lock is held (`hold`), so a sync
    of the course committing meanwhile is seen rather than written over."""
    ref = await ctx.db.get(LmsImportedRef, ref_id)
    if ref is None or ref.user_id != ctx.user_id:
        raise not_found("lms_item", ref_id)
    link = await ctx.db.get(LmsCourseLink, ref.link_id)
    assert link is not None
    await hold(ctx, link)
    ref = await ctx.db.get(LmsImportedRef, ref_id, populate_existing=True)
    if ref is None:
        raise not_found("lms_item", ref_id)
    return ref, link


async def _changed(ctx: Ctx, link: LmsCourseLink) -> None:
    await events.publish(ctx, UPDATED, {"program_id": link.program_id})
    await events.publish(ctx, "lms.course.imports_recorded", {"course_id": link.course_id})


async def resolve(ctx: Ctx, ref_id: str, choice: str) -> str:
    """Settles an imported item gone from the platform: `delete` deletes its object, `keep`
    keeps it as made by hand."""
    ref, link = await _ref(ctx, ref_id)
    if ref.target_id is None or ref.removed_at is None or choice not in ("delete", "keep"):
        raise lms_error("lms.sync_nothing_to_resolve")
    if choice == "delete":
        kind = ref.target_kind
        name = "grading.assessment.delete" if kind == "assessment" else "tasks.item.delete"
        await ctx.db.delete(ref)
        await ctx.db.flush()
        await deps.call(ctx, name, {f"{kind}_id": ref.target_id})
    else:
        if ref.target_kind == "assessment":
            await grading.set_source(ctx, ref.target_id, None)
        await ctx.db.delete(ref)
    await ctx.db.flush()
    await _changed(ctx, link)
    return link.program_id


async def answer(ctx: Ctx, ref_id: str, name: str, choice: str) -> str:
    """Answers about one field of an imported item. Asked about (a conflict): `platform` takes
    the platform's value, `mine` keeps the user's (the platform's next change asks again). Set
    apart from the platform (`differences`): `platform` takes the platform's value back.
    A value taken from the platform is logged like a sync change, so it can be put back."""
    ref, link = await _ref(ctx, ref_id)
    if ref.target_id is None or ref.removed_at is not None:
        raise lms_error("lms.sync_nothing_to_resolve")
    program = await academics.get_program_row(ctx, link.program_id)
    tz = ZoneInfo(program.timezone)
    local = (await local_values(ctx, [ref], tz)).get(ref.id)
    if local is None:
        raise lms_error("lms.sync_nothing_to_resolve")
    title = str(ref.snapshot.get("title") or "")
    conflict = ref.conflicts.get(name)
    if conflict is not None:
        if choice == "platform":
            await write(ctx, ref, name, conflict["value"])
            await _log(ctx, ref, name, local.get(name), conflict["value"], title)
        snap = dict(ref.snapshot)
        advance(snap, ref.target_kind, name, conflict["raw"], tz)
        ref.snapshot = snap
        ref.conflicts = {f: c for f, c in ref.conflicts.items() if f != name}
    else:
        found = {f: (mine, p) for f, mine, p in differences(ref, local, tz)}
        if choice != "platform" or name not in found:
            raise lms_error("lms.sync_nothing_to_resolve")
        mine, p = found[name]
        await write(ctx, ref, name, p)
        await _log(ctx, ref, name, mine, p, title)
    await ctx.db.flush()
    await _changed(ctx, link)
    return link.program_id


async def toggleable(ctx: Ctx, changes: list[tuple[LmsSyncChange, LmsImportedRef]]) -> set[str]:
    """The changes that can still be put back, or applied again once put back: the newest of
    their field, no question open about the field, and the field still holding what the change
    (or putting it back) left there, so no later sync or edit is overwritten."""
    newest: dict[tuple[str, str], LmsSyncChange] = {}
    for change, _ in changes:
        key = (change.ref_id, change.field)
        if key not in newest or change.at > newest[key].at:
            newest[key] = change
    refs = {ref.id: ref for _, ref in changes if ref.target_id is not None}
    if not refs:
        return set()
    link_ids = {ref.link_id for ref in refs.values()}
    links = list(await ctx.db.scalars(select(LmsCourseLink).where(LmsCourseLink.id.in_(link_ids))))
    programs = {li.id: await academics.get_program_row(ctx, li.program_id) for li in links}
    local: dict[str, dict[str, Any]] = {}
    for link_id, program in programs.items():
        tz = ZoneInfo(program.timezone)
        mine = [r for r in refs.values() if r.link_id == link_id]
        local.update(await local_values(ctx, mine, tz))
    return {
        change.id
        for change in newest.values()
        if change.ref_id in local
        and change.field not in refs[change.ref_id].conflicts
        and same(
            change.field,
            local[change.ref_id].get(change.field),
            change.old if change.reverted_at is not None else change.new,
        )
    }


async def revert(ctx: Ctx, change_id: str, *, undone: bool = True) -> str:
    """Puts back what the sync changed (`undone`), or applies it again. Put back, the field
    counts as the user's own: the platform's next change to it asks instead of replacing it.
    Only the newest change of a field, while the field still holds what the last step left."""
    change = await ctx.db.get(LmsSyncChange, change_id)
    if change is None or change.user_id != ctx.user_id:
        raise not_found("lms_change", change_id)
    ref, link = await _ref(ctx, change.ref_id)
    change = await ctx.db.get(LmsSyncChange, change_id, populate_existing=True)
    if change is None:
        raise not_found("lms_change", change_id)
    if (change.reverted_at is not None) == undone:
        return link.program_id
    if ref.target_id is None:
        raise lms_error("lms.sync_nothing_to_resolve")
    later = await ctx.db.scalar(
        select(LmsSyncChange.id).where(
            LmsSyncChange.ref_id == ref.id,
            LmsSyncChange.field == change.field,
            LmsSyncChange.at > change.at,
        )
    )
    if later is not None or change.id not in await toggleable(ctx, [(change, ref)]):
        raise lms_error("lms.sync_change_outdated")
    await write(ctx, ref, change.field, change.old if undone else change.new)
    change.reverted_at = ctx.now if undone else None
    await ctx.db.flush()
    await _changed(ctx, link)
    return link.program_id


async def dismiss(ctx: Ctx, program_id: str, ref_ids: list[str], dismissed: bool) -> None:
    """Ignores new items (no longer offered, still listed as ignored), or offers them again."""
    changed = False
    for ref_id in ref_ids:
        ref, link = await _ref(ctx, ref_id)
        if ref.target_id is not None or link.program_id != program_id:
            continue  # imported meanwhile, or another Program's
        ref.dismissed_at = ctx.now if dismissed else None
        changed = True
    if changed:
        await ctx.db.flush()
        await events.publish(ctx, UPDATED, {"program_id": program_id})
