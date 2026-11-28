"""The monthly usage limit (M06 §7.1): an estimated cost after which background calls pause.

The user sets an amount in US dollars, or none (no limit, the default). What counts is the
estimated cost of this calendar month's calls in the user's own time zone
(`academics.zone.home_zone`); models without a known price and the models this server runs itself
cost nothing, so they neither count nor stop. Once the month's cost reaches the limit, calls made
with `background=True` (work no one asked for just now: files a sync brings, rebuilding the search
index, Auto Dream, rewording Sem's suggested questions) raise `ai.usage_limit_reached`; what the
user starts themselves still runs. The next month they run again by themselves: each of them is
retried on its own schedule.
"""

from dataclasses import dataclass
from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules.ai.models import AiUsageEvent
from semestra.modules.ai.schemas import UsageLimit
from semestra.modules.settings import register_settings
from semestra.modules.settings import service as settings_service

NAMESPACE = "ai.usage"


class UsageSettings(BaseModel):
    monthly_limit_usd: float | None = Field(default=None, gt=0)


# Sem and MCP clients must not raise the limit on the user's money.
register_settings(
    namespace=NAMESPACE, schema=UsageSettings, levels=("account",), agent_writable=False
)


@dataclass(frozen=True)
class _Month:
    start: datetime  # UTC
    end: datetime  # UTC, exclusive
    next_first: date  # the next month's first day, in the user's time zone


def _month(now: datetime, zone: ZoneInfo) -> _Month:
    local = now.astimezone(zone)
    first = local.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    following = (
        first.replace(year=first.year + 1, month=1)
        if first.month == 12
        else (first.replace(month=first.month + 1))
    )
    return _Month(first.astimezone(UTC), following.astimezone(UTC), following.date())


async def _limit(ctx: Ctx) -> float | None:
    values = await settings_service.get_values(ctx, NAMESPACE, "account", None)
    return UsageSettings.model_validate(values.values).monthly_limit_usd


async def _zone(ctx: Ctx) -> ZoneInfo:
    from semestra.modules.academics.zone import home_zone

    return await home_zone(ctx)


async def _spent(db: AsyncSession, user_id: str, month: _Month) -> float:
    total = await db.scalar(
        select(func.sum(AiUsageEvent.cost_usd_estimate)).where(
            AiUsageEvent.user_id == user_id,
            AiUsageEvent.created_at >= month.start,
            AiUsageEvent.created_at < month.end,
        )
    )
    return round(float(total or 0.0), 6)


async def state(ctx: Ctx) -> UsageLimit:
    """This month's limit, estimated cost so far, whether background calls are paused, and the
    day they run again."""
    assert ctx.user_id is not None
    month = _month(ctx.now, await _zone(ctx))
    limit = await _limit(ctx)
    spent = await _spent(ctx.db, ctx.user_id, month)
    return UsageLimit(
        monthly_limit_usd=limit,
        spent_usd=spent,
        reached=limit is not None and spent >= limit,
        resets_on=month.next_first,
    )


async def check_background(ctx: Ctx) -> None:
    """Raises `ai.usage_limit_reached` when this month's cost has reached the user's limit."""
    if ctx.user_id is None or (limit := await _limit(ctx)) is None:
        return
    month = _month(ctx.now, await _zone(ctx))
    if await _spent(ctx.db, ctx.user_id, month) >= limit:
        raise AppError("ai.usage_limit_reached", 429)


async def crossed(ctx: Ctx, cost: float, at: datetime) -> bool:
    """Whether a saved call that cost `cost` at `at` took the user's month to the limit."""
    limit = await _limit(ctx)
    if limit is None or ctx.user_id is None:
        return False
    spent = await _spent(ctx.db, ctx.user_id, _month(at, await _zone(ctx)))
    return spent - cost < limit <= spent
