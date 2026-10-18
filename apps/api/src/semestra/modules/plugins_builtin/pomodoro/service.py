from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules.academics import service as academics
from semestra.modules.plugins_builtin import instances
from semestra.modules.plugins_builtin.pomodoro.models import PomodoroSession
from semestra.modules.plugins_builtin.pomodoro.schemas import (
    CARD_IDS,
    DEFAULT_STATS_DAYS,
    MAX_STATS_DAYS,
    CourseFocus,
    DayFocus,
    PomodoroStats,
    SessionRecorded,
    SessionRecordInput,
    StatsInput,
)
from semestra.modules.settings import service as settings_service

# Clocks of browsers drift a little; a session may end this far in the future.
CLOCK_SKEW = timedelta(seconds=120)


async def record(ctx: Ctx, inp: SessionRecordInput) -> SessionRecorded:
    """Store a finished session. Recording the same session twice (two tabs) is harmless."""
    await instances.get_card_instance(ctx, inp.instance_id, card_ids=CARD_IDS)
    started, ended = inp.started_at, inp.ended_at
    if started.tzinfo is None or ended.tzinfo is None:
        raise AppError("pomodoro.session_invalid", 422)
    started, ended = started.astimezone(UTC), ended.astimezone(UTC)
    elapsed = (ended - started).total_seconds()
    if elapsed <= 0 or inp.duration_sec > elapsed + 2 or ended > ctx.now + CLOCK_SKEW:
        raise AppError("pomodoro.session_invalid", 422)
    if inp.course_id is not None:
        await academics.get_course_row(ctx, inp.course_id)

    async def existing() -> PomodoroSession | None:
        return await ctx.db.scalar(
            select(PomodoroSession).where(
                PomodoroSession.user_id == ctx.user_id,
                PomodoroSession.instance_id == inp.instance_id,
                PomodoroSession.started_at == started,
            )
        )

    if found := await existing():
        return SessionRecorded(id=found.id, duplicate=True)
    row = PomodoroSession(
        user_id=ctx.user_id,
        instance_id=inp.instance_id,
        course_id=inp.course_id,
        started_at=started,
        ended_at=ended,
        duration_sec=inp.duration_sec,
        mode=inp.mode,
    )
    try:
        async with ctx.db.begin_nested():
            ctx.db.add(row)
    except IntegrityError:  # two tabs recorded the same session at once
        if found := await existing():
            return SessionRecorded(id=found.id, duplicate=True)
        raise
    return SessionRecorded(id=row.id, duplicate=False)


async def _timezone(ctx: Ctx, program_id: str | None) -> str:
    """The zone that defines days: the given Program, else the active or first one, else UTC."""
    if program_id is None:
        program_id = (await settings_service.get_preferences(ctx)).active_program_id
    if program_id is not None:
        try:
            return (await academics.get_program_row(ctx, program_id)).timezone
        except AppError:
            pass  # a stale active Program: use the first one
    programs = await academics.list_programs(ctx)
    return programs[0].timezone if programs else "UTC"


async def stats(ctx: Ctx, inp: StatsInput) -> PomodoroStats:
    if inp.program_id is not None:
        await academics.get_program_row(ctx, inp.program_id)
    program_id = inp.program_id
    if inp.course_id is not None:
        # Days of a course's statistics follow the zone of the Program the course belongs to.
        course = await academics.get_course_row(ctx, inp.course_id)
        program_id = program_id or course.program_id
    tz_name = await _timezone(ctx, program_id)
    zone = ZoneInfo(tz_name)
    today = ctx.now.astimezone(zone).date()
    to_date = inp.to_date or today
    from_date = inp.from_date or to_date - timedelta(days=DEFAULT_STATS_DAYS - 1)
    if to_date < from_date or (to_date - from_date).days >= MAX_STATS_DAYS:
        raise AppError("pomodoro.range_invalid", 422, max_days=MAX_STATS_DAYS)

    start = datetime.combine(from_date, time.min, zone).astimezone(UTC)
    end = datetime.combine(to_date + timedelta(days=1), time.min, zone).astimezone(UTC)
    query = select(PomodoroSession).where(
        PomodoroSession.user_id == ctx.user_id,
        PomodoroSession.mode == "focus",
        PomodoroSession.ended_at >= start,
        PomodoroSession.ended_at < end,
    )
    if inp.course_id is not None:
        query = query.where(PomodoroSession.course_id == inp.course_id)

    per_day: dict[date, list[int]] = {}
    per_course: dict[str | None, list[int]] = {}
    for row in await ctx.db.scalars(query):
        day = row.ended_at.astimezone(zone).date()
        for bucket, key in ((per_day, day), (per_course, row.course_id)):
            entry = bucket.setdefault(key, [0, 0])  # pyright: ignore[reportArgumentType]
            entry[0] += row.duration_sec
            entry[1] += 1
    return PomodoroStats(
        from_date=from_date,
        to_date=to_date,
        today=today,
        timezone=tz_name,
        total_focus_sec=sum(v[0] for v in per_day.values()),
        total_sessions=sum(v[1] for v in per_day.values()),
        days=[DayFocus(date=d, focus_sec=v[0], sessions=v[1]) for d, v in sorted(per_day.items())],
        by_course=[
            CourseFocus(course_id=c, focus_sec=v[0], sessions=v[1])
            for c, v in sorted(per_course.items(), key=lambda kv: (-kv[1][0], kv[0] or ""))
        ],
    )


async def purge(ctx: Ctx, user_id: str) -> None:
    await ctx.db.execute(delete(PomodoroSession).where(PomodoroSession.user_id == user_id))
