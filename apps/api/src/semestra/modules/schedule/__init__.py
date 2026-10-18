"""M04 课表与日历: event types, class sections, one-off events, calendar aggregation, ICS."""

from fastapi import FastAPI

from semestra.modules.schedule import capabilities, models, subscribers  # noqa: F401
from semestra.modules.schedule.routes import router
from semestra.modules.schedule.settings import CalendarSettings
from semestra.modules.settings import register_settings

register_settings(
    namespace="calendar", schema=CalendarSettings, levels=("account", "program", "term")
)


def register(app: FastAPI) -> None:
    app.include_router(router)
