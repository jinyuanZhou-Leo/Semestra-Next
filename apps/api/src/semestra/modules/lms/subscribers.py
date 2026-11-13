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
    """The assignments can be imported again."""
    if await service.forget_targets(ctx, "assessment", _ids(event, "assessment")):
        await _sync_changed(ctx, event)


@events.subscribe("tasks.item.deleted")
async def on_task_deleted(ctx: Ctx, event: Event) -> None:
    """M05 announces deleted tasks after commit (no `deleting` event yet)."""
    if await service.forget_targets(ctx, "task", _ids(event, "task")):
        await _sync_changed(ctx, event)


@events.subscribe("grading.assessment.updated", in_transaction=True)
async def on_assessment_updated(ctx: Ctx, event: Event) -> None:
    await _on_updated(ctx, event, "assessment")


@events.subscribe("tasks.item.updated")
async def on_task_updated(ctx: Ctx, event: Event) -> None:
    await _on_updated(ctx, event, "task")


def _ids(event: Event, kind: str) -> list[str]:
    """The objects an event is about: a batch (`<kind>_ids`) or one (`<kind>_id`)."""
    ids = event.data.get(f"{kind}_ids") or [event.data.get(f"{kind}_id")]
    return [i for i in ids if isinstance(i, str)]


async def _on_updated(ctx: Ctx, event: Event, kind: str) -> None:
    changed = set(event.data.get("changed") or [])
    if changed & FOLLOWED[kind] and await service.any_imported(ctx, kind, _ids(event, kind)):
        await _sync_changed(ctx, event)
