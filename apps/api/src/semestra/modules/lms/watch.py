"""What changed on the platform since the last look, for update notifications (M09 §4.7, M18).

M18 calls `watched_links`, then `course_news` for each course in a transaction of its own, every
few hours for users who want Canvas notifications; this module only says what is new. A change
is new once: an imported assignment's grade or changed title, due date or weight whose platform
value was not reported before (`LmsImportedRef.reported`), and the announcements posted since
the course's last look (`LmsCourseLink.watched_at`). A course's first look, and one after a
pause of days, reports nothing: linking a course, turning notifications on or a server back
from downtime does not bring up what was there already. Only synced courses of a running,
upcoming or recent term are looked at."""

from dataclasses import dataclass, field
from datetime import datetime, timedelta

import structlog
from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules.academics import service as academics
from semestra.modules.lms import imports, reads
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


async def _new_announcements(
    ctx: Ctx, link: LmsCourseLink, since: datetime
) -> list[NewAnnouncement]:
    try:
        found = await reads.announcements(ctx, link.course_id, since, refresh=True)
    except AppError as error:
        if error.code == "lms.feature_unsupported":
            return []
        raise
    return [
        NewAnnouncement(a.external_id, a.title)
        for a in found.items
        if a.posted_at is not None and since < a.posted_at <= ctx.now
    ]


async def course_news(ctx: Ctx, link_id: str, *, announcements: bool) -> CourseNews | None:
    """What is new on the platform for one linked course, recorded as told in the ctx
    transaction; the caller commits right after, one course at a time, so no write is held
    while the platform answers (the reads come first and write nothing). None when nothing is
    new, or the read failed (the connection needs attention, which its status shows in the
    app; the next look starts from the last one)."""
    link = await ctx.db.get(LmsCourseLink, link_id)
    if link is None or link.user_id != ctx.user_id:
        return None
    since = link.watched_at
    # A first look, or one after a long pause (the server was off, notifications were off):
    # what came up meanwhile is old news, so it is only recorded.
    quiet = since is None or since < ctx.now - STALE
    try:
        updates = await imports.check_updates(ctx, link.course_id, acknowledge=False)
        posted = (
            await _new_announcements(ctx, link, since)
            if announcements and since is not None and not quiet
            else []
        )
    except AppError as error:
        log.info("lms.watch_failed", course_id=link.course_id, code=error.code)
        return None
    refs = {
        ref.external_id: ref
        for ref in await ctx.db.scalars(
            select(LmsImportedRef).where(
                LmsImportedRef.link_id == link.id, LmsImportedRef.external_kind == "assignment"
            )
        )
    }
    news = CourseNews(link.course_id, link.program_id, announcements=posted)
    for update in updates.items:
        ref = refs.get(update.external_id)
        if ref is None:
            continue
        values = {name: change.new for name, change in update.changes.items()}
        fresh = {name for name, value in values.items() if ref.reported.get(name) != value}
        if fresh:
            ref.reported = {**ref.reported, **values}
        if quiet or not fresh:
            continue
        if "score" in fresh:
            news.graded.append(update.name)
        elif fresh & {"title", "due_at", "weight", "points"}:
            news.changed.append(update.name)
    link.watched_at = ctx.now
    await ctx.db.flush()
    return news or None
