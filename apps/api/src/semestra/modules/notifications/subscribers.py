"""What other modules' events mean for notifications (M18 §4, §6). Those modules do not know
about notifications: everything a push says is decided here."""

from semestra.core.context import Ctx
from semestra.core.events import Event, events
from semestra.modules.notifications import reminders, service, texts
from semestra.modules.notifications.service import Message

JOB_FINISHED = "core.job.finished"

# Background jobs worth a notification: kind → (on success, on failure, page to open).
_JOBS: dict[str, tuple[str | None, str | None, str]] = {
    "portability.export": ("export_ready", "export_failed", "/?settings=account/data"),
    "portability.import": ("restore_done", "restore_failed", "/?settings=account/data"),
    "ai.local_ocr.download": ("model_ready", "model_failed", "/?settings=account/data"),
    "ai.local_embedding.download": ("model_ready", "model_failed", "/?settings=account/data"),
    # Success is `imports.session.ready`, which also covers imports that need no job.
    "imports.extract": (None, "import_failed", "/"),
}


@events.subscribe("calendar.changed")
async def on_calendar_changed(ctx: Ctx, event: Event) -> None:
    program_id = event.data.get("program_id")
    if ctx.user is not None and isinstance(program_id, str) and await service.has_devices(ctx):
        await reminders.plan(ctx, [program_id])


@events.subscribe("settings.values.updated")
async def on_settings_updated(ctx: Ctx, event: Event) -> None:
    if ctx.user is not None and event.data.get("namespace") == "notifications":
        await reminders.plan(ctx)


@events.subscribe(JOB_FINISHED)
async def on_job_finished(ctx: Ctx, event: Event) -> None:
    rule = _JOBS.get(str(event.data.get("kind")))
    if rule is None or event.user_id is None:
        return
    success, failure, url = rule
    status = event.data.get("status")
    kind = success if status == "succeeded" else failure if status == "failed" else None
    if kind is not None:
        message = Message(kind=kind, url=url, tag=f"job:{event.data.get('job_id')}")
        service.notify_after_commit(ctx, message, user_id=event.user_id)


@events.subscribe("imports.session.ready")
async def on_import_ready(ctx: Ctx, event: Event) -> None:
    if event.user_id is None:
        return
    session_id, program_id = event.data.get("session_id"), event.data.get("program_id")
    message = Message(
        kind="import_ready",
        url=f"/p/{program_id}/imports/{session_id}" if program_id else "/",
        tag=f"import:{session_id}",
    )
    service.notify_after_commit(ctx, message, user_id=event.user_id)


@events.subscribe("agent.proposals.created")
async def on_proposals(ctx: Ctx, event: Event) -> None:
    if event.user_id is None:
        return
    session_id, program_id = event.data.get("session_id"), event.data.get("program_id")
    message = Message(
        kind="approval",
        url=f"/p/{program_id}/assistant/{session_id}" if program_id else "/",
        tag=f"approval:{session_id}",
    )
    service.notify_after_commit(ctx, message, user_id=event.user_id)


@events.subscribe("auth.session.created")
async def on_sign_in(ctx: Ctx, event: Event) -> None:
    """Told on the account's other devices; shown even when a Semestra tab is in front there."""
    if event.user_id is None:
        return
    locale = ctx.user.locale if ctx.user and ctx.user.locale else ctx.locale
    device = texts.device_label(event.data.get("user_agent")) or texts.word(
        locale, "unknown_device"
    )
    message = Message(
        kind="sign_in",
        params={"device": device},
        url="/?settings=account/account#sessions",
        hidden_only=False,
        tag=f"sign_in:{event.data.get('session_id')}",
    )
    service.notify_after_commit(
        ctx, message, user_id=event.user_id, exclude_session=event.data.get("session_id")
    )
