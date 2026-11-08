"""Canvas updates (M18 §4.4): every few hours, what is new in the linked courses of users who
want it (M09 `lms.watch` decides what is new and remembers what was told), one notification per
course and kind: new grades, changed assignments, new announcements. They show even while a
Semestra tab is in front: the app does not tell them, and they are recorded as told."""

from datetime import timedelta

import structlog
from starlette.datastructures import State

from semestra.core.context import Ctx, run_as_system
from semestra.core.jobs import periodic
from semestra.modules.academics import service as academics
from semestra.modules.lms import watch as lms_watch
from semestra.modules.notifications import service, texts
from semestra.modules.notifications.models import NotificationsDevice
from semestra.modules.notifications.service import Message
from semestra.modules.plugins import service as plugins

log = structlog.get_logger()

CANVAS_TAB = "canvas-tab"


def _kind(base: str, n: int) -> str:
    return f"{base}_{'one' if n == 1 else 'other'}"


async def _messages(ctx: Ctx, news: lms_watch.CourseNews) -> list[Message]:
    locale = ctx.user.locale if ctx.user and ctx.user.locale else ctx.locale
    course = await academics.get_course_row(ctx, news.course_id)
    name = course.alias or course.code or course.title
    page = f"/p/{news.program_id}/c/{news.course_id}"
    out: list[Message] = []
    for base, names in (("lms_grades", news.graded), ("lms_changes", news.changed)):
        if names:
            out.append(
                Message(
                    kind=_kind(base, len(names)),
                    params={"course": name, "items": texts.listing(locale, names)},
                    url=f"{page}/grades",
                    hidden_only=False,
                    tag=f"{base}:{news.course_id}",
                )
            )
    found = news.announcements
    if found:
        url = page
        if await plugins.is_installed(ctx, CANVAS_TAB):
            url = f"{page}/canvas?tab=announcements"
            if len(found) == 1:
                url += f"&ref={found[0].external_id}"
        out.append(
            Message(
                kind=_kind("lms_announcements", len(found)),
                params={"course": name, "items": texts.listing(locale, [a.title for a in found])},
                url=url,
                hidden_only=False,
                tag=f"lms_announcements:{news.course_id}",
            )
        )
    return out


async def watch_user(state: State, user_id: str) -> None:
    """Each course in a transaction of its own: what was told is committed before the next
    course is read from the platform."""
    links: list[str] = []
    announcements = False

    async def courses(ctx: Ctx) -> None:
        nonlocal announcements
        if ctx.user is None or not await service.has_devices(ctx):
            return
        cfg = await service.settings_of(ctx)
        if cfg.lms == "off":
            return
        # Not looked at during quiet hours, so what comes up then is told after them.
        if service.in_quiet_hours(cfg, ctx.now.astimezone(await service.zone_of(ctx))):
            return
        announcements = cfg.lms == "all"
        links.extend(await lms_watch.watched_links(ctx))

    await run_as_system(state, user_id, courses)
    for link_id in links:

        async def course(ctx: Ctx, link_id: str = link_id) -> None:
            news = await lms_watch.course_news(ctx, link_id, announcements=announcements)
            if news is not None:
                for message in await _messages(ctx, news):
                    service.notify_after_commit(ctx, message, user_id=ctx.user_id)

        await run_as_system(state, user_id, course)


@periodic("notifications.lms", every=timedelta(hours=6), first_after=timedelta(minutes=10))
async def watch_all(ctx: Ctx) -> None:
    users = (
        await ctx.db.scalars(
            service.live(ctx).with_only_columns(NotificationsDevice.user_id).distinct()
        )
    ).all()
    for user_id in users:
        try:
            await watch_user(ctx.state, user_id)
        except Exception:
            # One user's broken connection must not stop the round.
            log.exception("lms_watch_failed", user_id=user_id)
