from semestra.core.context import Ctx
from semestra.core.events import Event, events
from semestra.modules.plugins_builtin.habit_streak import service
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
