"""M09 LMS 集成: LMS connections through providers (Canvas for now), Program bindings, course
links, imports through M08, the background course sync, the `lms.events` calendar source and a
platform-neutral read API.

A new platform is a new provider (`providers/`, registered with `register_lms_provider`); the
module, its tables and its UI stay as they are.
"""

from datetime import timedelta

from fastapi import FastAPI

from semestra.core.context import Ctx
from semestra.core.jobs import periodic
from semestra.modules.academics.service import register_course_source
from semestra.modules.lms import (  # noqa: F401  (registers on import)
    agent_tools,
    calendar,
    capabilities,
    imports,
    labels,
    models,
    portability,
    reads,
    subscribers,
    sync,
    sync_assignments,
    sync_stages,
)
from semestra.modules.lms.cache import purge_expired, runtime
from semestra.modules.lms.providers import register_lms_provider
from semestra.modules.lms.providers.canvas import CanvasProvider
from semestra.modules.lms.service import linked_course_ids
from semestra.modules.lms.settings import LmsSettings, offered
from semestra.modules.lms.sync_status import forget_old_changes
from semestra.modules.settings import register_settings

register_lms_provider(CanvasProvider())
register_course_source("lms", linked_course_ids)
# Allowing writes widens what Sem and MCP clients may do on the platform: only the user flips it.
# The sync intervals offered stop at the server's lower bound (`SEMESTRA_LMS_SYNC_MIN_INTERVAL`).
register_settings(
    namespace="lms",
    schema=LmsSettings,
    levels=("account",),
    agent_writable=False,
    adapt=offered,
)


@periodic("lms.cleanup", every=timedelta(hours=6))
async def _cleanup(ctx: Ctx) -> None:
    await purge_expired(ctx)
    await forget_old_changes(ctx)


def register(app: FastAPI) -> None:
    from semestra.modules.lms.routes import router

    runtime(app.state)
    app.include_router(router)
