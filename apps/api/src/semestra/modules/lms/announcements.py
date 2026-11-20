"""Announcements of linked courses (M09 §4.3).

The course sync's announcements stage reads each course's announcements from the platform and
keeps them in `lms_announcements`, following the platform's edits and deletions; the course and
term announcements pages, the cards and Sem read the stored rows, so they show without the
platform and without waiting on it. What the stage finds on its first read of a course is kept
as read and not reported (linking a course is quiet); what it finds later is unread, and new
posts are reported to M18 as notices of the run.

Whether the user read one is the app's own (`read_at`): opening it marks it. While the user
allows writes (`lms.allow_writes`) and the platform supports it, opening it also marks it read
on the platform, and the stage takes the platform's read marks back. With writes off neither
side touches the other.

Platform links in the HTML stay marked as the cleaning left them (`data-lms-kind` /
`data-lms-ref`); reads add `targets`, what each one is in the app (a course file, the assessment
or to-do an assignment became), worked out when read, since the files and imports change after
the announcement was stored.
"""

import html as htmllib
import re
from collections.abc import Iterable, Sequence
from datetime import datetime, timedelta
from typing import get_args

import structlog
from sqlalchemy import func, select

from semestra.core.context import Ctx, run_as_system
from semestra.core.errors import AppError
from semestra.core.events import events, spawn
from semestra.modules.files import sources as files
from semestra.modules.lms import service
from semestra.modules.lms.errors import lms_error
from semestra.modules.lms.models import (
    LmsAnnouncement,
    LmsCourseLink,
    LmsImportedRef,
    LmsMaterial,
)
from semestra.modules.lms.schemas.dto import FileMeta
from semestra.modules.lms.schemas.io import (
    AnnouncementAttachment,
    AnnouncementList,
    AppTarget,
    CourseAnnouncement,
    CourseUnread,
    LinkTarget,
    NotRead,
    TermAnnouncementList,
    UnreadCounts,
)
from semestra.modules.lms.service import Bound
from semestra.modules.lms.settings import writes_allowed
from semestra.modules.lms.sync import (
    Notice,
    StageResult,
    active_course_ids,
    hold,
    register_sync_stage,
)

log = structlog.get_logger()

# How far back the stage reads. Announcements posted before that stay as they are: the platform
# was not asked about them.
LOOKBACK = timedelta(days=180)
# A new announcement posted longer ago than this is not reported (the course was paused, the
# server was down): it is still unread.
STALE = timedelta(days=2)
# The course's stored announcements changed (the stage, a read mark): {course_id, program_id}.
UPDATED = "lms.announcement.updated"
events.coalesce(UPDATED)

_MARK = re.compile(r'data-lms-kind="([^"]*)" data-lms-ref="([^"]*)"')


# --- the sync stage -------------------------------------------------------------------------


async def stage(ctx: Ctx, link: LmsCourseLink, b: Bound) -> StageResult:
    now = ctx.now
    since = now - LOOKBACK
    ext = link.external_course_id
    found, truncated = await service.call(
        ctx, b, lambda i: b.provider.announcements(i, b.cfg, b.creds, [ext], since=since)
    )
    platform_marks = "mark_read" in b.provider.features and await writes_allowed(ctx)
    await hold(ctx, link)
    rows = {
        r.external_id: r
        for r in await ctx.db.scalars(
            select(LmsAnnouncement).where(LmsAnnouncement.link_id == link.id)
        )
    }
    first = link.watched_at is None
    result = StageResult()
    changed = False
    seen: set[str] = set()
    for a in found:
        if not a.external_id or a.external_course_id not in ("", ext) or a.external_id in seen:
            continue
        seen.add(a.external_id)
        values = {
            "title": a.title,
            "html": b.clean(a.html, a.web_url, ext),
            "author": a.author,
            "web_url": a.web_url,
            "posted_at": a.posted_at,
            "updated_at": a.updated_at,
            "attachments": [
                x.model_dump(mode="json") | {"download_url": x.download_url} for x in a.attachments
            ],
        }
        row = rows.get(a.external_id)
        if row is None:
            row = LmsAnnouncement(
                user_id=ctx.user_id,
                link_id=link.id,
                external_id=a.external_id,
                read_at=now if first else None,
                **values,
            )
            ctx.db.add(row)
            changed = True
            if not first and (a.posted_at is None or a.posted_at >= now - STALE):
                result.notices.append(Notice("announcement", a.external_id, a.title))
        else:
            for name, value in values.items():
                if getattr(row, name) != value:
                    setattr(row, name, value)
                    changed = True
        if platform_marks and not a.unread and row.read_at is None:
            row.read_at = now
            changed = True
    # Gone from the platform: deleted with it, quietly. A list cut short says nothing of what
    # it left out, nor does the platform of what was posted before `since`.
    if not truncated:
        for external_id, row in rows.items():
            if external_id not in seen and (row.posted_at is None or row.posted_at >= since):
                await ctx.db.delete(row)
                changed = True
    link.watched_at = now
    # The first read also changes what the lists say (no longer "not read yet").
    if changed or first:
        await _updated(ctx, link)
    return result


async def _updated(ctx: Ctx, link: LmsCourseLink) -> None:
    await events.publish(ctx, UPDATED, {"course_id": link.course_id, "program_id": link.program_id})


async def _announces(ctx: Ctx, link: LmsCourseLink, b: Bound) -> bool:
    del ctx, link
    return "announcements" in b.provider.features


register_sync_stage("announcements", stage, order=40, enabled=_announces)


# --- reads ----------------------------------------------------------------------------------


async def course_list(ctx: Ctx, course_id: str, since: datetime | None = None) -> AnnouncementList:
    link = await service.link_row(ctx, course_id)
    if link is None:
        raise lms_error("lms.course_not_linked")
    query = select(LmsAnnouncement).where(LmsAnnouncement.link_id == link.id)
    if since is not None:
        query = query.where(LmsAnnouncement.posted_at > since)
    rows = list(await ctx.db.scalars(query))
    return AnnouncementList(
        items=await _out(ctx, rows, [link]), not_read=await _not_read(ctx, [link])
    )


async def term_list(ctx: Ctx, term_id: str) -> TermAnnouncementList:
    links = await service.term_links(ctx, term_id)
    rows = list(
        await ctx.db.scalars(
            select(LmsAnnouncement).where(LmsAnnouncement.link_id.in_([li.id for li in links]))
        )
    )
    return TermAnnouncementList(
        items=await _out(ctx, rows, links),
        linked_course_ids=sorted(li.course_id for li in links),
        not_read=await _not_read(ctx, links),
    )


async def _not_read(ctx: Ctx, links: Sequence[LmsCourseLink]) -> NotRead | None:
    """Why the announcements of these courses are not here yet: a course the sync has never read
    that it will read (`waiting`), or won't on its own because its term ended (`ended`, a manual
    sync still reads it) or its sync is off (`paused`). None: every course was read (or its
    platform has no announcements)."""
    unread = [
        li
        for li in links
        if li.watched_at is None
        and "announcements"
        in service.provider_features(
            (await service.get_connection_row(ctx, li.connection_id)).provider
        )
    ]
    if not unread:
        return None
    active = await active_course_ids(ctx)
    reasons = {
        "paused" if not li.sync_enabled else "waiting" if li.course_id in active else "ended"
        for li in unread
    }
    return next(r for r in get_args(NotRead) if r in reasons)


async def attachment_meta(ctx: Ctx, course_id: str, file_id: str) -> FileMeta | None:
    """An attachment of one of the course's stored announcements, as the file proxy opens it:
    from the address the announcement gave (no file lookup, which a course with its files
    hidden refuses). None: not an attachment kept here."""
    link = await service.link_row(ctx, course_id)
    if link is None:
        return None
    rows = await ctx.db.scalars(select(LmsAnnouncement).where(LmsAnnouncement.link_id == link.id))
    for row in rows:
        for x in row.attachments:
            if str(x.get("external_id")) == file_id and x.get("download_url"):
                return FileMeta(
                    external_id=file_id,
                    name=str(x.get("name") or file_id),
                    mime_type=x.get("mime_type"),
                    size_bytes=x.get("size_bytes"),
                    download_url=x["download_url"],
                )
    return None


async def find(ctx: Ctx, course_id: str, external_id: str) -> CourseAnnouncement:
    link = await service.link_row(ctx, course_id)
    row = await _row(ctx, link, external_id) if link is not None else None
    if link is None or row is None:
        raise lms_error("lms.not_found")
    return (await _out(ctx, [row], [link]))[0]


async def unread(ctx: Ctx, program_id: str, term_id: str | None) -> UnreadCounts:
    links = (
        await service.term_links(ctx, term_id)
        if term_id is not None
        else await service.program_links(ctx, program_id)
    )
    by_link = {li.id: li.course_id for li in links if li.program_id == program_id}
    counts = await ctx.db.execute(
        select(LmsAnnouncement.link_id, func.count())
        .where(
            LmsAnnouncement.user_id == ctx.user_id,
            LmsAnnouncement.link_id.in_(list(by_link)),
            LmsAnnouncement.read_at.is_(None),
        )
        .group_by(LmsAnnouncement.link_id)
    )
    return UnreadCounts(
        items=[CourseUnread(course_id=by_link[link_id], unread=n) for link_id, n in counts]
    )


async def _row(ctx: Ctx, link: LmsCourseLink, external_id: str) -> LmsAnnouncement | None:
    return await ctx.db.scalar(
        select(LmsAnnouncement).where(
            LmsAnnouncement.link_id == link.id, LmsAnnouncement.external_id == external_id
        )
    )


async def _out(
    ctx: Ctx, rows: Sequence[LmsAnnouncement], links: Iterable[LmsCourseLink]
) -> list[CourseAnnouncement]:
    """The rows newest first, with what their links and attachments are in the app."""
    by_id = {li.id: li for li in links}
    rows = sorted(rows, key=lambda r: r.posted_at.timestamp() if r.posted_at else 0, reverse=True)
    marks = {r.id: _marks(r.html) for r in rows}
    asked: dict[str, set[tuple[str, str]]] = {}
    for r in rows:
        wanted = asked.setdefault(r.link_id, set())
        wanted.update(marks[r.id])
        wanted.update(("file", str(x.get("external_id"))) for x in r.attachments)
    targets = await _targets(ctx, by_id, asked)
    out: list[CourseAnnouncement] = []
    for r in rows:
        mine = targets.get(r.link_id, {})
        out.append(
            CourseAnnouncement(
                external_id=r.external_id,
                course_id=by_id[r.link_id].course_id,
                web_url=r.web_url,
                title=r.title,
                html=r.html,
                author=r.author,
                posted_at=r.posted_at,
                updated_at=r.updated_at,
                unread=r.read_at is None,
                attachments=[
                    AnnouncementAttachment.model_validate(
                        {**x, "file": mine.get(("file", str(x.get("external_id"))))}
                    )
                    for x in r.attachments
                ],
                targets=[
                    LinkTarget(kind=kind, ref=ref, target=mine[(kind, ref)])
                    for kind, ref in dict.fromkeys(marks[r.id])
                    if (kind, ref) in mine
                ],
            )
        )
    return out


def _marks(html: str | None) -> list[tuple[str, str]]:
    """The platform links the cleaning marked in `html`, as `(kind, ref)`."""
    return [(htmllib.unescape(k), htmllib.unescape(v)) for k, v in _MARK.findall(html or "")]


async def _targets(
    ctx: Ctx, links: dict[str, LmsCourseLink], asked: dict[str, set[tuple[str, str]]]
) -> dict[str, dict[tuple[str, str], AppTarget]]:
    """What each `(kind, external id)` asked of a link is in the app, by link id: files and
    pages the course's files have, assignments imported. Anything else is left out."""
    out: dict[str, dict[tuple[str, str], AppTarget]] = {}
    materials: dict[str, list[tuple[str, tuple[str, str]]]] = {}
    for link_id, wanted in asked.items():
        materials_of = {ref for kind, ref in wanted if kind in ("file", "page")}
        assignments = {ref for kind, ref in wanted if kind == "assignment"}
        if materials_of:
            for m in await ctx.db.scalars(
                select(LmsMaterial).where(
                    LmsMaterial.link_id == link_id,
                    LmsMaterial.kind.in_(("file", "page")),
                    LmsMaterial.external_id.in_(materials_of),
                    LmsMaterial.item_id.is_not(None),
                )
            ):
                if (m.kind, m.external_id) in wanted and m.item_id is not None:
                    materials.setdefault(m.item_id, []).append((link_id, (m.kind, m.external_id)))
        if assignments:
            for r in await ctx.db.scalars(
                select(LmsImportedRef).where(
                    LmsImportedRef.link_id == link_id,
                    LmsImportedRef.external_id.in_(assignments),
                    LmsImportedRef.target_id.is_not(None),
                )
            ):
                if r.target_kind in ("assessment", "task") and r.target_id is not None:
                    out.setdefault(link_id, {})[("assignment", r.external_id)] = AppTarget(
                        kind=r.target_kind,  # pyright: ignore[reportArgumentType]
                        id=r.target_id,
                        course_id=links[link_id].course_id,
                    )
    for item in await files.find_items(ctx, list(materials)):
        for link_id, key in materials[item.id]:
            out.setdefault(link_id, {})[key] = AppTarget(
                kind="file", id=item.id, course_id=item.course_id, folder_id=item.folder_id
            )
    return out


# --- writes ---------------------------------------------------------------------------------


async def mark_read(ctx: Ctx, course_id: str, external_id: str) -> CourseAnnouncement:
    """Marks it read here, and on the platform when the user allows writes: after the commit,
    in the background (best effort: it is read here either way), so the platform's answer never
    holds the database's write lock."""
    write_back = await writes_allowed(ctx)  # read before the first write
    link = await service.link_row(ctx, course_id)
    row = await _row(ctx, link, external_id) if link is not None else None
    if link is None or row is None:
        raise lms_error("lms.not_found")
    if row.read_at is None:
        row.read_at = ctx.now
        await _updated(ctx, link)
        if write_back:
            state, user_id = ctx.state, ctx.user_id

            async def after() -> None:
                spawn(
                    state,
                    run_as_system(
                        state, user_id, lambda sys: _mark_on_platform(sys, course_id, external_id)
                    ),
                )

            ctx.after_commit.append(after)
    return (await _out(ctx, [row], [link]))[0]


async def _mark_on_platform(ctx: Ctx, course_id: str, external_id: str) -> None:
    link = await service.link_row(ctx, course_id)
    if link is None:
        return
    try:
        b = await service.bound(ctx, await service.get_connection_row(ctx, link.connection_id))
        if "mark_read" not in b.provider.features:
            return
        await service.call(
            ctx,
            b,
            lambda i: b.provider.mark_announcement_read(
                i, b.cfg, b.creds, link.external_course_id, external_id
            ),
        )
    except AppError as exc:
        log.info("lms.mark_read_failed", code=exc.code, course_id=link.course_id)
