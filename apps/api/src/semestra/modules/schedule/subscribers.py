"""Clean-up and set-up on academics events (M04 §4)."""

from semestra.core.context import Ctx
from semestra.core.events import Event, events
from semestra.modules.schedule import cleanup, event_types
from semestra.modules.schedule.calendar import CALENDAR_CHANGED


@events.subscribe("academics.program.created")
async def on_program_created(ctx: Ctx, event: Event) -> None:
    await event_types.ensure_event_types(ctx, event.data["program_id"])


@events.subscribe("academics.course.deleting", in_transaction=True)
async def on_course_deleting(ctx: Ctx, event: Event) -> None:
    await cleanup.delete_for_course(ctx, event.data["course_id"], event.data["program_id"])


@events.subscribe("academics.term.deleting", in_transaction=True)
async def on_term_deleting(ctx: Ctx, event: Event) -> None:
    await cleanup.delete_for_term(ctx, event.data["term_id"], event.data["program_id"])


@events.subscribe("academics.program.deleting", in_transaction=True)
async def on_program_deleting(ctx: Ctx, event: Event) -> None:
    await cleanup.delete_for_program(ctx, event.data["program_id"])


@events.subscribe("academics.course.terms_changed")
async def on_terms_changed(ctx: Ctx, event: Event) -> None:
    data = event.data
    await cleanup.unlink_course_terms(ctx, data["course_id"], data["program_id"], data["term_ids"])


# Fields that move occurrences: a class's dates follow its term's weeks and breaks, and every
# time is wall-clock in the Program's time zone.
_TERM_CALENDAR_FIELDS = {"start_date", "end_date", "breaks", "count_break_weeks"}


@events.subscribe("academics.term.updated")
async def on_term_updated(ctx: Ctx, event: Event) -> None:
    if _TERM_CALENDAR_FIELDS & set(event.data.get("fields") or []):
        await events.publish(ctx, CALENDAR_CHANGED, {"program_id": event.data["program_id"]})


@events.subscribe("academics.program.updated")
async def on_program_updated(ctx: Ctx, event: Event) -> None:
    if "timezone" in (event.data.get("fields") or []):
        await events.publish(ctx, CALENDAR_CHANGED, {"program_id": event.data["program_id"]})
