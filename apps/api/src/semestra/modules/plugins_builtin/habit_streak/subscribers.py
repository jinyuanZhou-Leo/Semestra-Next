from semestra.core.context import Ctx
from semestra.core.events import Event, events
from semestra.modules.plugins_builtin.habit_streak import reminders, service
from semestra.modules.plugins_builtin.habit_streak.schemas import CARD_IDS, PLUGIN_ID


@events.subscribe("layouts.card.deleted")
async def on_card_deleted(ctx: Ctx, event: Event) -> None:
    instance_id = event.data.get("instance_id")
    if event.user_id and event.data.get("card_id") in CARD_IDS and isinstance(instance_id, str):
        await service.delete_for_instance(ctx, event.user_id, instance_id)


@events.subscribe("plugins.purge", in_transaction=True)
async def on_plugin_purged(ctx: Ctx, event: Event) -> None:
    if event.user_id and event.data.get("plugin_id") == PLUGIN_ID:
        await service.purge(ctx, event.user_id)


@events.subscribe("layouts.card.settings_updated")
async def on_card_settings_updated(ctx: Ctx, event: Event) -> None:
    """The reminder's time may have changed (or it was turned on or off)."""
    instance_id = event.data.get("instance_id")
    if ctx.user is not None and isinstance(instance_id, str):
        await reminders.replan(ctx, instance_id)
