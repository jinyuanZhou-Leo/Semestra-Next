"""What changed on the platform since the last look, for update notifications (M09 §4.7, M18).

M18 calls `watched_links` and `new_announcements` (one platform request per connection for all
its courses), then `course_news` for each course in a transaction of its own, every few hours
for users who want Canvas notifications; this module only says what is new. A change
is new once: an imported assignment's grade or changed title, due date or weight whose platform
value was not reported before (`LmsImportedRef.reported`), and the announcements posted since
the course's last look (`LmsCourseLink.watched_at`). A course's first look, and one after a
pause of days, reports nothing: linking a course, turning notifications on or a server back
from downtime does not bring up what was there already. Only synced courses of a running,
upcoming or recent term are looked at."""

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta

import structlog
from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules.academics import service as academics
from semestra.modules.lms import imports, service
from semestra.modules.lms.models import LmsConnection, LmsCourseLink, LmsImportedRef

log = structlog.get_logger()

# Grades come in a while after a term's last day (the final exam), so a term that ended within
# this is still looked at.
RECENT = timedelta(days=30)
# A course last looked at longer ago than this is looked at as if for the first time.
STALE = timedelta(days=2)


@dataclass(frozen=True)
class NewAnnouncement:
    external_id: str
    title: str


@dataclass
class CourseNews:
    course_id: str
    program_id: str
    # Imported assignments by name: with a new grade, and with other changes (title, due date,
    # weight) and no new grade.
    graded: list[str] = field(default_factory=lambda: [])
    changed: list[str] = field(default_factory=lambda: [])
    announcements: list[NewAnnouncement] = field(default_factory=lambda: [])

    def __bool__(self) -> bool:
        return bool(self.graded or self.changed or self.announcements)


async def watched_links(ctx: Ctx) -> list[str]:
    """The ids of the ctx user's links to look at: each is looked at by `course_news`."""
    active = await academics.course_ids_active_since(ctx, (ctx.now - RECENT).date())
    rows = await ctx.db.execute(
        select(LmsCourseLink.id, LmsCourseLink.course_id)
        .join(LmsConnection, LmsConnection.id == LmsCourseLink.connection_id)
        .where(
            LmsCourseLink.user_id == ctx.user_id,
            LmsCourseLink.sync_enabled,
            LmsConnection.credentials_encrypted.is_not(None),
        )
        .order_by(LmsCourseLink.course_id)
    )
    return [link_id for link_id, course_id in rows.all() if course_id in active]


def _quiet(since: datetime | None, as_of: datetime) -> bool:
    """A first look, or one after a long pause (the server was off, notifications were off):
    what came up meanwhile is old news, so it is only recorded."""
    return since is None or since < as_of - STALE


async def new_announcements(
    ctx: Ctx, link_ids: Sequence[str], as_of: datetime
) -> dict[str, list[NewAnnouncement] | None]:
    """The announcements posted in each link's course since its last look and up to `as_of`,
    read live (nothing to cache: the next look asks from a later time) in one request per
    connection. None for the links whose connection could not be read: their look is put off."""
    links = [
        li
        for li in await ctx.db.scalars(select(LmsCourseLink).where(LmsCourseLink.id.in_(link_ids)))
        if li.user_id == ctx.user_id
    ]
    out: dict[str, list[NewAnnouncement] | None] = {li.id: [] for li in links}
    by_connection: dict[str, list[LmsCourseLink]] = {}
    for link in links:
        if not _quiet(link.watched_at, as_of):
            by_connection.setdefault(link.connection_id, []).append(link)
    for connection_id, group in by_connection.items():
        try:
            b = await service.bound(ctx, await service.get_connection_row(ctx, connection_id))
            if "announcements" not in b.provider.features:
                continue
            since = min(li.watched_at for li in group if li.watched_at is not None)
            exts = [li.external_course_id for li in group]
            found, _ = await service.call(
                ctx,
                b,
                lambda i, b=b, exts=exts, since=since: b.provider.announcements(
                    i, b.cfg, b.creds, exts, since=since
                ),
            )
        except AppError as error:
            log.info("lms.watch_failed", connection_id=connection_id, code=error.code)
            out.update(dict.fromkeys((li.id for li in group), None))
            continue
        for link in group:
            out[link.id] = [
                NewAnnouncement(a.external_id, a.title)
                for a in found
                if a.external_course_id == link.external_course_id
                and a.posted_at is not None
                and link.watched_at is not None
                and link.watched_at < a.posted_at <= as_of
            ]
    return out


async def course_news(
    ctx: Ctx, link_id: str, posted: list[NewAnnouncement] | None, as_of: datetime
) -> CourseNews | None:
    """What is new on the platform for one linked course, with the announcements
    `new_announcements` found for it, recorded as told in the ctx transaction (the look moves on
    to `as_of`); the caller commits right after, one course at a time, so no write is held
    while the platform answers (the reads come first and write nothing). None when nothing is
    new, or a read failed (the connection needs attention, which its status shows in the app;
    the next look starts from the last one)."""
    link = await ctx.db.get(LmsCourseLink, link_id)
    if link is None or link.user_id != ctx.user_id or posted is None:
        return None
    quiet = _quiet(link.watched_at, as_of)
    try:
        updates = await imports.check_updates(ctx, link.course_id, acknowledge=False)
    except AppError as error:
        log.info("lms.watch_failed", course_id=link.course_id, code=error.code)
        return None
    refs = await ctx.db.scalars(
        select(LmsImportedRef).where(
            LmsImportedRef.link_id == link.id, LmsImportedRef.external_kind == "assignment"
        )
    )
    changes = {
        u.external_id: (u.name, {name: change.new for name, change in u.changes.items()})
        for u in updates.items
    }
    news = CourseNews(link.course_id, link.program_id, announcements=[] if quiet else posted)
    for ref in refs:
        name, values = changes.get(ref.external_id, ("", {}))
        fresh = {key for key, value in values.items() if ref.reported.get(key) != value}
        # Only what is still different is remembered: a value changed back and then changed
        # again is new again.
        reported = {**{k: v for k, v in ref.reported.items() if k in values}, **values}
        if reported != ref.reported:
            ref.reported = reported
        if quiet or not fresh:
            continue
        if "score" in fresh:
            news.graded.append(name)
        elif fresh & {"title", "due_at", "weight", "points"}:
            news.changed.append(name)
    link.watched_at = as_of
    await ctx.db.flush()
    return news or None
