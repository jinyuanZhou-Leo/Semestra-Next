"""What changed on the platform since the last look, for update notifications (M09 §4.7, M18).

M18 calls `news` every few hours for users who want Canvas notifications; this module only says
what is new. A change is new once: an imported assignment's grade or changed title, due date or
weight whose platform value was not reported before (`LmsImportedRef.reported`), and the
announcements posted since the course's last look (`LmsCourseLink.watched_at`). A course's first
look reports nothing, so linking a course or turning notifications on does not bring up what
was there already. Only synced courses of a running, upcoming or recent term are looked at."""

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


async def _links(ctx: Ctx) -> list[LmsCourseLink]:
    active = await academics.course_ids_active_since(ctx, (ctx.now - RECENT).date())
    rows = await ctx.db.scalars(
        select(LmsCourseLink)
        .join(LmsConnection, LmsConnection.id == LmsCourseLink.connection_id)
        .where(
            LmsCourseLink.user_id == ctx.user_id,
            LmsCourseLink.sync_enabled,
            LmsConnection.credentials_encrypted.is_not(None),
        )
        .order_by(LmsCourseLink.course_id)
    )
    return [link for link in rows if link.course_id in active]


async def _assignments(ctx: Ctx, link: LmsCourseLink, news: CourseNews, quiet: bool) -> None:
    updates = await imports.check_updates(ctx, link.course_id, acknowledge=False)
    if not updates.items:
        return
    refs = {
        ref.external_id: ref
        for ref in await ctx.db.scalars(
            select(LmsImportedRef).where(
                LmsImportedRef.link_id == link.id, LmsImportedRef.external_kind == "assignment"
            )
        )
    }
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


async def _announcements(ctx: Ctx, link: LmsCourseLink, since: datetime, news: CourseNews) -> None:
    try:
        found = await reads.announcements(ctx, link.course_id, since, refresh=True)
    except AppError as error:
        if error.code == "lms.feature_unsupported":
            return
        raise
    news.announcements += [
        NewAnnouncement(a.external_id, a.title)
        for a in found.items
        if a.posted_at is not None and since < a.posted_at <= ctx.now
    ]


async def news(ctx: Ctx, *, announcements: bool) -> list[CourseNews]:
    """What is new on the platform for the ctx user's courses; records it as told in the ctx
    transaction (the caller commits). A course whose read fails is skipped and looked at again
    next time from where it was."""
    found: list[CourseNews] = []
    for link in await _links(ctx):
        since = link.watched_at
        item = CourseNews(link.course_id, link.program_id)
        try:
            await _assignments(ctx, link, item, quiet=since is None)
            if announcements and since is not None:
                await _announcements(ctx, link, since, item)
        except AppError as error:
            # The connection needs attention (its status says so in the app) or the platform
            # failed: what was found is still told, and the next look starts from the last one.
            log.info("lms.watch_failed", course_id=link.course_id, code=error.code)
        else:
            link.watched_at = ctx.now
        if item:
            found.append(item)
    await ctx.db.flush()
    return found
