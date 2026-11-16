"""CalDAV for to-do lists (M05 §11): Apple Reminders and other to-do apps sync a Program's lists
both ways. Offered when `SEMESTRA_CALDAV` is on (self-hosting)."""

from fastapi import FastAPI

from semestra.modules.caldav import capabilities, models, portability  # noqa: F401  (registers)
from semestra.modules.caldav.routes import router


def register(app: FastAPI) -> None:
    app.include_router(router)
