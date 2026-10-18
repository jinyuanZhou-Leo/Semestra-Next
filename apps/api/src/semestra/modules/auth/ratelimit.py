"""Database-backed fixed-window rate limits (M01 §4)."""

import math
from datetime import datetime, timedelta

from sqlalchemy import update
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.ext.asyncio import AsyncSession

from semestra.core.config import Settings
from semestra.core.db import new_id
from semestra.core.errors import AppError
from semestra.modules.auth.crypto import rate_limit_key
from semestra.modules.auth.models import AuthRateLimit


def _retry_after(until: datetime, now: datetime) -> int:
    return max(1, math.ceil((until - now).total_seconds()))


async def hit(
    db: AsyncSession,
    settings: Settings,
    now: datetime,
    scope: str,
    key: str,
    *,
    limit: int,
    window: timedelta,
) -> None:
    """Counts one attempt for `(scope, key)` and raises `common.rate_limited` past `limit`.

    The counter is committed immediately (also when raising) so a failed request still counts;
    call this before doing any other writes in the request. Every step is a single atomic
    statement, so concurrent requests for one bucket are each counted and never collide.
    """
    key_hash = rate_limit_key(settings, f"{scope}:{key}")
    bucket = (AuthRateLimit.scope == scope) & (AuthRateLimit.key_hash == key_hash)

    # First sight of this bucket: insert it, or do nothing if a concurrent request already did.
    await db.execute(
        insert(AuthRateLimit)
        .values(id=new_id(), scope=scope, key_hash=key_hash, attempts=0, window_started_at=now)
        .on_conflict_do_nothing(index_elements=["scope", "key_hash"])
    )
    # An expired window starts over. Only one of several concurrent requests matches this.
    await db.execute(
        update(AuthRateLimit)
        .where(bucket, AuthRateLimit.window_started_at <= now - window)
        .values(attempts=0, window_started_at=now, blocked_until=None)
        .execution_options(synchronize_session=False)
    )
    row = (
        await db.execute(
            update(AuthRateLimit)
            .where(bucket)
            .values(attempts=AuthRateLimit.attempts + 1)
            .returning(
                AuthRateLimit.attempts, AuthRateLimit.window_started_at, AuthRateLimit.blocked_until
            )
            .execution_options(synchronize_session=False)
        )
    ).one()
    blocked_until = row.blocked_until
    if blocked_until is None and row.attempts > limit:
        blocked_until = row.window_started_at + window
        await db.execute(
            update(AuthRateLimit)
            .where(bucket)
            .values(blocked_until=blocked_until)
            .execution_options(synchronize_session=False)
        )
    await db.commit()
    if blocked_until is not None and blocked_until > now:
        raise AppError(
            "common.rate_limited", 429, retry_after_seconds=_retry_after(blocked_until, now)
        )
