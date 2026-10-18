"""Cleanup driven by other modules' events (M11 §3)."""

from semestra.core.context import Ctx
from semestra.core.events import Event, events
from semestra.modules.settings import service


def _target(event: Event, key: str) -> tuple[str, str] | None:
    """(user_id, entity id) of an event that names one of the user's entities."""
    value = event.data.get(key)
    return (event.user_id, value) if event.user_id and isinstance(value, str) else None


@events.subscribe("academics.program.deleted")
async def on_program_deleted(ctx: Ctx, event: Event) -> None:
    if target := _target(event, "program_id"):
        await service.purge_scope(ctx, target[0], "program", target[1])
        await service.forget_active_program(ctx, *target)


@events.subscribe("academics.term.deleted")
async def on_term_deleted(ctx: Ctx, event: Event) -> None:
    if target := _target(event, "term_id"):
        await service.purge_scope(ctx, target[0], "term", target[1])


@events.subscribe("academics.course.deleted")
async def on_course_deleted(ctx: Ctx, event: Event) -> None:
    if target := _target(event, "course_id"):
        await service.purge_scope(ctx, target[0], "course", target[1])


@events.subscribe("plugins.purge")
async def on_plugin_purged(ctx: Ctx, event: Event) -> None:
    if target := _target(event, "plugin_id"):
        await service.purge_plugin(ctx, *target)
