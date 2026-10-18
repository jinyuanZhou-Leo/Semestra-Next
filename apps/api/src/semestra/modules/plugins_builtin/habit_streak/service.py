from datetime import date, timedelta
from typing import Any

from sqlalchemy import delete, func, select

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules.academics import service as academics
from semestra.modules.plugins_builtin import instances
from semestra.modules.plugins_builtin.habit_streak import streak
from semestra.modules.plugins_builtin.habit_streak.models import HabitCheckin
from semestra.modules.plugins_builtin.habit_streak.schemas import (
    BACKFILL_DAYS,
    CARD_IDS,
    DEFAULT_GOAL,
    DEFAULT_WEEKLY_TARGET,
    MAX_LIST_DAYS,
    CheckinList,
    CheckinToggleResult,
    HabitStats,
)


async def _habit(ctx: Ctx, instance_id: str) -> tuple[instances.CardInstance, date]:
    """The habit card and today in its Program's time zone."""
    instance = await instances.get_card_instance(ctx, instance_id, card_ids=CARD_IDS)
    program = await instances.instance_program(ctx, instance)
    return instance, academics.program_today(ctx, program)


async def _days(ctx: Ctx, instance_id: str) -> set[date]:
    rows = await ctx.db.scalars(
        select(HabitCheckin.day).where(
            HabitCheckin.user_id == ctx.user_id, HabitCheckin.instance_id == instance_id
        )
    )
    return set(rows)


def _goal(settings: dict[str, Any]) -> tuple[str, int]:
    goal = "weekly" if settings.get("goal", DEFAULT_GOAL) == "weekly" else "daily"
    target = settings.get("weekly_target", DEFAULT_WEEKLY_TARGET)
    if not isinstance(target, int) or isinstance(target, bool) or not 1 <= target <= 7:
        target = DEFAULT_WEEKLY_TARGET
    return goal, target


async def _stats(
    ctx: Ctx, instance: instances.CardInstance, today: date, days: set[date]
) -> HabitStats:
    goal, target = _goal(instance.settings)
    week_start = await academics.week_start(ctx)
    if goal == "weekly":
        current, longest = streak.weekly_streaks(days, today, target, week_start)
        done = streak.week_count(days, today, week_start)
    else:
        current, longest = streak.daily_streaks(days, today)
        done = 1 if today in days else 0
    return HabitStats(
        goal="weekly" if goal == "weekly" else "daily",
        weekly_target=target,
        current_streak=current,
        longest_streak=longest,
        total=len(days),
        period_done=done,
        period_target=target if goal == "weekly" else 1,
        today=today,
        week_start=week_start,
        checked_today=today in days,
    )


async def stats(ctx: Ctx, instance_id: str) -> HabitStats:
    instance, today = await _habit(ctx, instance_id)
    return await _stats(ctx, instance, today, await _days(ctx, instance_id))


async def list_checkins(ctx: Ctx, instance_id: str, from_date: date, to_date: date) -> CheckinList:
    await _habit(ctx, instance_id)
    if to_date < from_date or (to_date - from_date).days >= MAX_LIST_DAYS:
        raise AppError("habit.range_invalid", 422, max_days=MAX_LIST_DAYS)
    rows = await ctx.db.scalars(
        select(HabitCheckin.day)
        .where(
            HabitCheckin.user_id == ctx.user_id,
            HabitCheckin.instance_id == instance_id,
            HabitCheckin.day >= from_date,
            HabitCheckin.day <= to_date,
        )
        .order_by(HabitCheckin.day)
    )
    return CheckinList(items=list(rows))


async def toggle(ctx: Ctx, instance_id: str, day: date) -> CheckinToggleResult:
    instance, today = await _habit(ctx, instance_id)
    earliest = today - timedelta(days=BACKFILL_DAYS)
    if not earliest <= day <= today:
        raise AppError("habit.date_out_of_range", 422, earliest=earliest.isoformat())
    existing = await ctx.db.scalar(
        select(HabitCheckin).where(
            HabitCheckin.user_id == ctx.user_id,
            HabitCheckin.instance_id == instance_id,
            HabitCheckin.day == day,
        )
    )
    if existing is not None:
        await ctx.db.delete(existing)
    else:
        ctx.db.add(HabitCheckin(user_id=ctx.user_id, instance_id=instance_id, day=day))
    await ctx.db.flush()
    return CheckinToggleResult(
        date=day,
        checked=existing is None,
        stats=await _stats(ctx, instance, today, await _days(ctx, instance_id)),
    )


async def delete_for_instance(ctx: Ctx, user_id: str, instance_id: str) -> None:
    await ctx.db.execute(
        delete(HabitCheckin).where(
            HabitCheckin.user_id == user_id, HabitCheckin.instance_id == instance_id
        )
    )


async def purge(ctx: Ctx, user_id: str) -> None:
    """All of the user's check-ins (plugin uninstalled with its data, or account deletion)."""
    await ctx.db.execute(delete(HabitCheckin).where(HabitCheckin.user_id == user_id))


async def count(ctx: Ctx, user_id: str) -> int:
    return (
        await ctx.db.scalar(
            select(func.count()).select_from(HabitCheckin).where(HabitCheckin.user_id == user_id)
        )
    ) or 0
