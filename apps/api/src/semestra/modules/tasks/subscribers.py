"""Reactions to other modules' events (M05 §4)."""

from semestra.core.context import Ctx
from semestra.core.events import Event, events
from semestra.modules.tasks import auto, service


@events.subscribe("academics.course.deleting", in_transaction=True)
async def on_course_deleting(ctx: Ctx, event: Event) -> None:
    await service.detach_course(ctx, event.data["course_id"])


@events.subscribe("academics.term.deleting", in_transaction=True)
async def on_term_deleting(ctx: Ctx, event: Event) -> None:
    await service.remove_term(ctx, event.data["term_id"])


@events.subscribe("academics.program.deleting", in_transaction=True)
async def on_program_deleting(ctx: Ctx, event: Event) -> None:
    await service.remove_program(ctx, event.data["program_id"])


async def _on_assessment(ctx: Ctx, event: Event) -> None:
    await auto.sync(ctx, event.data["assessment_ids"])


@events.subscribe("grading.assessment.deleting", in_transaction=True)
async def on_assessment_deleting(ctx: Ctx, event: Event) -> None:
    """The tasks go in the same transaction, announced (the foreign key would take them too, but
    silently: that is only the fallback for bulk deletes)."""
    await auto.drop(ctx, event.data["assessment_ids"])


# In the transaction: the task exists once the assessment does, so a reader right after the
# commit (M09 finishing the to-dos of handed-in assignments) finds it.
for _kind in ("created", "updated"):
    events.subscribe(f"grading.assessment.{_kind}", in_transaction=True)(_on_assessment)
