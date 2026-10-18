from semestra.core.capability import Http, capability
from semestra.core.context import Ctx
from semestra.modules.plugins_builtin.habit_streak import service
from semestra.modules.plugins_builtin.habit_streak.schemas import (
    PLUGIN_ID,
    CheckinList,
    CheckinListInput,
    CheckinToggleInput,
    CheckinToggleResult,
    HabitStats,
    StatsInput,
)

TAGS = ("habit",)


@capability(
    name="habit.checkin.toggle",
    summary="Check or uncheck a habit for a day (today or the past 7 days).",
    description="""Use when the user says they did a habit ("check in my reading habit"). Find the
instance_id with layouts.board.get (the habit card of the course, term, Program or today board).
Calling it on a day that is already checked removes the check-in, so read habit.checkins.list
first when the user only wants it checked. Days older than 7 days or in the future are refused.""",
    effect="write",
    http=Http("POST", "/habit/instances/{instance_id}/checkins/toggle"),
    tags=TAGS,
    plugin_id=PLUGIN_ID,
)
async def checkin_toggle(ctx: Ctx, inp: CheckinToggleInput) -> CheckinToggleResult:
    return await service.toggle(ctx, inp.instance_id, inp.date)


@capability(
    name="habit.checkins.list",
    summary="List the checked days of a habit within a date range.",
    description="""Use to see which days a habit was done. The range is at most 400 days and in the
Program's time zone.""",
    effect="read",
    http=Http("GET", "/habit/instances/{instance_id}/checkins"),
    tags=TAGS,
    plugin_id=PLUGIN_ID,
)
async def checkins_list(ctx: Ctx, inp: CheckinListInput) -> CheckinList:
    return await service.list_checkins(ctx, inp.instance_id, inp.from_date, inp.to_date)


@capability(
    name="habit.stats",
    summary="Current streak, longest streak and total check-ins of a habit.",
    description="""Use to answer how long the user's streak is or how often they did a habit. For a
weekly goal the streaks count weeks that reached the weekly target; a streak stays alive while
the running day (or week) is still open. Also returns today's date in the Program's time zone.""",
    effect="read",
    http=Http("GET", "/habit/instances/{instance_id}/stats"),
    tags=TAGS,
    plugin_id=PLUGIN_ID,
)
async def stats(ctx: Ctx, inp: StatsInput) -> HabitStats:
    return await service.stats(ctx, inp.instance_id)
