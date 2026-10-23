"""Names of meetings, event types and events for the assistant's chat (`core.labels`)."""

from typing import Any

from semestra.core.context import Ctx
from semestra.core.labels import each, owned_names, resolver
from semestra.modules.schedule import meetings
from semestra.modules.schedule.models import ScheduleEvent, ScheduleEventType


@resolver("meeting")
async def meeting(ctx: Ctx, ids: list[str], args: dict[str, Any]) -> dict[str, str]:
    return await each(ids, lambda id_: meetings.meeting_label(ctx, id_))


resolver("event_type")(owned_names(ScheduleEventType, lambda row: f"{row.code} {row.name}"))
resolver("event")(owned_names(ScheduleEvent, lambda row: row.title))
