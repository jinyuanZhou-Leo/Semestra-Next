"""The conversation each course file was asked about in its preview (M12 §6.1, `FilePanel`).

The web app keeps it as UI state, `assistant.file_session.<item_id>`; a deleted file takes it
along.
"""

from semestra.core.context import Ctx
from semestra.core.events import Event, events
from semestra.modules.settings import service as settings

UI_STATE_PREFIX = "assistant.file_session."


@events.subscribe("files.item.deleted")
async def on_file_deleted(ctx: Ctx, event: Event) -> None:
    item_id = event.data.get("item_id")
    if event.user_id and isinstance(item_id, str):
        await settings.purge_ui_state(ctx, event.user_id, f"{UI_STATE_PREFIX}{item_id}")
