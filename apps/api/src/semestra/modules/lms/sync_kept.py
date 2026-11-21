"""Imported assignments, kept in Semestra (M09 §4.4): the feedback stage of the course sync,
what the gradebook reads, and what an assignment opens from when the platform can't be asked.

Each sync reads the user's submissions of the whole course at once (`LmsProvider.submissions`)
and keeps, for every imported assignment (`LmsKeptAssignment`, one row per assessment or to-do): the
assignment's description, dates and how to submit; what the user handed in; the comments, the
rubric with what the teacher gave per criterion, and the score as the platform shows it.
Comments edited or deleted on the platform are edited or deleted here. New comments, or a rubric
assessed for the first time, are a change of the item in the status panel's "recent updates"
(and a notification, M18 §4.4); what it already had when the sync first read it is not, nor are
the user's own comments under their submission.

The row belongs to the assessment or to-do: once it is unbound or its course unlinked, the sync
no longer reaches it and it stays as last read. A to-do that moved into the gradebook hands its
row to the assessment.
"""

from typing import Any

from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.core.events import events
from semestra.modules.academics import service as academics
from semestra.modules.lms import reads, service
from semestra.modules.lms.models import (
    LmsCourseLink,
    LmsImportedRef,
    LmsKeptAssignment,
    LmsSyncChange,
)
from semestra.modules.lms.schemas.dto import SubmissionDetail
from semestra.modules.lms.schemas.io import (
    KEPT_ASSIGNMENT,
    KEPT_SUBMISSION,
    FeedbackList,
    FeedbackOut,
)
from semestra.modules.lms.service import Bound
from semestra.modules.lms.sync import Applied, StageResult, hold, register_sync_stage
from semestra.modules.tasks.models import TasksItem

# The gradebook's feedback refetches on it.
UPDATED = "lms.kept.updated"
events.coalesce(UPDATED)
# The field of the change logged for new feedback (never put back: nothing in Semestra to undo).
FIELD = "feedback"


def _values(sub: dict[str, Any] | None, assignment: dict[str, Any] | None) -> dict[str, Any]:
    """The row's columns from the platform's submission and assignment (as the reads give them).
    Without the assignment (the list was cut short) its columns are left out, so they stay."""
    s = SubmissionDetail.model_validate(sub) if sub is not None else None
    out: dict[str, Any] = {
        "score": s.score if s else None,
        "grade": s.grade if s else None,
        "attempt": s.attempt if s else None,
        "graded_at": s.graded_at if s else None,
        "comments": [c.model_dump(mode="json") for c in s.comments] if s else [],
        "rubric_scores": [r.model_dump(mode="json") for r in s.rubric_scores] if s else [],
        "work": s.model_dump(mode="json", include=set(KEPT_SUBMISSION)) if s else None,
    }
    if assignment is not None:
        out |= {
            "web_url": assignment.get("web_url"),
            "points": assignment.get("points"),
            "rubric": assignment.get("rubric") or [],
            "details": {k: v for k, v in assignment.items() if k in KEPT_ASSIGNMENT},
        }
    return out


def _key(comment: dict[str, Any]) -> tuple[Any, ...]:
    return (
        (comment.get("id"),)
        if comment.get("id")
        else (comment.get("created_at"), comment.get("comment"))
    )


def _theirs(comments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The comments that are feedback: not the user's own."""
    return [c for c in comments if not c.get("own")]


def news(before: LmsKeptAssignment, after: dict[str, Any]) -> dict[str, Any] | None:
    """What is new for the user: someone else's comments not there before, a rubric assessed
    for the first time. None when nothing is."""
    seen = {_key(c) for c in before.comments}
    comments = sum(1 for c in _theirs(after["comments"]) if _key(c) not in seen)
    rubric = bool(after["rubric_scores"]) and not before.rubric_scores
    return {"comments": comments, "rubric": rubric} if comments or rubric else None


async def _quiz_facts(
    ctx: Ctx, link: LmsCourseLink, b: Bound, assignments: dict[str, dict[str, Any]]
) -> dict[str, dict[str, Any]]:
    """The question count and time limit of the course's quizzes, by quiz id; empty when no
    assignment is a quiz or the quizzes can't be read (what was kept then stays)."""
    if "quizzes" not in b.provider.features or not any(
        a.get("quiz_id") for a in assignments.values()
    ):
        return {}
    try:
        found = await reads.quizzes(ctx, link.course_id, False)
    except AppError as exc:
        if not exc.code.startswith("lms."):
            raise
        return {}
    return {
        q.external_id: {"question_count": q.question_count, "time_limit": q.time_limit}
        for q in found.items
    }


async def run(ctx: Ctx, link: LmsCourseLink, b: Bound) -> StageResult:
    ext = link.external_course_id
    found, truncated = await service.call(
        ctx, b, lambda i: b.provider.submissions(i, b.cfg, b.creds, ext)
    )
    for s in found:
        s.body = b.clean(s.body, None, ext)
    subs = {s.assignment_id: s.model_dump(mode="json") for s in found}
    # Read by the assignments stage just before (the in-process cache), for the rest.
    listed, cut = await reads.raw_assignments(ctx, link.course_id, False, linked=(link, b))
    assignments = {str(a["external_id"]): a for a in listed}
    quizzes = await _quiz_facts(ctx, link, b, assignments)
    await hold(ctx, link)
    refs = list(
        await ctx.db.scalars(
            select(LmsImportedRef).where(
                LmsImportedRef.link_id == link.id,
                LmsImportedRef.target_id.is_not(None),
                LmsImportedRef.removed_at.is_(None),
            )
        )
    )
    kept = list(
        await ctx.db.scalars(
            select(LmsKeptAssignment).where(
                LmsKeptAssignment.user_id == ctx.user_id,
                LmsKeptAssignment.course_id == link.course_id,
            )
        )
    )
    # A to-do deleted a moment ago still has its ref (M05 tells after the commit): skipped.
    todos = set(
        await ctx.db.scalars(
            select(TasksItem.id).where(
                TasksItem.id.in_([r.target_id for r in refs if r.target_kind != "assessment"])
            )
        )
    )
    of_assessment = {f.assessment_id: f for f in kept if f.assessment_id}
    of_task = {f.task_id: f for f in kept if f.task_id}
    # A to-do's row by its assignment: the row follows a to-do that moved into the gradebook.
    todo_rows = {f.assignment_id: f for f in kept if f.task_id}
    changed = False
    # (the change, the assignment's name and id)
    news_of: list[tuple[LmsSyncChange, str, str]] = []
    for ref in refs:
        sub = subs.get(ref.external_id)
        if sub is None and truncated:
            continue  # a cut-off list says nothing about what is missing from it
        a = assignments.get(ref.external_id)
        values = _values(sub, a if a is not None or not cut else None)
        values |= {"provider": b.row.provider, "assignment_id": ref.external_id}
        graded = ref.target_kind == "assessment"
        if not graded and ref.target_id not in todos:
            continue
        row = (of_assessment if graded else of_task).get(str(ref.target_id))
        if row is None and graded and (row := todo_rows.get(ref.external_id)) is not None:
            row.assessment_id, row.task_id = ref.target_id, None
            changed = True
        if "details" in values and (quiz_id := (a or {}).get("quiz_id")):
            facts = quizzes.get(str(quiz_id)) or ((row.details or {}).get("quiz") if row else None)
            if facts:
                values["details"]["quiz"] = facts
        if row is None:
            # What the assignment has when first read is not news.
            ctx.db.add(
                LmsKeptAssignment(
                    user_id=ctx.user_id,
                    assessment_id=ref.target_id if graded else None,
                    task_id=None if graded else ref.target_id,
                    course_id=link.course_id,
                    read_at=ctx.now,
                    **values,
                )
            )
            changed = True
            continue
        # Bound to another assignment since: its feedback is read for the first time.
        if row.assignment_id == ref.external_id and (new := news(row, values)) is not None:
            change = LmsSyncChange(
                user_id=ctx.user_id, ref_id=ref.id, field=FIELD, old=None, new=new, at=ctx.now
            )
            ctx.db.add(change)
            title = (a or {}).get("name") or ref.snapshot.get("title") or ""
            news_of.append((change, str(title), ref.external_id))
        for name, value in values.items():
            if getattr(row, name) != value:
                setattr(row, name, value)
                changed = True
        row.read_at = ctx.now
    await ctx.db.flush()
    if changed:
        await events.publish(ctx, UPDATED, {"course_id": link.course_id})
    return StageResult(
        applied=[
            Applied(change_id=c.id, ref_id=c.ref_id, name=title, field=FIELD, external_id=ext_id)
            for c, title, ext_id in news_of
        ]
    )


async def _enabled(ctx: Ctx, link: LmsCourseLink, b: Bound) -> bool:
    del ctx, link
    return {"assignments", "submissions"} <= b.provider.features


# After the assignments stage (it imports and binds; its read gives the rubrics).
register_sync_stage("kept", run, order=30, enabled=_enabled)


def has_feedback(row: LmsKeptAssignment) -> bool:
    """Whether the teacher left feedback on the row's assessment: someone else's comments, or
    rubric scores. A to-do's are not the gradebook's."""
    return bool(row.assessment_id and (_theirs(row.comments) or row.rubric_scores))


async def feedback_list(ctx: Ctx, course_id: str) -> FeedbackList:
    """The kept feedback of the course's assessments that have feedback (someone else's
    comments, or rubric scores), from the database only; also of assessments no longer tied to
    the platform. The user's own comments come with it, for the conversation."""
    await academics.get_course_row(ctx, course_id)  # owned, or not found
    rows = await ctx.db.scalars(
        select(LmsKeptAssignment).where(
            LmsKeptAssignment.user_id == ctx.user_id, LmsKeptAssignment.course_id == course_id
        )
    )
    return FeedbackList(
        items=[
            FeedbackOut.model_validate({k: getattr(f, k) for k in FeedbackOut.model_fields})
            for f in rows
            if has_feedback(f)
        ]
    )
