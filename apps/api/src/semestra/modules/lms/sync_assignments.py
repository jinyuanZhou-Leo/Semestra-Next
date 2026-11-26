"""The assignments stage of the course sync (M09 §4.4, §4.5), and the user's answers to what it
asks.

The stage keeps the mirror (`LmsAssignment`): every assignment of the course with the user's
submission and the teacher's feedback, read once per round (`assignment_facts`). A row is written
only when its facts change; one gone from the platform (table 3c) goes, except an imported one
waiting for the user's answer. New feedback on an imported assignment is a recent update; the
to-dos of assignments handed in for the first time are finished (`submissions.complete`).

Imported assignments follow the platform field by field (title, due date, weight, grade; a to-do
only title and due date), each field decided by `rules.merge` from its snapshot (the platform
value last applied), its Semestra value and the platform value now. Values the sync writes are
logged (`LmsSyncChange`, which the user can put back); the user answers what it asks field by
field (`answer`), and keeps or deletes an assignment gone from the platform (`resolve`).
New assignments are worked out from the mirror (`rules.is_new`), not kept; the ones the user
ignored have a ref (table 4b, `assignment_refs`).

All values are compared in the Program's time zone and kept in one form (`rules.platform_value`),
which is also what the change log and conflicts hold: a due date is `{date, time}` (time null for
a date only), a grade `{points_earned, points_possible}` or `{score_percentage}`, a weight a
number, a title a string.
"""

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
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
from semestra.modules.lms import assignment_facts as facts
from semestra.modules.lms import assignment_refs, service, submissions
from semestra.modules.lms import settings as lms_settings
from semestra.modules.lms.assignment_facts import Facts, Side, Source, facts_of
from semestra.modules.lms.errors import lms_error
from semestra.modules.lms.fit import OUT, OUT_OF_RANGE, set_out
from semestra.modules.lms.imports import advance, snapshot, taken_in, weights_of
from semestra.modules.lms.models import (
    LmsAssignment,
    LmsCourseLink,
    LmsImportedRef,
    LmsSyncChange,
)
from semestra.modules.lms.providers import Call
from semestra.modules.lms.rules import (
    Action,
    Presence,
    base_value,
    diverged,
    is_new,
    merge,
    platform_value,
    same,
)
from semestra.modules.lms.schemas.sync import SyncField
from semestra.modules.lms.service import Bound
from semestra.modules.lms.settings import completes_submitted
from semestra.modules.lms.sync import (
    ASSIGNMENTS_UPDATED,
    UPDATED,
    Applied,
    Shared,
    StageResult,
    hold,
    one_item,
    register_sync_stage,
)
from semestra.modules.lms.sync_round import Asked, SyncRound, one_by_one
from semestra.modules.tasks.models import TasksItem

FIELDS: dict[str, tuple[SyncField, ...]] = {
    "assessment": ("title", "due_at", "weight", "score", "dropped"),
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
    return {
        "title": row.title,
        "due_at": due,
        "weight": row.weight,
        "score": score,
        "dropped": row.dropped,
    }


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


@dataclass(frozen=True)
class Difference:
    """A field of an imported object set apart from the platform (`differences`)."""

    field: SyncField
    mine: Any
    platform: Any
    # The platform's value is out of what the object takes (M09 表 5c): it can't be taken.
    out_of_range: bool = False


def differences(ref: LmsImportedRef, local: dict[str, Any], tz: ZoneInfo) -> list[Difference]:
    """The fields of an imported object that the user set apart from the platform and nobody is
    asked about, the platform value being the last one seen. A field the platform leaves empty
    (no due date, no grade yet, no weight) is the user's to fill in. One whose platform value is
    out of the object's range is always listed, with the platform's own value."""
    out: list[Difference] = []
    kind = ref.target_kind
    for name in FIELDS[kind or "task"]:
        if name in ref.conflicts:
            continue
        raw, mine = ref.snapshot.get(name), local.get(name)
        out_of_range = ref.snapshot.get(OUT_OF_RANGE) or {}
        if name in out_of_range:
            out.append(Difference(name, mine, out_of_range[name], out_of_range=True))
            continue
        p = platform_value(name, raw, tz, kind)
        # Its base is the value as first taken (in the zone of then), so a change of the
        # Program's zone since is not taken for the user's own (the next sync follows that).
        base = base_value(name, raw, taken_in(ref, tz), kind)
        if diverged(name, base, mine, p):
            out.append(Difference(name, mine, p))
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


async def _log(ctx: Ctx, ref: LmsImportedRef, name: str, old: Any, new: Any, title: str) -> Applied:
    change = LmsSyncChange(
        user_id=ctx.user_id, ref_id=ref.id, field=name, old=old, new=new, at=ctx.now
    )
    ctx.db.add(change)
    await ctx.db.flush()
    return Applied(
        change_id=change.id, ref_id=ref.id, name=title, field=name, external_id=ref.external_id
    )


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
        p = platform_value(name, platform[name], tz, ref.target_kind)
        if p is OUT:
            # Out of what the object takes (M09 表 5c): not written, not followed, not asked
            # about; the field's snapshot keeps what the object last took, and the panel lists
            # the platform's value as set apart.
            set_out(snap, name, platform[name])
            conflicts.pop(name, None)
            continue
        set_out(snap, name, None)
        s = base_value(name, snap.get(name), taken_in(ref, tz), ref.target_kind)
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


def _theirs(comments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The comments that are feedback: not the user's own."""
    return [c for c in comments if not c.get("own")]


def _comment_key(comment: dict[str, Any]) -> tuple[Any, ...]:
    return (
        (comment.get("id"),)
        if comment.get("id")
        else (comment.get("created_at"), comment.get("comment"))
    )


def news(before: dict[str, Any] | None, after: dict[str, Any] | None) -> dict[str, Any] | None:
    """What is new in the teacher's feedback (M09 §4.5): someone else's comments not there
    before, a rubric assessed for the first time. None when nothing is, or when the submission
    is read for the first time (what it already had is not news)."""
    if before is None or after is None:
        return None
    seen = {_comment_key(c) for c in before.get("comments") or []}
    comments = sum(1 for c in _theirs(after.get("comments") or []) if _comment_key(c) not in seen)
    rubric = bool(after.get("rubric_scores")) and not before.get("rubric_scores")
    return {"comments": comments, "rubric": rubric} if comments or rubric else None


def has_feedback(submission: dict[str, Any] | None) -> bool:
    """Whether the teacher left feedback: someone else's comments, or rubric scores."""
    s = submission or {}
    return bool(_theirs(s.get("comments") or []) or s.get("rubric_scores"))


def _columns(f: Facts) -> dict[str, Any]:
    return {"assignment": f.assignment, "submission": f.submission, "quiz": f.quiz}


async def run(ctx: Ctx, link: LmsCourseLink, b: Bound, sync_round: SyncRound) -> StageResult:
    got = await sync_round.area(
        ctx,
        link,
        b,
        AREA,
        lambda: facts.read_list(ctx, link, b, refresh=True),
        truncated=lambda r: r[1],
    )
    listed = got[0] if got is not None else []
    by_id = {str(a["external_id"]): a for a in listed}
    side = Side()
    if got is not None:
        side = await facts.read_side(ctx, link, b, listed, refresh=True)
        for part, (result, error) in side.reads.items():
            sync_round.part(part, result, error)
    else:
        # Not read when the list gave nothing: they are read with it (M09 表 5c).
        for part in facts.SIDE_PARTS:
            sync_round.like(part, AREA)
    stored = list(
        await ctx.db.scalars(select(LmsImportedRef).where(LmsImportedRef.link_id == link.id))
    )
    # Only what has a state to change is read on its own (table 3c, row 10): an imported or
    # ignored assignment. The others stay in the mirror until a list read whole leaves them out.
    rows_before = {r.external_id: r for r in await facts.mirror_rows(ctx, link.id)}
    tracked = {r.external_id for r in stored}
    presences = await _presences(
        ctx,
        link,
        b,
        sync_round,
        [
            *((r.external_id, True) for r in stored),
            *((e, False) for e in rows_before if e not in tracked),
        ],
        listed=by_id,
    )
    await hold(ctx, link)
    await sync_round.save(ctx, link, [KIND])
    refs = {
        r.external_id: r
        for r in await ctx.db.scalars(
            select(LmsImportedRef).where(LmsImportedRef.link_id == link.id)
        )
    }
    rows = {r.external_id: r for r in await facts.mirror_rows(ctx, link.id)}
    result = StageResult()
    # The course total is the stage's own record (table 5b, row 8): what shows it refreshes.
    changed = False
    if side.total_read:
        total = side.total or {}
        if (link.total_score, link.total_grade) != (total.get("score"), total.get("grade")):
            link.total_score, link.total_grade = total.get("score"), total.get("grade")
            changed = True

    async def zone() -> ZoneInfo:
        return ZoneInfo((await academics.get_program_row(ctx, link.program_id)).timezone)

    async def weights() -> dict[str, Any]:
        return weights_of(listed)

    async def follow() -> frozenset[str]:
        return lms_settings.followed(await lms_settings.account(ctx))

    s = _Shared(
        Shared(zone), Shared(weights), Shared(follow), Shared(lambda: completes_submitted(ctx))
    )
    for ext in dict.fromkeys([*by_id, *refs, *rows]):
        out = _Done()
        title = _title(by_id.get(ext), refs.get(ext), rows.get(ext))
        async with one_item(ctx, link, result, KIND, ext, title) as item:
            await _one(ctx, link, b, ext, by_id.get(ext), refs.get(ext), rows.get(ext), side,
                       presences.get(ext, "unknown"), s, out)  # fmt: skip
        if item.ok:
            changed |= out.changed
            result.applied += out.applied
            result.pending += out.pending
    if changed:
        await events.publish(
            ctx, ASSIGNMENTS_UPDATED, {"course_id": link.course_id, "program_id": link.program_id}
        )
    if result.applied:
        await events.publish(ctx, "lms.course.imports_recorded", {"course_id": link.course_id})
    return result


def _title(a: dict[str, Any] | None, ref: LmsImportedRef | None, row: LmsAssignment | None) -> str:
    """An assignment's name: as listed this round, else as last kept."""
    if a is not None:
        return str(a.get("name") or "")
    if row is not None:
        return str(row.assignment.get("name") or "")
    return str(ref.snapshot.get("title") or "") if ref is not None else ""


@dataclass
class _Shared:
    """What the assignments of a course share (M09 table 5b, row 6)."""

    zone: Shared[ZoneInfo]
    weights: Shared[dict[str, Any]]
    follow: Shared[frozenset[str]]
    completes: Shared[bool]


@dataclass
class _Done:
    """What one assignment's writes add to the stage's result."""

    changed: bool = False
    applied: list[Applied] = field(default_factory=lambda: [])
    pending: int = 0


async def _one(
    ctx: Ctx,
    link: LmsCourseLink,
    b: Bound,
    ext: str,
    a: dict[str, Any] | None,
    ref: LmsImportedRef | None,
    row: LmsAssignment | None,
    side: Side,
    verdict: Presence,
    s: _Shared,
    out: _Done,
) -> None:
    """One assignment of the round, all its writes (M09 table 5b, row 7): its mirror row, new
    feedback, where it stands (table 4b), the fields its object follows, its to-do finished."""
    source = Source("mirror", ctx.now)
    f = facts_of(a, side, row, b.row.provider, source) if a is not None else None
    if a is not None and f is not None:
        if row is None:
            ctx.db.add(
                LmsAssignment(
                    user_id=ctx.user_id,
                    link_id=link.id,
                    course_id=link.course_id,
                    provider=b.row.provider,
                    external_id=ext,
                    **_columns(f),
                )
            )
            out.changed = True
        else:
            if ref is not None and ref.target_id is not None:
                new = news(row.submission, f.submission)
                if new is not None:
                    change = LmsSyncChange(
                        user_id=ctx.user_id, ref_id=ref.id, field=FEEDBACK, old=None, new=new,
                        at=ctx.now,
                    )  # fmt: skip
                    ctx.db.add(change)
                    await ctx.db.flush()
                    out.applied.append(
                        Applied(
                            change_id=change.id,
                            ref_id=ref.id,
                            name=str(a.get("name") or ""),
                            field=FEEDBACK,
                            external_id=ext,
                        )
                    )
            for name, value in _columns(f).items():
                if getattr(row, name) != value:
                    setattr(row, name, value)
                    out.changed = True
            if row.provider != b.row.provider:
                row.provider = b.row.provider
                out.changed = True
    if ref is not None:
        if verdict == "gone":
            ref = await assignment_refs.enter(ctx, ref, "gone", link=link, external_id=ext)
        elif verdict == "present":
            ref = await assignment_refs.enter(ctx, ref, "back", link=link, external_id=ext)
    imported = ref is not None and ref.target_id is not None
    if ref is not None and imported:
        if a is None:
            # Not listed (the list closed, or cut short): its fields wait for a round that
            # lists it, as a single read gives no group weights.
            out.pending += ref.removed_at is not None
        else:
            tz = await s.zone.get()
            local = (await local_values(ctx, [ref], tz)).get(ref.id)
            if local is not None:  # else its object is being deleted
                platform = snapshot(a, (await s.weights.get()).get(ext))
                if ref.target_kind != "assessment":
                    platform.pop("score", None)
                    platform.pop("dropped", None)
                follow = await s.follow.get()
                out.applied += await _follow(ctx, ref, platform, local, tz, str(a["name"]), follow)
                out.pending += len(ref.conflicts)
    # Gone from the platform, its mirror row goes (table 3c), but an imported one waits for the
    # user's answer (table 4b): keeping the object keeps its content (`resolve`).
    if (
        row is not None
        and a is None
        and verdict == "gone"
        and not (ref is not None and imported and ref.removed_at is not None)
    ):
        await ctx.db.delete(row)
        out.changed = True
    handed_in = f is not None and (f.submission or {}).get("submitted_at") is not None
    first_hand_in = ref is not None and imported and handed_in and ref.submitted_at is None
    if first_hand_in and ref is not None and await s.completes.get():
        await submissions.complete(ctx, ref)
    offered = ref is None or not (imported or ref.dismissed_at)
    if a is not None and f is not None and offered:
        out.pending += is_new(a, f.submission, imported=False, dismissed=False, now=ctx.now)
    await ctx.db.flush()


async def _presences(
    ctx: Ctx,
    link: LmsCourseLink,
    b: Bound,
    sync_round: SyncRound,
    refs: Iterable[tuple[str, bool]],
    *,
    listed: Mapping[str, Any],
) -> dict[str, Presence]:
    """Whether each assignment (with whether it may be read on its own) is still on the
    platform (M09 table 3c, `SyncRound.judge`)."""
    ext = link.external_course_id

    async def one(kind: str, aid: str) -> object:
        del kind
        got, _ = await service.call(
            ctx, b, lambda i: b.provider.assignment(i, b.cfg, b.creds, ext, aid)
        )
        return got

    asked = [Asked(KIND, e, listed=e in listed, readable=readable) for e, readable in refs]
    judged = await sync_round.judge(ctx, link, b, asked, areas=[AREA], read=one_by_one(one))
    return {e: verdict for (_, e), verdict in judged.verdicts.items()}


async def _enabled(ctx: Ctx, link: LmsCourseLink, b: Bound) -> bool:
    del ctx, link
    return "assignments" in b.provider.features


AREA = facts.AREA
KIND = "assignment"
# The field of the change logged for new feedback (never put back: nothing in Semestra to undo).
FEEDBACK = "feedback"


def _reads(link: LmsCourseLink, b: Bound, sync_round: SyncRound) -> list[Call]:
    """The lists `run` reads of every course (`facts.read_list`, `facts.read_side`; the quizzes
    only when an assignment is one)."""
    del sync_round
    ext = link.external_course_id
    features = b.provider.features
    calls = [Call("assignments", (ext,))]
    if "submissions" in features:
        calls.append(Call("submissions", (ext,)))
    if "grades" in features:
        calls.append(Call("course_total", (ext,)))
    return calls


register_sync_stage(
    "assignments",
    run,
    order=20,
    enabled=_enabled,
    parts=(AREA, *facts.SIDE_PARTS),
    reads=_reads,
)


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
    kind, target_id, ext = ref.target_kind, ref.target_id, ref.external_id
    if choice == "delete":
        name = "grading.assessment.delete" if kind == "assessment" else "tasks.item.delete"
        await assignment_refs.enter(ctx, ref, "delete", link=link, external_id=ext)
        await deps.call(ctx, name, {f"{kind}_id": target_id})
    else:
        # The object stays as made by hand; the assignment's content stays with it (§3.2).
        await assignment_refs.enter(ctx, ref, "keep", link=link, external_id=ext, hold=True)
        if kind == "assessment":
            await grading.set_source(ctx, target_id, None)
    # The assignment is gone from the platform: its mirror row waited for this answer.
    row = await ctx.db.scalar(
        select(LmsAssignment).where(
            LmsAssignment.link_id == link.id, LmsAssignment.external_id == ext
        )
    )
    if row is not None:
        await ctx.db.delete(row)
    await ctx.db.flush()
    await events.publish(
        ctx, ASSIGNMENTS_UPDATED, {"course_id": link.course_id, "program_id": link.program_id}
    )
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
        found = {d.field: d for d in differences(ref, local, tz) if not d.out_of_range}
        if choice != "platform" or name not in found:
            raise lms_error("lms.sync_nothing_to_resolve")
        mine, p = found[name].mine, found[name].platform
        await write(ctx, ref, name, p)
        await _log(ctx, ref, name, mine, p, title)
    await ctx.db.flush()
    await _changed(ctx, link)
    return link.program_id


async def toggleable(ctx: Ctx, changes: list[tuple[LmsSyncChange, LmsImportedRef]]) -> set[str]:
    """The changes that can still be put back, or applied again once put back: a field's value
    (not new feedback, `sync_kept`), the newest of their field, no question open about the
    field, and the field still holding what the change (or putting it back) left there, so no
    later sync or edit is overwritten."""
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
        and change.field in FIELDS[refs[change.ref_id].target_kind or "task"]
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


async def dismiss(ctx: Ctx, program_id: str, assignment_ids: list[str], dismissed: bool) -> None:
    """Ignores new assignments, by mirror row (no longer offered, still listed as ignored), or
    offers them again (M09 table 3e, 4b)."""
    changed = False
    for row_id in assignment_ids:
        row = await ctx.db.get(LmsAssignment, row_id)
        if row is None or row.user_id != ctx.user_id or row.link_id is None:
            raise not_found("lms_assignment", row_id)
        link = await ctx.db.get(LmsCourseLink, row.link_id)
        assert link is not None
        if link.program_id != program_id:
            continue  # another Program's
        await hold(ctx, link)
        ref = await assignment_refs.ref_of(ctx, link.id, row.external_id)
        state = assignment_refs.state_of(ref)
        if state in ("imported", "removed"):
            continue  # imported meanwhile
        if dismissed == (state == "ignored"):
            continue
        event = "ignore" if dismissed else "remind"
        await assignment_refs.enter(ctx, ref, event, link=link, external_id=row.external_id)
        changed = True
    if changed:
        await ctx.db.flush()
        await events.publish(ctx, UPDATED, {"program_id": program_id})
