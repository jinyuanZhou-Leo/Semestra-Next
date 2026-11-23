"""Assignments handed in on the platform finish their to-dos (M09 §4.6).

When the sync's `assignments` stage reads a course's submissions (`sync_assignments.py`; reads
write nothing), the imported assignments the platform shows handed in for the first time get
their to-do finished: the task they were imported as, or the task of the assessment they
were imported as. Each assignment counts once (`LmsImportedRef.submitted_at`), so a to-do the
user opens again stays open. The account setting `lms.complete_submitted` turns this off; while
it is off nothing is recorded, so turning it on catches up with what was handed in meanwhile."""

from semestra.core.context import Ctx
from semestra.modules.lms.models import LmsImportedRef
from semestra.modules.tasks import service as tasks


async def complete(ctx: Ctx, ref: LmsImportedRef) -> None:
    """Finishes the to-do of an imported assignment the platform shows handed in, the first time
    (the caller checks the setting, `completes_submitted`), in the caller's transaction."""
    if ref.target_id is None or ref.submitted_at is not None:
        return
    ref.submitted_at = ctx.now
    await tasks.complete_open(
        ctx,
        task_ids=[ref.target_id] if ref.target_kind == "task" else [],
        assessment_ids=[ref.target_id] if ref.target_kind == "assessment" else [],
    )
    await ctx.db.flush()
