"""Assignments handed in on the platform finish their to-dos (M09 §4.6).

Whenever the module reads a course's assignments (the Canvas tab, imports, or the background
sync in `sync.py`), the imported ones the platform shows handed in for the first time
get their to-do finished: the task they were imported as, or the task of the assessment they
were imported as. Each assignment counts once (`LmsImportedRef.submitted_at`), so a to-do the
user opens again stays open. The account setting `lms.complete_submitted` turns this off; while
it is off nothing is recorded, so turning it on catches up with what was handed in meanwhile."""

from typing import Any

from sqlalchemy import select

from semestra.core.context import Ctx, run_as_system
from semestra.modules.lms.models import LmsCourseLink, LmsImportedRef
from semestra.modules.lms.settings import completes_submitted
from semestra.modules.tasks import service as tasks


def handed_in(assignments: list[dict[str, Any]]) -> set[str]:
    """External ids of the assignments the user has submitted on the platform."""
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
                LmsImportedRef.external_kind == "assignment",
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


def after_read(ctx: Ctx, link_id: str, assignments: list[dict[str, Any]]) -> None:
    """Runs `complete` after the read, in a transaction of its own: reads write nothing."""
    submitted = handed_in(assignments)
    if not submitted:
        return
    state, user_id = ctx.state, ctx.user_id

    async def run() -> None:
        await run_as_system(state, user_id, lambda sys: complete(sys, link_id, submitted))

    ctx.after_commit.append(run)
