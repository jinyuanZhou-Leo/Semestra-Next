"""The daily habit reminder (M14 §2, M18): at the card's time, when today is not checked in (and,
for a weekly goal, the week's target is not reached yet). Planned like the other reminders; the
check-in is looked at again when the reminder is due, so checking in earlier stops it."""

from collections.abc import Sequence
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules.academics import service as academics
from semestra.modules.academics.models import AcademicsProgram
from semestra.modules.notifications import reminders, texts
from semestra.modules.notifications.models import NotificationsReminder
from semestra.modules.notifications.service import Message
from semestra.modules.plugins import service as plugins
from semestra.modules.plugins_builtin import instances
from semestra.modules.plugins_builtin.habit_streak import service
from semestra.modules.plugins_builtin.habit_streak.schemas import (
    CARD_IDS,
    DEFAULT_REMIND_AT,
    PLUGIN_ID,
)

KIND = "habit"


def remind_at(settings: dict[str, object]) -> time | None:
    """The card's reminder time, None while the reminder is off."""
    if settings.get("remind") is not True:
        return None
    value = settings.get("remind_at", DEFAULT_REMIND_AT)
    try:
        return time.fromisoformat(value) if isinstance(value, str) else None
    except ValueError:
        return None


def _board_url(instance: instances.CardInstance, program_id: str) -> str:
    base = f"/p/{program_id}"
    return {
        "program": base,
        "today": f"{base}/today",
        "term": f"{base}/t/{instance.scope_id}",
        "course": f"{base}/c/{instance.scope_id}",
    }.get(instance.scope_type, base)


async def _plan(
    ctx: Ctx, programs: Sequence[AcademicsProgram], since: datetime, end: datetime
) -> list[reminders.Planned]:
    if not await plugins.is_installed(ctx, PLUGIN_ID):
        return []
    wanted = {p.id: p for p in programs}
    planned: list[reminders.Planned] = []
    for instance in await instances.all_card_instances(ctx, card_ids=CARD_IDS):
        at = remind_at(instance.settings)
        if at is None:
            continue
        try:
            program = await instances.instance_program(ctx, instance)
        except AppError:
            continue
        if program.id not in wanted:
            continue
        zone = ZoneInfo(program.timezone)
        today = academics.program_today(ctx, program)
        for day in (today, today + timedelta(days=1)):
            fire_at = datetime.combine(day, at, tzinfo=zone)
            if not since <= fire_at < end:
                continue
            if day == today and not await service.left_today(ctx, instance, today):
                continue
            planned.append(
                reminders.Planned(
                    key=f"{KIND}:{instance.instance_id}:{day.isoformat()}",
                    program_id=program.id,
                    fire_at=fire_at,
                    expires_at=datetime.combine(day + timedelta(days=1), time(), tzinfo=zone),
                    params={"instance_id": instance.instance_id, "day": day.isoformat()},
                )
            )
    return planned


async def _message(ctx: Ctx, row: NotificationsReminder) -> Message | None:
    if not await plugins.is_installed(ctx, PLUGIN_ID):
        return None
    try:
        instance = await instances.get_card_instance(
            ctx, str(row.params["instance_id"]), card_ids=CARD_IDS
        )
        program = await instances.instance_program(ctx, instance)
    except AppError:
        return None  # the card was removed
    today = academics.program_today(ctx, program)
    if remind_at(instance.settings) is None or today != date.fromisoformat(row.params["day"]):
        return None
    left = await service.left_today(ctx, instance, today)
    if not left:
        return None
    locale = ctx.user.locale if ctx.user and ctx.user.locale else ctx.locale
    name = str(instance.settings.get("name") or "").strip() or texts.word(locale, "habit")
    weekly = service.goal_of(instance.settings)[0] == "weekly"
    return Message(
        kind="habit_weekly" if weekly else "habit_daily",
        params={"name": name, "left": texts.count(locale, "times", left)},
        url=_board_url(instance, program.id),
        hidden_only=False,
        tag=f"{KIND}:{instance.instance_id}",
    )


reminders.reminder_source(KIND, reminders.ReminderSource(plan=_plan, message=_message))


async def replan(ctx: Ctx, instance_id: str) -> None:
    """After a card's settings change: its Program's reminders again (the time may be new)."""
    try:
        instance = await instances.get_card_instance(ctx, instance_id, card_ids=CARD_IDS)
        program = await instances.instance_program(ctx, instance)
    except AppError:
        return
    await reminders.plan(ctx, [program.id])
