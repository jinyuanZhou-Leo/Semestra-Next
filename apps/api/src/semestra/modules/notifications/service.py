"""Devices and delivery (M18 §3, §5).

Every notification goes through `send`: it checks the account's settings and quiet hours,
renders the text in the user's language and pushes it to each device whose sign-in session is
still valid. Nothing is sent for a user without devices."""

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, time
from typing import Any, Literal
from zoneinfo import ZoneInfo

import structlog
from sqlalchemy import Select, delete, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from starlette.datastructures import State

from semestra.core.context import Ctx, system_ctx
from semestra.core.errors import AppError
from semestra.modules.academics import service as academics
from semestra.modules.auth.models import AuthSession
from semestra.modules.notifications import texts, webpush
from semestra.modules.notifications.models import NotificationsDevice
from semestra.modules.notifications.schemas import DeviceIn, DeviceRef
from semestra.modules.notifications.settings import NotificationsSettings
from semestra.modules.settings import service as settings_service

log = structlog.get_logger()

# Which setting turns a kind of notification off (reminders are planned per setting instead).
CATEGORY: dict[str, str] = {
    "import_ready": "jobs",
    "import_failed": "jobs",
    "export_ready": "jobs",
    "export_failed": "jobs",
    "restore_done": "jobs",
    "restore_failed": "jobs",
    "model_ready": "jobs",
    "model_failed": "jobs",
    "approval": "assistant",
    "sign_in": "sign_in",
}


async def settings_of(ctx: Ctx) -> NotificationsSettings:
    resolved = await settings_service.get_values(ctx, "notifications", "account", None)
    return NotificationsSettings.model_validate(resolved.values)


# --- devices --------------------------------------------------------------------------------


def _session_id(ctx: Ctx) -> str:
    session_id = ctx.auth.session_id if ctx.auth else None
    if session_id is None:  # an API token has no session to tie the device to
        raise AppError("notifications.session_required", 403)
    return session_id


def live(ctx: Ctx) -> Select[NotificationsDevice]:
    """Devices whose sign-in session is still valid: the only ones that get anything."""
    return (
        select(NotificationsDevice)
        .join(AuthSession, AuthSession.id == NotificationsDevice.session_id)
        .where(AuthSession.revoked_at.is_(None), AuthSession.expires_at > ctx.now)
    )


async def has_devices(ctx: Ctx) -> bool:
    query = live(ctx).where(NotificationsDevice.user_id == ctx.user_id).limit(1)
    return await ctx.db.scalar(query) is not None


async def register_device(ctx: Ctx, inp: DeviceIn) -> bool:
    """Adds or refreshes this browser's subscription. True when it is the account's first."""
    if not webpush.is_push_endpoint(inp.endpoint):
        raise AppError("notifications.unsupported_push_service", 422)
    try:
        webpush.encrypt(webpush.Subscription(inp.endpoint, inp.p256dh, inp.auth), b"check")
    except Exception:
        raise AppError("notifications.invalid_subscription", 422) from None
    first = not await has_devices(ctx)
    values = {
        "user_id": ctx.user_id,
        "session_id": _session_id(ctx),
        "endpoint": inp.endpoint,
        "p256dh": inp.p256dh,
        "auth": inp.auth,
        "last_seen_at": ctx.now,
    }
    # The same browser profile signed in as someone else takes the subscription over.
    await ctx.db.execute(
        sqlite_insert(NotificationsDevice)
        .values(**values, created_at=ctx.now)
        .on_conflict_do_update(index_elements=["endpoint"], set_=values)
    )
    return first


async def unregister_device(ctx: Ctx, inp: DeviceRef) -> None:
    await ctx.db.execute(
        delete(NotificationsDevice).where(
            NotificationsDevice.user_id == ctx.user_id,
            NotificationsDevice.endpoint == inp.endpoint,
        )
    )


async def _live_devices(
    ctx: Ctx, user_id: str, exclude_session: str | None
) -> list[NotificationsDevice]:
    query = live(ctx).where(NotificationsDevice.user_id == user_id)
    if exclude_session is not None:
        query = query.where(NotificationsDevice.session_id != exclude_session)
    return list((await ctx.db.scalars(query)).all())


# --- delivery -------------------------------------------------------------------------------


@dataclass(frozen=True)
class Message:
    kind: str
    params: dict[str, Any] = field(default_factory=lambda: {})
    url: str = "/"
    # Shown only when no Semestra tab is in front (the app already shows it there).
    hidden_only: bool = True
    # A later message with the same tag replaces the earlier one on the device.
    tag: str | None = None
    urgency: Literal["normal", "high"] = "normal"


async def zone_of(ctx: Ctx) -> ZoneInfo:
    """The time zone for quiet hours: the Program the user is in, else their first one."""
    prefs = await settings_service.get_preferences(ctx)
    rows = await academics.program_rows(ctx)
    row = next((r for r in rows if r.id == prefs.active_program_id), rows[0] if rows else None)
    return ZoneInfo(row.timezone) if row else ZoneInfo("UTC")


def in_quiet_hours(cfg: NotificationsSettings, local: datetime) -> bool:
    if not cfg.quiet_hours:
        return False
    start, end = time.fromisoformat(cfg.quiet_start), time.fromisoformat(cfg.quiet_end)
    now = local.time().replace(second=0, microsecond=0, tzinfo=None)
    if start == end:
        return False
    return start <= now < end if start < end else (now >= start or now < end)


async def allowed(ctx: Ctx, message: Message, cfg: NotificationsSettings | None = None) -> bool:
    cfg = cfg or await settings_of(ctx)
    setting = CATEGORY.get(message.kind)
    if setting is not None and not getattr(cfg, setting):
        return False
    return not in_quiet_hours(cfg, ctx.now.astimezone(await zone_of(ctx)))


async def deliver(ctx: Ctx, message: Message, *, exclude_session: str | None = None) -> int:
    """Pushes to every live device of the ctx user now; returns how many accepted it. Devices
    the push service no longer knows are deleted (the caller commits)."""
    devices = await _live_devices(ctx, ctx.user_id, exclude_session)
    if not devices:
        return 0
    locale = ctx.user.locale if ctx.user and ctx.user.locale else ctx.locale
    title, body = texts.render(message.kind, locale, **message.params)
    payload = {
        "title": title,
        "body": body,
        "url": message.url,
        "tag": message.tag or message.kind,
        "hidden_only": message.hidden_only,
    }
    outcomes = await asyncio.gather(
        *(
            webpush.send(
                ctx.settings,
                webpush.Subscription(d.endpoint, d.p256dh, d.auth),
                payload,
                now=ctx.now,
                urgency=message.urgency,
            )
            for d in devices
        )
    )
    gone = [d.id for d, outcome in zip(devices, outcomes, strict=True) if outcome == "gone"]
    if gone:
        await ctx.db.execute(delete(NotificationsDevice).where(NotificationsDevice.id.in_(gone)))
    return sum(outcome == "sent" for outcome in outcomes)


def notify_after_commit(
    ctx: Ctx, message: Message, *, user_id: str, exclude_session: str | None = None
) -> None:
    """Sends once the caller's transaction has committed, in its own transaction, so that an
    event subscriber never holds the database while push services answer."""
    state: State = ctx.state

    async def run() -> None:
        try:
            async with system_ctx(state, user_id) as own:
                if own.user is None or not await allowed(own, message):
                    return
                await deliver(own, message, exclude_session=exclude_session)
                await own.db.commit()
        except Exception:
            log.exception("notification_failed", kind=message.kind)

    ctx.after_commit.append(run)
