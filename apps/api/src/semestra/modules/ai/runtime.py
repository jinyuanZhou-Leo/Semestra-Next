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
from sqlalchemy import or_, update
from sqlalchemy.exc import OperationalError
from starlette.datastructures import State

from semestra.modules.ai.adapters.base import Endpoint, ModelInfo
from semestra.modules.ai.adapters.limits import Gate, Limiters, no_gate
from semestra.modules.ai.models import AiProvider, AiUsageEvent

log = structlog.get_logger()

WRITE_ATTEMPTS = 3
MODELS_CACHE_TTL = timedelta(hours=1)
# How often an unchanged provider health is written again, so "last checked" stays roughly true.
HEALTH_REFRESH = timedelta(minutes=15)


@dataclass(frozen=True)
class _CachedModels:
    fetched_at: datetime
    models: list[ModelInfo]


class AiRuntime:
    def __init__(self) -> None:
        self._tasks: set[asyncio.Task[None]] = set()
        # (provider id, provider updated_at) → listed models; a changed key or URL misses.
        self._models: dict[tuple[str, str], _CachedModels] = {}
        # (base URL, provider id) → the most inputs its embeddings endpoint took in one request,
        # learnt from a refusal (`calls.embed`).
        self.embed_batch: dict[tuple[str, str | None], int] = {}
        self._limiters = Limiters()
        # provider id → the health `mark_provider` last decided to write (error code, checked at,
        # and a token telling that decision from an equal earlier one).
        self._health: dict[str, tuple[str | None, datetime, object]] = {}

    def gate(self, ep: Endpoint) -> Gate:
        """A slot of the endpoint's limit of requests at a time, for each request to it."""
        if ep.provider_id is None and ep.max_concurrency is None:
            return no_gate  # the instance provider, unless the server set a limit
        return self._limiters.gate(ep.base_url, ep.provider_id, ep.max_concurrency)

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
        """Remembers the outcome of calls for the provider card (`ai.invalid_key`, ...). Written
        only when it changes (or every `HEALTH_REFRESH`), not on every call, and without touching
        `updated_at` (which keys the model list cache). The writes run in the background in no
        set order, so one that a later outcome has replaced is skipped, and none replaces a check
        written later (a test of the provider)."""
        last = self._health.get(provider_id)
        if last is not None and last[0] == error_code and checked_at - last[1] < HEALTH_REFRESH:
            return
        token = object()
        self._health[provider_id] = (error_code, checked_at, token)

        def replaced() -> bool:
            latest = self._health.get(provider_id)
            return latest is not None and latest[2] is not token

        async def write(db: Any) -> None:
            if replaced():
                return
            await db.execute(
                update(AiProvider)
                .where(
                    AiProvider.id == provider_id,
                    or_(
                        AiProvider.last_checked_at.is_(None),
                        AiProvider.last_checked_at <= checked_at,
                    ),
                )
                .values(
                    last_error_code=error_code,
                    last_checked_at=checked_at,
                    updated_at=AiProvider.updated_at,  # not a change of the provider's settings
                )
                .execution_options(synchronize_session=False)
            )
            if replaced():  # while it waited for the write lock: the later outcome stands
                await db.rollback()

        self._spawn(state, write)

    def forget_provider(self, provider_id: str) -> None:
        """The provider's health was written elsewhere (a test, a new key): the next call writes
        its outcome again."""
        self._health.pop(provider_id, None)

    async def drain(self) -> None:
        # Unfinished ones only, as in `core.events.drain`: gathering finished tasks never yields.
        while running := [t for t in self._tasks if not t.done()]:
            await asyncio.gather(*running, return_exceptions=True)

    def cached_models(self, key: tuple[str, str], now: datetime) -> list[ModelInfo] | None:
        entry = self._models.get(key)
        if entry is None or now - entry.fetched_at > MODELS_CACHE_TTL:
            return None
        return entry.models

    def cache_models(self, key: tuple[str, str], now: datetime, models: list[ModelInfo]) -> None:
        self._models[key] = _CachedModels(now, models)


def runtime(state: State) -> AiRuntime:
    return state.ai
