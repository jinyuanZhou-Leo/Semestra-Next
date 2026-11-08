"""M18 通知: Web Push to the user's browsers for reminders and things that need them.

Other modules publish their usual events; `subscribers.py` turns the ones worth a notification
into pushes, and `reminders.py` plans reminders from the calendar (M04)."""

from fastapi import FastAPI

from semestra.modules.notifications import (  # noqa: F401  (registers on import)
    capabilities,
    reminders,
    subscribers,
    watch,
)
from semestra.modules.notifications.routes import router
from semestra.modules.notifications.settings import NotificationsSettings
from semestra.modules.settings import register_settings

register_settings(namespace="notifications", schema=NotificationsSettings, levels=("account",))


def register(app: FastAPI) -> None:
    app.include_router(router)
