"""The teacher's feedback, kept in Semestra (M09 §4.4): the feedback stage of the course sync and
what the gradebook reads.

Each sync reads the user's submissions of the whole course at once (`LmsProvider.submissions`)
and keeps, for every imported assessment, the comments, the rubric with what the teacher gave per
criterion, and the score as the platform shows it (`LmsFeedback`). Comments edited or deleted on
the platform are edited or deleted here. New comments, or a rubric assessed for the first time,
are a change of the assessment in the status panel's "recent updates" (and a notification, M18
§4.4); what an assessment already
had when the sync first read it is not, nor are the user's own comments under their submission.
To-dos (assignments worth no points) have no gradebook row, so nothing is kept for them.

The feedback belongs to the assessment: once it is unbound or its course unlinked, the sync no
longer reaches it and it stays as last read.
"""

from typing import Any

from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.events import events
from semestra.modules.academics import service as academics
from semestra.modules.lms import reads, service
from semestra.modules.lms.models import LmsCourseLink, LmsFeedback, LmsImportedRef, LmsSyncChange
from semestra.modules.lms.schemas.dto import SubmissionDetail
from semestra.modules.lms.schemas.io import FeedbackList, FeedbackOut
from semestra.modules.lms.service import Bound
from semestra.modules.lms.sync import Applied, StageResult, hold, register_sync_stage

# The gradebook's feedback refetches on it.
UPDATED = "lms.feedback.updated"
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
    }
    if assignment is not None:
        out |= {
            "web_url": assignment.get("web_url"),
            "points": assignment.get("points"),
            "rubric": assignment.get("rubric") or [],
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


def news(before: LmsFeedback, after: dict[str, Any]) -> dict[str, Any] | None:
    """What is new for the user: someone else's comments not there before, a rubric assessed
    for the first time. None when nothing is."""
    seen = {_key(c) for c in before.comments}
    comments = sum(1 for c in _theirs(after["comments"]) if _key(c) not in seen)
    rubric = bool(after["rubric_scores"]) and not before.rubric_scores
    return {"comments": comments, "rubric": rubric} if comments or rubric else None


async def run(ctx: Ctx, link: LmsCourseLink, b: Bound) -> StageResult:
    ext = link.external_course_id
    found, truncated = await service.call(
        ctx, b, lambda i: b.provider.submissions(i, b.cfg, b.creds, ext)
    )
    subs = {s.assignment_id: s.model_dump(mode="json") for s in found}
    # Read by the assignments stage just before (the in-process cache), for the rubrics.
    listed, cut = await reads.raw_assignments(ctx, link.course_id, False, linked=(link, b))
    assignments = {str(a["external_id"]): a for a in listed}
    await hold(ctx, link)
    refs = list(
        await ctx.db.scalars(
            select(LmsImportedRef).where(
                LmsImportedRef.link_id == link.id,
                LmsImportedRef.target_kind == "assessment",
                LmsImportedRef.target_id.is_not(None),
                LmsImportedRef.removed_at.is_(None),
            )
        )
    )
    rows = {
        f.assessment_id: f
        for f in await ctx.db.scalars(
            select(LmsFeedback).where(
                LmsFeedback.assessment_id.in_([str(r.target_id) for r in refs])
            )
        )
    }
    changed = False
    news_of: list[tuple[LmsSyncChange, str]] = []
    for ref in refs:
        sub = subs.get(ref.external_id)
        if sub is None and truncated:
            continue  # a cut-off list says nothing about what is missing from it
        a = assignments.get(ref.external_id)
        values = _values(sub, a if a is not None or not cut else None)
        values |= {"provider": b.row.provider, "assignment_id": ref.external_id}
        row = rows.get(str(ref.target_id))
        if row is None:
            # What the assessment has when first read is not news.
            ctx.db.add(
                LmsFeedback(
                    user_id=ctx.user_id,
                    assessment_id=ref.target_id,
                    course_id=link.course_id,
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
            news_of.append((change, str(title)))
        for name, value in values.items():
            if getattr(row, name) != value:
                setattr(row, name, value)
                changed = True
    await ctx.db.flush()
    if changed:
        await events.publish(ctx, UPDATED, {"course_id": link.course_id})
    return StageResult(
        applied=[Applied(change_id=c.id, name=title, field=FIELD) for c, title in news_of]
    )


async def _enabled(ctx: Ctx, link: LmsCourseLink, b: Bound) -> bool:
    del ctx, link
    return {"assignments", "submissions"} <= b.provider.features


# After the assignments stage (it imports and binds; its read gives the rubrics).
register_sync_stage("feedback", run, order=30, enabled=_enabled)


async def feedback_list(ctx: Ctx, course_id: str) -> FeedbackList:
    """The kept feedback of the course's assessments that have feedback (someone else's
    comments, or rubric scores), from the database only; also of assessments no longer tied to
    the platform. The user's own comments come with it, for the conversation."""
    await academics.get_course_row(ctx, course_id)  # owned, or not found
    rows = await ctx.db.scalars(
        select(LmsFeedback).where(
            LmsFeedback.user_id == ctx.user_id, LmsFeedback.course_id == course_id
        )
    )
    return FeedbackList(
        items=[
            FeedbackOut.model_validate({k: getattr(f, k) for k in FeedbackOut.model_fields})
            for f in rows
            if _theirs(f.comments) or f.rubric_scores
        ]
    )
