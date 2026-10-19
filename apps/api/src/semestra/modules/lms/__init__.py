"""M09 LMS 集成: LMS connections through providers (Canvas for now), Program bindings, course
links, imports through M08, the `lms.events` calendar source and a platform-neutral read API.

A new platform is a new provider (`providers/`, registered with `register_lms_provider`); the
module, its tables and its UI stay as they are.
"""

from datetime import timedelta

from fastapi import FastAPI

from semestra.core.context import Ctx
from semestra.core.jobs import periodic
from semestra.modules.lms import (  # noqa: F401  (registers on import)
    calendar,
    capabilities,
    imports,
    models,
    portability,
    subscribers,
)
from semestra.modules.lms.cache import purge_expired, runtime
from semestra.modules.lms.providers import register_lms_provider
from semestra.modules.lms.providers.canvas import CanvasProvider
from semestra.modules.lms.service import refresh_all

register_lms_provider(CanvasProvider())


@periodic("lms.refresh_status", every=timedelta(hours=6))
async def _refresh_status(ctx: Ctx) -> None:
    await refresh_all(ctx)
    await purge_expired(ctx)


def register(app: FastAPI) -> None:
    from semestra.modules.lms.routes import router

    runtime(app.state)
    app.include_router(router)
