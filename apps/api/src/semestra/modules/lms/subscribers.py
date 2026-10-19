"""Clean-up when what the LMS data points at goes away (M09 §6)."""

from semestra.core.context import Ctx
from semestra.core.events import Event, events
from semestra.modules.lms import service


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
    if isinstance(assessment_id := event.data.get("assessment_id"), str):
        await service.forget_target(ctx, "assessment", assessment_id)


@events.subscribe("tasks.item.deleted")
async def on_task_deleted(ctx: Ctx, event: Event) -> None:
    """M05 announces deleted tasks after commit (no `deleting` event yet)."""
    ids = event.data.get("task_ids") or [event.data.get("task_id")]  # bulk clear, or one task
    for task_id in ids:
        if isinstance(task_id, str):
            await service.forget_target(ctx, "task", task_id)
