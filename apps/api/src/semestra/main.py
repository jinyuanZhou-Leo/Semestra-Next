import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Literal

import structlog
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import text

from semestra.core.capability import mount_http
from semestra.core.config import Settings, get_settings
from semestra.core.db import make_engine, make_sessionmaker, utcnow
from semestra.core.errors import ErrorResponse, install_error_handlers
from semestra.core.logging import configure_logging
from semestra.modules import register_all


class Health(BaseModel):
    status: Literal["ok"]


class Ready(BaseModel):
    status: Literal["ok"]
    database: Literal["ok"]


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level, json=settings.is_prod)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        engine = make_engine(settings)
        app.state.engine = engine
        app.state.session_factory = make_sessionmaker(engine)
        yield
        await engine.dispose()

    app = FastAPI(title="Semestra API", version="0.1.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.now = utcnow  # tests replace this clock

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
        return Ready(status="ok", database="ok")

    register_all(app)
    mount_http(app)
    return app
