import asyncio
from datetime import timedelta

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import select

from semestra.core.errors import AppError
from semestra.modules.auth import ratelimit
from semestra.modules.auth.models import AuthRateLimit
from semestra.testing import Clock


async def _hit(app: FastAPI, clock: Clock, limit: int = 100) -> None:
    async with app.state.session_factory() as db:
        await ratelimit.hit(
            db, app.state.settings, clock.now, "t", "k", limit=limit, window=timedelta(hours=1)
        )


async def test_concurrent_hits_on_a_new_bucket_are_all_counted(
    app: FastAPI, client: AsyncClient, clock: Clock
) -> None:
    del client  # starts the app lifespan
    await asyncio.gather(*(_hit(app, clock) for _ in range(8)))
    async with app.state.session_factory() as db:
        rows = (await db.execute(select(AuthRateLimit))).scalars().all()
    assert [r.attempts for r in rows] == [8]


async def test_the_limit_applies_and_the_window_resets(
    app: FastAPI, client: AsyncClient, clock: Clock
) -> None:
    del client
    for _ in range(3):
        await _hit(app, clock, limit=3)
    with pytest.raises(AppError) as blocked:
        await _hit(app, clock, limit=3)
    assert blocked.value.code == "common.rate_limited"
    clock.advance(minutes=61)
    await _hit(app, clock, limit=3)
