"""M09 LMS 集成: LMS connections through providers (Canvas for now), Program bindings, course
links, imports through M08, the `lms.events` calendar source and a platform-neutral read API.

A new platform is a new provider (`providers/`, registered with `register_lms_provider`); the
module, its tables and its UI stay as they are.
"""

from datetime import timedelta

import structlog
from fastapi import FastAPI

from semestra.core.context import Ctx, run_as_system
from semestra.core.errors import AppError
from semestra.core.jobs import periodic
from semestra.modules.lms import (  # noqa: F401  (registers on import)
    calendar,
    capabilities,
    imports,
    labels,
    models,
    portability,
    reads,
    subscribers,
)
from semestra.modules.lms.cache import purge_expired, runtime
from semestra.modules.lms.providers import register_lms_provider
from semestra.modules.lms.providers.canvas import CanvasProvider
from semestra.modules.lms.service import refresh_all
from semestra.modules.lms.settings import LmsSettings, completes_submitted
from semestra.modules.lms.submissions import courses_to_check
from semestra.modules.settings import register_settings

register_lms_provider(CanvasProvider())
# Allowing writes widens what Sem and MCP clients may do on the platform: only the user flips it.
register_settings(namespace="lms", schema=LmsSettings, levels=("account",), agent_writable=False)


@periodic("lms.refresh_status", every=timedelta(hours=6))
async def _refresh_status(ctx: Ctx) -> None:
    await refresh_all(ctx)
    await purge_expired(ctx)


@periodic("lms.complete_submitted", every=timedelta(hours=1))
async def _complete_submitted(ctx: Ctx) -> None:
    """Reads the courses that still have imported assignments not handed in, so their to-dos
    follow the platform without the user opening anything (the read finishes them)."""
    for user_id, course_ids in (await courses_to_check(ctx)).items():

        async def read(sys: Ctx, course_ids: list[str] = course_ids) -> None:
            if not await completes_submitted(sys):
                return
            for course_id in course_ids:
                try:
                    await reads.raw_assignments(sys, course_id, refresh=False)
                except AppError:
                    continue  # unlinked meanwhile, or the connection needs attention

        try:
            await run_as_system(ctx.state, user_id, read)
        except Exception:
            # One user's broken connection must not stop the round.
            structlog.get_logger().exception("lms.complete_submitted_failed", user_id=user_id)


def register(app: FastAPI) -> None:
    from semestra.modules.lms.routes import router

    runtime(app.state)
    app.include_router(router)
