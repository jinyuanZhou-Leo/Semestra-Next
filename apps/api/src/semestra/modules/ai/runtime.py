"""Bookkeeping that must survive the caller's transaction: usage events and provider health.

A model call is often made inside a request or job that later fails and rolls back, and a failed
call is exactly what the usage log and the "invalid key" flag must still show. So these writes go
through their own session, in a background task (a caller may still hold SQLite's write lock while
it waits for the model). Tests call `drain()` to wait for them.
"""

import asyncio
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

import structlog
from sqlalchemy import update
from sqlalchemy.exc import OperationalError
from starlette.datastructures import State

from semestra.modules.ai.adapters.base import ModelInfo
from semestra.modules.ai.models import AiProvider, AiUsageEvent

log = structlog.get_logger()

WRITE_ATTEMPTS = 3
MODELS_CACHE_TTL = timedelta(hours=1)


@dataclass(frozen=True)
class _CachedModels:
    fetched_at: datetime
    models: list[ModelInfo]


class AiRuntime:
    def __init__(self) -> None:
        self._tasks: set[asyncio.Task[None]] = set()
        # (provider id, provider updated_at) → listed models; a changed key or URL misses.
        self._models: dict[tuple[str, str], _CachedModels] = {}

    def _spawn(self, state: State, write: Any) -> None:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:  # e.g. a stream garbage-collected after the loop stopped
            log.warning("ai_bookkeeping_skipped")
            return
        task = loop.create_task(self._write(state, write))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _write(self, state: State, write: Any) -> None:
        for attempt in range(WRITE_ATTEMPTS):
            try:
                async with state.session_factory() as db:
                    await write(db)
                    await db.commit()
                return
            except OperationalError:  # database locked: the caller still holds the write lock
                if attempt == WRITE_ATTEMPTS - 1:
                    log.warning("ai_bookkeeping_write_failed")
                    return
                await asyncio.sleep(0.5 * (attempt + 1))
            except Exception:
                log.exception("ai_bookkeeping_write_failed")
                return

    def record_usage(self, state: State, event: AiUsageEvent) -> None:
        async def write(db: Any) -> None:
            db.add(event)

        self._spawn(state, write)

    def mark_provider(
        self, state: State, provider_id: str, *, error_code: str | None, checked_at: datetime
    ) -> None:
        """Remembers the outcome of the last call for the provider card (`ai.invalid_key`, ...)."""

        async def write(db: Any) -> None:
            await db.execute(
                update(AiProvider)
                .where(AiProvider.id == provider_id)
                .values(last_error_code=error_code, last_checked_at=checked_at)
                .execution_options(synchronize_session=False)
            )

        self._spawn(state, write)

    async def drain(self) -> None:
        while self._tasks:
            await asyncio.gather(*list(self._tasks), return_exceptions=True)

    def cached_models(self, key: tuple[str, str], now: datetime) -> list[ModelInfo] | None:
        entry = self._models.get(key)
        if entry is None or now - entry.fetched_at > MODELS_CACHE_TTL:
            return None
        return entry.models

    def cache_models(self, key: tuple[str, str], now: datetime, models: list[ModelInfo]) -> None:
        self._models[key] = _CachedModels(now, models)


def runtime(state: State) -> AiRuntime:
    return state.ai
