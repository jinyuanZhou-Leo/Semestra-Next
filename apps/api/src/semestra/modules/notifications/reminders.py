"""Reminders (M18 §4): classes, one-off events, to-dos with a due time, the daily summary, and
those of other modules (`reminder_source`: a habit not checked in yet).

Planning reads the calendar (M04 sources) for classes and events and the open to-dos (M05, which
include the one of each dated assessment) for the next `HORIZON`, and stores one row per reminder;
it runs when the calendar or the settings change and every few hours to move the horizon on. A
minute tick sends the rows that are due. Only users with at least one device are planned."""

from collections import defaultdict
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta
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
from semestra.modules.schedule.calendar import OccurrenceQuery, collect
from semestra.modules.settings import service as settings_service
from semestra.modules.tasks import service as tasks

log = structlog.get_logger()

# Must cover the replanning period plus the longest lead (a day): see `replan_all`.
HORIZON = timedelta(hours=36)
REPLAN_EVERY = timedelta(hours=6)
# A reminder the tick missed by more than this (the server was down) is dropped, not sent late.
STALE = timedelta(minutes=15)

# Deadlines are reminded through the to-dos, not the calendar: an assessment's deadline is its
# to-do's, and checking that to-do off (handed in) must stop the reminder.
_CALENDAR = ("schedule.meetings", "schedule.events")
# Kind → setting holding its lead in minutes.
_LEADS = {"class": "class_reminder", "event": "event_reminder", "task": "task_reminder"}
_DIGEST_GROUP = {"class": "classes", "event": "events"}


@dataclass(frozen=True)
class _Item:
    """Something to be reminded of: a class, an event or an open to-do with a due time."""

    id: str
    kind: str
    title: str
    start_at: datetime
    location: str | None = None


async def _calendar_items(
    ctx: Ctx, program_id: str, start: datetime, end: datetime, kinds: list[str]
) -> list[_Item]:
    q = OccurrenceQuery(program_id, start, end)
    return [
        _Item(o.id, o.kind, o.title, o.start_at, o.location)
        for o in await collect(ctx, q, _CALENDAR, kinds)  # pyright: ignore[reportArgumentType]
        if not o.all_day and o.status not in ("cancelled", "done")
    ]


async def _open_tasks(
    ctx: Ctx, program: AcademicsProgram, start: datetime, end: datetime
) -> tuple[list[_Item], int]:
    """Open to-dos due in [start, end): those with a time as items, and how many have only a
    date within it (they count in the daily summary but get no reminder of their own)."""
    zone = ZoneInfo(program.timezone)
    rows = await tasks.program_rows(
        ctx,
        program.id,
        open_only=True,
        due_from=start.astimezone(zone).date(),
        due_to=end.astimezone(zone).date(),
    )
    items: list[_Item] = []
    dated = 0
    for r in rows:
        assert r.due_date is not None
        if r.due_time is None:
            day = datetime.combine(r.due_date, time(), tzinfo=zone)
            dated += start <= day < end
            continue
        at = datetime.combine(r.due_date, r.due_time, tzinfo=zone)
        if start <= at < end:
            items.append(_Item(f"tasks.item:{r.id}", "task", r.title, at.astimezone(UTC)))
    return items, dated


@dataclass(frozen=True)
class Planned:
    """A reminder another module plans: `key` is unique for the user (prefix it with the kind),
    `params` are kept for its `message`, which decides at `fire_at` whether it is still worth
    sending (the habit may be checked in by then)."""

    key: str
    program_id: str
    fire_at: datetime
    expires_at: datetime
    params: dict[str, object]


@dataclass(frozen=True)
class ReminderSource:
    # Reminders of the ctx user within [since, end) in the given Programs.
    plan: Callable[[Ctx, Sequence[AcademicsProgram], datetime, datetime], Awaitable[list[Planned]]]
    # What to send for a due row, None when it is not worth it any more.
    message: Callable[[Ctx, NotificationsReminder], Awaitable[service.Message | None]]


_EXTRA: dict[str, ReminderSource] = {}


def reminder_source(kind: str, source: ReminderSource) -> None:
    """Lets another module plan reminders of its own (M14's habits). Its own settings decide
    whether there are any; quiet hours, devices and sending are this module's. When those
    settings change, the module calls `plan` for the Programs concerned."""
    _EXTRA[kind] = source


def _lead(cfg: NotificationsSettings, setting: str) -> int | None:
    value = getattr(cfg, setting)
    return None if value == "off" else int(value)


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
    leads = {
        kind: lead for kind, setting in _LEADS.items() if (lead := _lead(cfg, setting)) is not None
    }
    # Sent rows keep their key, so a reminder a little late is still planned but never repeated.
    since = ctx.now - STALE
    end = ctx.now + HORIZON
    programs = [
        p for p in await academics.program_rows(ctx) if program_ids is None or p.id in program_ids
    ]
    rows: list[dict[str, object]] = []
    for program in programs:
        items: list[_Item] = []
        calendar_kinds = [kind for kind in leads if kind in _DIGEST_GROUP]
        if calendar_kinds:
            items += await _calendar_items(ctx, program.id, since, end, calendar_kinds)
        if "task" in leads:
            items += (await _open_tasks(ctx, program, since, end))[0]
        for item in items:
            lead = leads[item.kind]
            fire_at = item.start_at - timedelta(minutes=lead)
            if fire_at < since:
                continue
            rows.append(
                {
                    "program_id": program.id,
                    "key": f"{item.id}:{lead}",
                    "kind": item.kind,
                    "fire_at": fire_at,
                    "expires_at": item.start_at,
                    "params": {
                        "title": item.title,
                        "start_at": item.start_at.isoformat(),
                        "location": item.location,
                        "lead": lead,
                    },
                }
            )
        digest = _digest_row(ctx, program, cfg)
        if digest is not None:
            rows.append({"program_id": program.id, **digest})
    for kind, source in _EXTRA.items():
        rows += [
            {
                "program_id": p.program_id,
                "key": p.key,
                "kind": kind,
                "fire_at": p.fire_at,
                "expires_at": p.expires_at,
                "params": p.params,
            }
            for p in await source.plan(ctx, programs, since, end)
            if p.fire_at >= since
        ]
    if rows:
        await ctx.db.execute(
            sqlite_insert(NotificationsReminder)
            .values([{"user_id": ctx.user_id, **row} for row in rows])
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
    if row.kind in _EXTRA:
        return await _EXTRA[row.kind].message(ctx, row)
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
    end = start + timedelta(days=1)
    counts = defaultdict[str, int](int)
    for item in await _calendar_items(ctx, program.id, ctx.now, end, list(_DIGEST_GROUP)):
        counts[_DIGEST_GROUP[item.kind]] += 1
    timed, dated = await _open_tasks(ctx, program, start, end)
    # To-dos already past due today are not "today's" any more; date-only ones still are.
    counts["tasks"] = dated + sum(item.start_at >= ctx.now for item in timed)
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
        if ctx.user is None:
            return
        cfg = await service.settings_of(ctx)
        quiet = service.in_quiet_hours(cfg, ctx.now.astimezone(await service.zone_of(ctx)))
        # Claimed in one statement before the push: another process running the same tick, or
        # a slow push service holding this one past the next tick, cannot send them again.
        claimed = (
            await ctx.db.scalars(
                update(NotificationsReminder)
                .where(NotificationsReminder.id.in_(ids), NotificationsReminder.status == "pending")
                .values(status="skipped" if quiet else "sent")
                .returning(NotificationsReminder.id)
            )
        ).all()
        await ctx.db.commit()
        if quiet or not claimed:
            return
        rows = (
            await ctx.db.scalars(
                select(NotificationsReminder)
                .where(NotificationsReminder.id.in_(claimed))
                .order_by(NotificationsReminder.fire_at)
            )
        ).all()
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
    # Only users with a device that can still receive: the others would be planned for nothing.
    users = (
        await ctx.db.scalars(
            service.live(ctx).with_only_columns(NotificationsDevice.user_id).distinct()
        )
    ).all()
    for user_id in users:
        try:
            await replan_user(ctx.state, user_id)
        except Exception:
            log.exception("reminders_plan_failed", user_id=user_id)
