import asyncio
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Literal

import structlog
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import text

from semestra.core import jobs, storage
from semestra.core.backup import backup_loop
from semestra.core.capability import mount_http
from semestra.core.config import Settings, get_settings
from semestra.core.db import make_engine, make_sessionmaker, utcnow
from semestra.core.errors import AppError, ErrorResponse, install_error_handlers
from semestra.core.http import close_shared_transports
from semestra.core.logging import configure_logging
from semestra.core.observability import init_sentry
from semestra.core.realtime import Broadcaster
from semestra.core.realtime import router as realtime_router
from semestra.core.webapp import install_web
from semestra.modules import register_all
from semestra.modules.ai.adapters import sdk
from semestra.modules.auth.avatar import UploadBodyLimit


class Health(BaseModel):
    status: Literal["ok"]


class Ready(BaseModel):
    status: Literal["ok"]
    database: Literal["ok"]
    # "off" when SEMESTRA_JOBS_AUTOSTART is false.
    worker: Literal["ok", "off"]


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level, json=settings.is_prod)
    init_sentry(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        engine = make_engine(settings)
        app.state.engine = engine
        app.state.session_factory = make_sessionmaker(engine)
        runner = jobs.JobRunner(app.state, settings.job_concurrency)
        app.state.jobs = runner
        if settings.jobs_autostart:
            runner.start()
        backup_task = asyncio.create_task(backup_loop(settings)) if settings.backup_dir else None
        warm_up = None
        if settings.ai_warm_up:
            warm_up = asyncio.create_task(asyncio.to_thread(sdk.warm_up))
        yield
        if backup_task:
            backup_task.cancel()
        if warm_up:
            await asyncio.gather(warm_up, return_exceptions=True)
        await runner.stop()
        # M06 writes usage and provider health in background tasks; let them land first.
        if (ai := getattr(app.state, "ai", None)) is not None:
            await ai.drain()
        await close_shared_transports()
        await engine.dispose()

    app = FastAPI(title="Semestra API", version="0.1.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.now = utcnow  # tests replace this clock
    app.state.realtime = Broadcaster()
    app.state.storage = storage.LocalStorage(settings.storage_local_root)

    app.add_middleware(UploadBodyLimit)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def request_context(  # pyright: ignore[reportUnusedFunction]
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        request_id = request.headers.get("x-request-id") or str(uuid.uuid7())
        request.state.request_id = request_id
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(request_id=request_id)
        response = await call_next(request)
        response.headers["x-request-id"] = request_id
        return response

    install_error_handlers(app)

    @app.get("/healthz", operation_id="healthz", response_model=Health)
    async def healthz() -> Health:  # pyright: ignore[reportUnusedFunction]
        return Health(status="ok")

    @app.get(
        "/readyz",
        operation_id="readyz",
        response_model=Ready,
        responses={503: {"model": ErrorResponse}},
    )
    async def readyz(request: Request) -> Ready:  # pyright: ignore[reportUnusedFunction]
        async with request.app.state.session_factory() as session:
            await session.execute(text("SELECT 1"))
        runner: jobs.JobRunner = request.app.state.jobs
        if settings.jobs_autostart and not runner.running:
            raise AppError("common.unavailable", 503, component="worker")
        return Ready(status="ok", database="ok", worker="ok" if runner.running else "off")

    app.include_router(realtime_router)
    register_all(app)
    mount_http(app)

    # Keep last: the SPA catch-all must come after every API route.
    if settings.serve_web:
        install_web(app, settings.web_dist_dir)

    return app
