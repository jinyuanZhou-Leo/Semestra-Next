"""Assignments handed in on the platform finish their to-dos (M09 §4.6).

When the sync's `assignments` stage reads a course's submissions (`sync_assignments.py`; reads
write nothing), the imported assignments the platform shows handed in for the first time get
their to-do finished: the task they were imported as, or the task of the assessment they
were imported as. Each assignment counts once (`LmsImportedRef.submitted_at`), so a to-do the
user opens again stays open. The account setting `lms.complete_submitted` turns this off; while
it is off nothing is recorded, so turning it on catches up with what was handed in meanwhile."""

from typing import Any

from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.modules.lms.models import LmsCourseLink, LmsImportedRef
from semestra.modules.lms.settings import completes_submitted
from semestra.modules.tasks import service as tasks


def handed_in(assignments: list[dict[str, Any]]) -> set[str]:
    """External ids of the assignments the user handed in on the platform (it has a submission
    time). One graded without being handed in there (on paper, or a zero for a missing one) does
    not count: the setting is about submitting on the platform."""
    return {
        a["external_id"]
        for a in assignments
        if ((a.get("submission") or {}).get("submitted_at")) is not None
    }


async def complete(ctx: Ctx, link_id: str, submitted: set[str]) -> None:
    """Finishes the to-dos of newly handed-in imported assignments, in the caller's transaction."""
    if not submitted or not await completes_submitted(ctx):
        return
    link = await ctx.db.get(LmsCourseLink, link_id)
    if link is None or link.user_id != ctx.user_id or not link.sync_enabled:
        return
    refs = list(
        await ctx.db.scalars(
            select(LmsImportedRef).where(
                LmsImportedRef.link_id == link_id,
                LmsImportedRef.submitted_at.is_(None),
                LmsImportedRef.target_id.is_not(None),
                LmsImportedRef.external_id.in_(submitted),
            )
        )
    )
    if not refs:
        return
    for ref in refs:
        ref.submitted_at = ctx.now
    await tasks.complete_open(
        ctx,
        task_ids=[r.target_id for r in refs if r.target_kind == "task" and r.target_id],
        assessment_ids=[r.target_id for r in refs if r.target_kind == "assessment" and r.target_id],
    )
    await ctx.db.flush()
