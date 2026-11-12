"""Clean-up when what the LMS data points at goes away (M09 §6), and telling the sync panel
when the user changed an imported object (its "different" list and undo buttons depend on it)."""

from semestra.core.context import Ctx
from semestra.core.events import Event, events
from semestra.modules.lms import service
from semestra.modules.lms.sync import UPDATED

# The `changed` names of the fields the sync compares (M09 §4.1).
FOLLOWED = {
    "assessment": {
        "title",
        "due_at",
        "due_has_time",
        "weight",
        "score_percentage",
        "points_earned",
        "points_possible",
    },
    "task": {"title", "due"},
}


async def _sync_changed(ctx: Ctx, event: Event) -> None:
    if isinstance(program_id := event.data.get("program_id"), str):
        await events.publish(ctx, UPDATED, {"program_id": program_id})


@events.subscribe("academics.course.deleting", in_transaction=True)
async def on_course_deleting(ctx: Ctx, event: Event) -> None:
    if isinstance(course_id := event.data.get("course_id"), str):
        await service.forget_course(ctx, course_id)


@events.subscribe("academics.program.deleting", in_transaction=True)
async def on_program_deleting(ctx: Ctx, event: Event) -> None:
    if isinstance(program_id := event.data.get("program_id"), str):
        await service.forget_program(ctx, program_id)


@events.subscribe("grading.assessment.deleting", in_transaction=True)
async def on_assessment_deleting(ctx: Ctx, event: Event) -> None:
    """The assignment can be imported again."""
    assessment_id = event.data.get("assessment_id")
    if isinstance(assessment_id, str) and await service.forget_target(
        ctx, "assessment", assessment_id
    ):
        await _sync_changed(ctx, event)


@events.subscribe("tasks.item.deleted")
async def on_task_deleted(ctx: Ctx, event: Event) -> None:
    """M05 announces deleted tasks after commit (no `deleting` event yet)."""
    ids = event.data.get("task_ids") or [event.data.get("task_id")]  # bulk clear, or one task
    forgot = False
    for task_id in ids:
        if isinstance(task_id, str):
            forgot = await service.forget_target(ctx, "task", task_id) or forgot
    if forgot:
        await _sync_changed(ctx, event)


@events.subscribe("grading.assessment.updated", in_transaction=True)
async def on_assessment_updated(ctx: Ctx, event: Event) -> None:
    await _on_updated(ctx, event, "assessment", event.data.get("assessment_id"))


@events.subscribe("tasks.item.updated")
async def on_task_updated(ctx: Ctx, event: Event) -> None:
    await _on_updated(ctx, event, "task", event.data.get("task_id"))


async def _on_updated(ctx: Ctx, event: Event, kind: str, target_id: object) -> None:
    changed = set(event.data.get("changed") or [])
    if (
        isinstance(target_id, str)
        and changed & FOLLOWED[kind]
        and await service.is_imported(ctx, kind, target_id)
    ):
        await _sync_changed(ctx, event)
