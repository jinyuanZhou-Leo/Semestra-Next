"""M08 导入中心与智能抽取: import drafts, review and commit; ICS, syllabus and timetable extraction.

Other modules (M09 LMS, M12 assistant) write into imports with `imports.session.create` and
`imports.item.add_many`, and hook into the commit with `register_commit_hook`.
"""

from datetime import timedelta

from fastapi import FastAPI

from semestra.core.context import Ctx
from semestra.core.jobs import periodic
from semestra.modules.imports import (  # noqa: F401
    capabilities,
    jobs,
    models,
    portability,
    subscribers,
)
from semestra.modules.imports.service import CommitHook, cleanup, register_commit_hook

__all__ = ["CommitHook", "register", "register_commit_hook"]


@periodic("imports.cleanup", every=timedelta(hours=6))
async def _cleanup(ctx: Ctx) -> None:
    await cleanup(ctx)


def register(app: FastAPI) -> None:
    from semestra.core.uploads import BodyLimit
    from semestra.modules.imports.routes import UPLOAD_PATH, router, upload_limit

    app.add_middleware(BodyLimit, path=UPLOAD_PATH, limit=upload_limit)
    app.include_router(router)
