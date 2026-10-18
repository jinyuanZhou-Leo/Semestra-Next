from semestra.core.context import Ctx
from semestra.core.events import Event, events
from semestra.modules.plugins_builtin.pomodoro import service
from semestra.modules.plugins_builtin.pomodoro.schemas import PLUGIN_ID
from semestra.modules.settings import service as settings


@events.subscribe("plugins.purge", in_transaction=True)
async def on_plugin_purged(ctx: Ctx, event: Event) -> None:
    if event.user_id and event.data.get("plugin_id") == PLUGIN_ID:
        await service.purge(ctx, event.user_id)
        # Timer state lives in UI preferences (`pomodoro.<instanceId>`, `pomodoro.active`).
        await settings.purge_ui_state(ctx, event.user_id, "pomodoro.")
