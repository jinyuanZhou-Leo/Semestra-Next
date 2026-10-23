"""M04 课表与日历: event types, class sections, one-off events, calendar aggregation, ICS."""

from fastapi import FastAPI

from semestra.core.capability import registry
from semestra.modules.schedule import (  # noqa: F401  (registers on import)
    capabilities,
    labels,
    models,
    portability,
    subscribers,
)
from semestra.modules.schedule.routes import router
from semestra.modules.schedule.settings import CalendarSettings
from semestra.modules.settings import register_settings

register_settings(
    namespace="calendar", schema=CalendarSettings, levels=("account", "program", "term")
)


def register(app: FastAPI) -> None:
    registry.set_id_source("meeting_id", "schedule.meeting.list")
    registry.set_id_source("event_id", "schedule.event.list")
    registry.set_id_source("event_type_id", "schedule.event_type.list")
    app.include_router(router)
