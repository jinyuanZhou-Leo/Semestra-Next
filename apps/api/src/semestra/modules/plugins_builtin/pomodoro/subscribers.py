from semestra.core.context import Ctx
from semestra.core.events import Event, events
from semestra.modules.plugins_builtin.pomodoro import service
from semestra.modules.plugins_builtin.pomodoro.schemas import PLUGIN_ID


@events.subscribe("plugins.purge", in_transaction=True)
async def on_plugin_purged(ctx: Ctx, event: Event) -> None:
    if event.user_id and event.data.get("plugin_id") == PLUGIN_ID:
        await service.purge(ctx, event.user_id)
