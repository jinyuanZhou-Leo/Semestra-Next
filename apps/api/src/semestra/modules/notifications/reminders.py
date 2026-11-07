"""Reminders (M18 §4): classes, one-off events, to-dos with a due time, and the daily summary.

Planning reads the calendar (M04 sources) for the next `HORIZON` and stores one row per reminder;
it runs when the calendar or the settings change and every few hours to move the horizon on. A
minute tick sends the rows that are due. Only users with at least one device are planned."""

from collections import defaultdict
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

import structlog
from sqlalchemy import delete, select, update
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from starlette.datastructures import State

from semestra.core.context import Ctx, system_ctx
from semestra.core.jobs import periodic
from semestra.modules.academics import service as academics
from semestra.modules.academics.models import AcademicsProgram
from semestra.modules.notifications import service, texts
from semestra.modules.notifications.models import NotificationsDevice, NotificationsReminder
from semestra.modules.notifications.settings import NotificationsSettings
from semestra.modules.schedule.calendar import Occurrence, OccurrenceQuery, collect
from semestra.modules.settings import service as settings_service

log = structlog.get_logger()

# Must cover the replanning period plus the longest lead (a day): see `replan_all`.
HORIZON = timedelta(hours=36)
REPLAN_EVERY = timedelta(hours=6)
# A reminder the tick missed by more than this (the server was down) is dropped, not sent late.
STALE = timedelta(minutes=15)

_SOURCES = ("schedule.meetings", "schedule.events", "tasks.due", "grading.assessments")
# Occurrence kind → (reminder kind, setting holding its lead in minutes).
_LEADS = {
    "class": ("class", "class_reminder"),
    "event": ("event", "event_reminder"),
    "task": ("task", "task_reminder"),
    "deadline": ("task", "task_reminder"),
}

_DIGEST_GROUP = {"class": "classes", "event": "events", "task": "tasks", "deadline": "tasks"}


def _lead(cfg: NotificationsSettings, setting: str) -> int | None:
    value = getattr(cfg, setting)
    return None if value == "off" else int(value)


def _wanted(o: Occurrence) -> bool:
    return not o.all_day and o.status not in ("cancelled", "done")


async def plan(ctx: Ctx, program_ids: list[str] | None = None) -> None:
    """Replaces the pending reminders of the ctx user (of `program_ids`, or all Programs)."""
    stale = delete(NotificationsReminder).where(
        NotificationsReminder.user_id == ctx.user_id, NotificationsReminder.status == "pending"
    )
    if program_ids is not None:
        stale = stale.where(NotificationsReminder.program_id.in_(program_ids))
    await ctx.db.execute(stale)
    # Sent and skipped rows only guard against repeats until their occurrence is past.
    await ctx.db.execute(
        delete(NotificationsReminder).where(
            NotificationsReminder.user_id == ctx.user_id,
            NotificationsReminder.expires_at < ctx.now,
        )
    )
    if not await service.has_devices(ctx):
        return
    cfg = await service.settings_of(ctx)
    leads = {kind: _lead(cfg, setting) for kind, (_, setting) in _LEADS.items()}
    kinds = [kind for kind, lead in leads.items() if lead is not None]
    for program in await academics.program_rows(ctx):
        if program_ids is not None and program.id not in program_ids:
            continue
        rows: list[dict[str, object]] = []
        if kinds:
            q = OccurrenceQuery(program.id, ctx.now, ctx.now + HORIZON)
            for o in await collect(ctx, q, _SOURCES, kinds):  # pyright: ignore[reportArgumentType]
                lead = leads[o.kind]
                if lead is None or not _wanted(o):
                    continue
                fire_at = o.start_at - timedelta(minutes=lead)
                if fire_at < ctx.now:
                    continue
                rows.append(
                    {
                        "key": f"{o.id}:{lead}",
                        "kind": _LEADS[o.kind][0],
                        "fire_at": fire_at,
                        "expires_at": o.start_at,
                        "params": {
                            "title": o.title,
                            "start_at": o.start_at.isoformat(),
                            "location": o.location,
                            "lead": lead,
                        },
                    }
                )
        digest = _digest_row(ctx, program, cfg)
        if digest is not None:
            rows.append(digest)
        if rows:
            await ctx.db.execute(
                sqlite_insert(NotificationsReminder)
                .values([{"user_id": ctx.user_id, "program_id": program.id, **row} for row in rows])
                .on_conflict_do_nothing(index_elements=["user_id", "key"])
            )


def _digest_row(
    ctx: Ctx, program: AcademicsProgram, cfg: NotificationsSettings
) -> dict[str, object] | None:
    if cfg.daily_digest == "off":
        return None
    zone = ZoneInfo(program.timezone)
    local = ctx.now.astimezone(zone)
    at = datetime.combine(local.date(), time(int(cfg.daily_digest)), tzinfo=zone)
    if at < local:
        at += timedelta(days=1)
    if at - local > HORIZON:
        return None
    day = at.date()
    return {
        "key": f"digest:{program.id}:{day.isoformat()}",
        "kind": "digest",
        "fire_at": at.astimezone(ctx.now.tzinfo),
        "expires_at": datetime.combine(day + timedelta(days=1), time(), tzinfo=zone),
        "params": {"day": day.isoformat()},
    }


# --- sending --------------------------------------------------------------------------------


async def _message(ctx: Ctx, row: NotificationsReminder) -> service.Message | None:
    """What to send for a due row; None when there is nothing worth saying."""
    program = await ctx.db.get(AcademicsProgram, row.program_id)
    if program is None:
        return None
    zone = ZoneInfo(program.timezone)
    prefs = await settings_service.get_preferences(ctx)
    locale = ctx.user.locale if ctx.user and ctx.user.locale else ctx.locale
    if row.kind == "digest":
        return await _digest(ctx, program, zone, locale)
    p = row.params
    start = datetime.fromisoformat(p["start_at"]).astimezone(zone)
    lead = int(p["lead"])
    when = texts.clock(start, locale, prefs.time_format)
    page = "tasks" if row.kind == "task" else "today"
    return service.Message(
        kind=f"{row.kind}_{'now' if lead == 0 else 'soon'}",
        params={
            "title": p["title"],
            "lead": texts.lead(locale, lead),
            "details": texts.details(locale, when, p.get("location")),
        },
        url=f"/p/{program.id}/{page}",
        hidden_only=False,
        tag=row.key,
        urgency="high",
    )


async def _digest(
    ctx: Ctx, program: AcademicsProgram, zone: ZoneInfo, locale: str
) -> service.Message | None:
    local = ctx.now.astimezone(zone)
    start = datetime.combine(local.date(), time(), tzinfo=zone)
    q = OccurrenceQuery(program.id, start, start + timedelta(days=1))
    items = [
        o
        for o in await collect(ctx, q, _SOURCES)
        if o.status not in ("cancelled", "done") and (o.all_day or o.start_at >= ctx.now)
    ]
    counts = defaultdict[str, int](int)
    for o in items:
        counts[_DIGEST_GROUP[o.kind]] += 1
    parts = [texts.count(locale, k, counts[k]) for k in ("classes", "events", "tasks") if counts[k]]
    if not parts:
        return None
    return service.Message(
        kind="digest",
        params={"summary": texts.word(locale, "join").join(parts)},
        url=f"/p/{program.id}/today",
        hidden_only=False,
        tag=f"digest:{program.id}",
    )


async def send_due(state: State) -> None:
    """The minute tick: sends what is due, user by user, each in its own transaction."""
    async with system_ctx(state) as ctx:
        now = ctx.now
        await ctx.db.execute(
            update(NotificationsReminder)
            .where(
                NotificationsReminder.status == "pending",
                NotificationsReminder.fire_at < now - STALE,
            )
            .values(status="skipped")
        )
        due = (
            await ctx.db.execute(
                select(NotificationsReminder.user_id, NotificationsReminder.id)
                .where(
                    NotificationsReminder.status == "pending",
                    NotificationsReminder.fire_at <= now,
                )
                .order_by(NotificationsReminder.fire_at)
            )
        ).all()
        await ctx.db.commit()
    by_user = defaultdict[str, list[str]](list)
    for user_id, row_id in due:
        by_user[user_id].append(row_id)
    for user_id, ids in by_user.items():
        try:
            await _send_for(state, user_id, ids)
        except Exception:
            log.exception("reminders_failed", user_id=user_id)


async def _send_for(state: State, user_id: str, ids: list[str]) -> None:
    async with system_ctx(state, user_id) as ctx:
        rows = (
            await ctx.db.scalars(
                select(NotificationsReminder).where(
                    NotificationsReminder.id.in_(ids), NotificationsReminder.status == "pending"
                )
            )
        ).all()
        if ctx.user is None:
            return
        cfg = await service.settings_of(ctx)
        quiet = service.in_quiet_hours(cfg, ctx.now.astimezone(await service.zone_of(ctx)))
        for row in rows:
            # Claimed before the push, so a slow push service cannot make the next tick repeat it.
            row.status = "skipped" if quiet else "sent"
        await ctx.db.commit()
        if quiet:
            return
        for row in rows:
            message = await _message(ctx, row)
            if message is not None:
                await service.deliver(ctx, message)
        await ctx.db.commit()


@periodic("notifications.reminders.send", every=timedelta(minutes=1))
async def _tick(ctx: Ctx) -> None:
    await send_due(ctx.state)


async def replan_user(state: State, user_id: str, program_ids: list[str] | None = None) -> None:
    async with system_ctx(state, user_id) as ctx:
        if ctx.user is None:
            return
        await plan(ctx, program_ids)
        await ctx.db.commit()


@periodic("notifications.reminders.plan", every=REPLAN_EVERY, first_after=timedelta(minutes=2))
async def replan_all(ctx: Ctx) -> None:
    """Moves every horizon on. A reminder is planned at least `HORIZON - REPLAN_EVERY` (30 h)
    before its occurrence, which covers the longest lead (1 day)."""
    users = (await ctx.db.scalars(select(NotificationsDevice.user_id).distinct())).all()
    for user_id in users:
        try:
            await replan_user(ctx.state, user_id)
        except Exception:
            log.exception("reminders_plan_failed", user_id=user_id)
