"""The course and announcements stages of the course sync (M09 §4.8); assignments are in
`sync_assignments.py`."""

from datetime import timedelta

from semestra.core.context import Ctx
from semestra.modules.lms import service
from semestra.modules.lms.models import LmsCourseLink
from semestra.modules.lms.service import Bound
from semestra.modules.lms.sync import Notice, StageResult, register_sync_stage

# A course last looked at longer ago than this is looked at as if for the first time: what was
# posted meanwhile (the server was down, the course paused) is old news.
STALE = timedelta(days=2)


async def course(ctx: Ctx, link: LmsCourseLink, b: Bound) -> StageResult:
    await service.refresh_link(ctx, link, b)
    return StageResult()


async def announcements(ctx: Ctx, link: LmsCourseLink, b: Bound) -> StageResult:
    """The announcements posted since the last look (none on a first look), read live: the next
    look asks from a later time, so there is nothing to cache."""
    since, now = link.watched_at, ctx.now
    result = StageResult()
    if since is not None and since >= now - STALE:
        found, _ = await service.call(
            ctx,
            b,
            lambda i: b.provider.announcements(
                i, b.cfg, b.creds, [link.external_course_id], since=since
            ),
        )
        result.notices = [
            Notice("announcement", a.external_id, a.title)
            for a in found
            if a.external_course_id == link.external_course_id
            and a.posted_at is not None
            and since < a.posted_at <= now
        ]
    link.watched_at = now
    return result


async def _announces(ctx: Ctx, link: LmsCourseLink, b: Bound) -> bool:
    del ctx, link
    return "announcements" in b.provider.features


register_sync_stage("course", course, order=0)
register_sync_stage("announcements", announcements, order=40, enabled=_announces)
