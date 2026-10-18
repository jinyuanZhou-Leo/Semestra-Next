"""Cleanup driven by other modules' events (M10 §4)."""

from semestra.core.context import Ctx
from semestra.core.events import Event, events
from semestra.modules.layouts import service


@events.subscribe("academics.program.deleting", in_transaction=True)
async def on_program_deleting(ctx: Ctx, event: Event) -> None:
    await service.delete_scope(ctx, "program", event.data["program_id"])


@events.subscribe("academics.term.deleting", in_transaction=True)
async def on_term_deleting(ctx: Ctx, event: Event) -> None:
    await service.delete_scope(ctx, "term", event.data["term_id"])


@events.subscribe("academics.course.deleting", in_transaction=True)
async def on_course_deleting(ctx: Ctx, event: Event) -> None:
    await service.delete_scope(ctx, "course", event.data["course_id"])


@events.subscribe("plugins.purge")
async def on_plugin_purged(ctx: Ctx, event: Event) -> None:
    plugin_id = event.data.get("plugin_id")
    if event.user_id and isinstance(plugin_id, str):
        await service.purge_plugin(ctx, plugin_id)
