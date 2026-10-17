"""Database-backed fixed-window rate limits (M01 §4)."""

import math
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from semestra.core.config import Settings
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
    call this before doing any other writes in the request.
    """
    key_hash = rate_limit_key(settings, f"{scope}:{key}")
    row = (
        await db.execute(
            select(AuthRateLimit).where(
                AuthRateLimit.scope == scope, AuthRateLimit.key_hash == key_hash
            )
        )
    ).scalar_one_or_none()
    if row is None:
        row = AuthRateLimit(scope=scope, key_hash=key_hash, attempts=0, window_started_at=now)
        db.add(row)
    elif row.blocked_until is not None and row.blocked_until > now:
        raise AppError(
            "common.rate_limited", 429, retry_after_seconds=_retry_after(row.blocked_until, now)
        )
    elif now - row.window_started_at >= window:
        row.attempts = 0
        row.window_started_at = now
        row.blocked_until = None

    row.attempts += 1
    exceeded = row.attempts > limit
    if exceeded:
        row.blocked_until = row.window_started_at + window
    await db.commit()
    if exceeded:
        assert row.blocked_until is not None
        raise AppError(
            "common.rate_limited", 429, retry_after_seconds=_retry_after(row.blocked_until, now)
        )
