"""Clean-up and set-up on academics events (M04 §4)."""

from semestra.core.context import Ctx
from semestra.core.events import Event, events
from semestra.modules.schedule import service


@events.subscribe("academics.program.created")
async def on_program_created(ctx: Ctx, event: Event) -> None:
    await service.ensure_event_types(ctx, event.data["program_id"])


@events.subscribe("academics.course.deleting", in_transaction=True)
async def on_course_deleting(ctx: Ctx, event: Event) -> None:
    await service.delete_for_course(ctx, event.data["course_id"], event.data["program_id"])


@events.subscribe("academics.term.deleting", in_transaction=True)
async def on_term_deleting(ctx: Ctx, event: Event) -> None:
    await service.delete_for_term(ctx, event.data["term_id"], event.data["program_id"])


@events.subscribe("academics.program.deleting", in_transaction=True)
async def on_program_deleting(ctx: Ctx, event: Event) -> None:
    await service.delete_for_program(ctx, event.data["program_id"])


@events.subscribe("academics.course.terms_changed")
async def on_terms_changed(ctx: Ctx, event: Event) -> None:
    data = event.data
    await service.unlink_course_terms(ctx, data["course_id"], data["program_id"], data["term_ids"])
