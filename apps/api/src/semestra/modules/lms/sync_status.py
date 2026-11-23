"""What the app shows about a Program's sync (M09 §4.1): the status line, its panel and the
reminders. Read from the database only, so it answers at once while courses sync."""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import delete, func, select, update

from semestra.core.context import Ctx
from semestra.modules.academics import service as academics
from semestra.modules.files import sources
from semestra.modules.files.models import FilesItem
from semestra.modules.lms import material_items, rules, service, sync, sync_assignments
from semestra.modules.lms.answers import AREA_HIDDEN, AREA_OF
from semestra.modules.lms.models import (
    LmsAnnouncement,
    LmsAssignment,
    LmsCourseLink,
    LmsImportedRef,
    LmsItemCheck,
    LmsMaterial,
    LmsSyncChange,
    MaterialChange,
)
from semestra.modules.lms.providers.base import get_provider
from semestra.modules.lms.schemas.sync import (
    SyncChange,
    SyncConflict,
    SyncCourseError,
    SyncDifference,
    SyncItem,
    SyncItemKind,
    SyncMaterialChange,
    SyncRemovedMaterial,
    SyncRound,
    SyncStatus,
    SyncUnreadable,
)
from semestra.modules.lms.settings import account
from semestra.modules.lms.settings import materials as material_settings
from semestra.modules.lms.sync_assignments import (
    FIELDS,
    differences,
    local_values,
    toggleable,
)

# How long the panel lists what the sync changed (and the user can put it back).
CHANGES_KEPT = timedelta(days=14)
RECENT_MAX = 50


def _due(raw: str | None) -> datetime | None:
    return datetime.fromisoformat(raw) if raw else None


async def status(ctx: Ctx, program_id: str) -> SyncStatus:
    program = await academics.get_program_row(ctx, program_id)
    binding = await service.binding_row(ctx, program_id)
    cfg = await account(ctx)
    empty = SyncStatus(
        program_id=program_id,
        provider=None,
        connection_name=None,
        connection_error=None,
        every=cfg.sync_every,
        courses=0,
        synced_at=None,
        syncing=False,
        pending=[],
        ignored=[],
        recent=[],
        different=[],
        materials=[],
        removed_materials=[],
        removed_count=0,
        unreadable=[],
        errors=[],
        calendar_waiting=0,
        calendar_unreadable=0,
    )
    if binding is None:
        return empty
    connection = await service.get_connection_row(ctx, binding.connection_id)
    error = None
    if not connection.credentials_encrypted:
        error = "lms.credentials_missing"
    elif connection.status == "error":
        error = connection.last_error_code
    links = await sync.syncable_links(ctx, program_id)
    by_link = {li.id: li for li in await service.program_links(ctx, program_id)}
    courses = {
        c.id: c
        for c in await academics.courses_by_id(ctx, [li.course_id for li in by_link.values()])
    }

    def label(course_id: str) -> str:
        c = courses.get(course_id)
        return (c.alias or c.code or c.title) if c is not None else ""

    refs = list(
        await ctx.db.scalars(
            select(LmsImportedRef).where(
                LmsImportedRef.user_id == ctx.user_id,
                LmsImportedRef.link_id.in_(list(by_link)),
            )
        )
    )
    paused = {li.id for li in by_link.values() if not li.sync_enabled}
    refs = [r for r in refs if r.link_id not in paused]
    tz = ZoneInfo(program.timezone)
    imported = [r for r in refs if r.target_id is not None and r.removed_at is None]
    local = await local_values(ctx, imported, tz)
    pending: list[SyncItem] = []
    ignored: list[SyncItem] = []
    # New assignments (table 3e) come from the mirror, by mirror row id; so do the ignored ones
    # (they would be new otherwise).
    by_ext = {(r.link_id, r.external_id): r for r in refs}
    for row in await _mirror(ctx, [i for i in by_link if i not in paused]):
        assert row.link_id is not None
        ref = by_ext.get((row.link_id, row.external_id))
        if ref is not None and ref.target_id is not None:
            continue
        if not rules.is_new(
            row.assignment, row.submission, imported=False, dismissed=False, now=ctx.now
        ):
            continue
        course_id = by_link[row.link_id].course_id
        (ignored if ref is not None and ref.dismissed_at is not None else pending).append(
            SyncItem(
                id=row.id,
                course_id=course_id,
                course=label(course_id),
                kind="new",
                external_id=row.external_id,
                title=str(row.assignment.get("name") or ""),
                due_at=_due(row.assignment.get("due_at")),
            )
        )
    for ref in refs:
        course_id = by_link[ref.link_id].course_id

        def item(
            kind: SyncItemKind, ref: LmsImportedRef = ref, course_id: str = course_id
        ) -> SyncItem:
            return SyncItem(
                id=ref.id,
                course_id=course_id,
                course=label(course_id),
                kind=kind,
                external_id=ref.external_id,
                title=str(ref.snapshot.get("title") or ""),
                due_at=_due(ref.snapshot.get("due_at")),
            )

        if ref.target_id is None:
            continue
        if ref.removed_at is not None:
            pending.append(item("removed"))
        elif ref.conflicts:
            mine = local.get(ref.id, {})
            asked = item("conflict")
            asked.conflicts = [
                SyncConflict(
                    field=name,
                    mine=mine.get(name),
                    platform=ref.conflicts[name]["value"],
                    edited=ref.conflicts[name].get("edited", True),
                )
                for name in FIELDS[ref.target_kind or "task"]
                if name in ref.conflicts
            ]
            pending.append(asked)
    order = {"conflict": 0, "removed": 1, "new": 2}
    pending.sort(
        key=lambda i: (order[i.kind], i.due_at or datetime.max.replace(tzinfo=ctx.now.tzinfo))
    )
    rows = (
        await ctx.db.execute(
            select(LmsSyncChange, LmsImportedRef)
            .join(LmsImportedRef, LmsImportedRef.id == LmsSyncChange.ref_id)
            .where(
                LmsSyncChange.user_id == ctx.user_id,
                LmsImportedRef.link_id.in_(list(by_link)),
                LmsSyncChange.at >= ctx.now - CHANGES_KEPT,
            )
            .order_by(LmsSyncChange.at.desc())
            .limit(RECENT_MAX)
        )
    ).all()
    can_toggle = await toggleable(ctx, [(change, ref) for change, ref in rows])
    # A field whose change was put back is offered there ("redo"), not again as different.
    put_back = {
        (ref.id, change.field)
        for change, ref in rows
        if change.reverted_at is not None and change.id in can_toggle
    }
    different = sorted(
        (
            SyncDifference(
                id=ref.id,
                course_id=by_link[ref.link_id].course_id,
                course=label(by_link[ref.link_id].course_id),
                title=str(ref.snapshot.get("title") or ""),
                field=name,
                mine=mine,
                platform=platform,
                target_kind="assessment" if ref.target_kind == "assessment" else "task",
                target_id=str(ref.target_id),
            )
            for ref in imported
            if ref.id in local
            for name, mine, platform in differences(ref, local[ref.id], tz)
            if (ref.id, name) not in put_back
        ),
        key=lambda d: (d.course, d.title.casefold(), d.field),
    )
    recent = [
        SyncChange(
            id=change.id,
            kind="feedback" if change.field == sync_assignments.FEEDBACK else "field",
            course_id=by_link[ref.link_id].course_id,
            course=label(by_link[ref.link_id].course_id),
            title=str(ref.snapshot.get("title") or ""),
            field=change.field,
            old=change.old,
            new=change.new,
            at=change.at,
            reverted=change.reverted_at is not None,
            toggleable=change.id in can_toggle,
            target_kind="assessment" if ref.target_kind == "assessment" else "task",
            target_id=str(ref.target_id),
            external_id=ref.external_id,
        )
        for change, ref in rows
        if ref.target_id is not None
    ]
    materials, removed, removed_count = await _materials(
        ctx, [li for li in by_link.values() if li.id not in paused], label
    )
    unreadable = await _unreadable(
        ctx, [li for li in by_link.values() if li.id not in paused], label
    )
    errors = [
        SyncCourseError(course_id=li.course_id, course=label(li.course_id), stage=stage, code=code)
        for li in links
        for stage, code in li.sync_errors.items()
    ]
    # Courses the sync no longer visits (their term ended) still have their calendar read once
    # (§4.8): when it could not be, the reason is told here like any course's stage error.
    syncing_ids = {li.id for li in links}
    errors += [
        SyncCourseError(
            course_id=li.course_id, course=label(li.course_id), stage="calendar", code=reason
        )
        for li in by_link.values()
        if li.id not in syncing_ids
        and li.sync_enabled
        and rules.calendar_read(entry := li.area_reads.get("calendar")) == "unreadable"
        and (reason := (entry or {}).get("reason"))
    ]
    synced = [li.synced_at for li in links]
    busy = await sync.syncing_courses(ctx, [li.course_id for li in links])
    round_ = await sync.sync_round(ctx, [li.course_id for li in links])
    return empty.model_copy(
        update={
            "provider": connection.provider,
            "connection_name": connection.display_name,
            "connection_error": error,
            "courses": len(links),
            "synced_at": None if not synced or None in synced else min(s for s in synced if s),
            "syncing": bool(busy),
            "round": SyncRound(done=round_[0], total=round_[1]) if round_ else None,
            "pending": pending,
            "ignored": ignored,
            "recent": recent,
            "different": different,
            "materials": materials,
            "removed_materials": removed,
            "removed_count": removed_count,
            "unreadable": unreadable,
            "errors": errors,
            **_calendars(list(by_link.values()), connection.provider, error),
        }
    )


def _calendars(links: list[LmsCourseLink], provider: str, error: str | None) -> dict[str, int]:
    """How many courses' calendars were never read yet, or never could be (M09 §4.8): courses
    that sync, on a platform with calendars and a connection that works (the status line tells
    of a broken one)."""
    if error is not None or "calendar" not in get_provider(provider).features:
        return {"calendar_waiting": 0, "calendar_unreadable": 0}
    states = [rules.calendar_read(li.area_reads.get("calendar")) for li in links if li.sync_enabled]
    return {
        "calendar_waiting": states.count("waiting"),
        "calendar_unreadable": states.count("unreadable"),
    }


@dataclass(frozen=True)
class MaterialNews:
    """What the sync lately did to a course material (`LmsMaterial.change`), with the course
    file it is now (none when it is gone, or the user deleted it since)."""

    material: LmsMaterial
    change: MaterialChange
    course_id: str
    item: FilesItem | None


async def material_changes(
    ctx: Ctx, links: Sequence[LmsCourseLink], since: datetime, limit: int | None = None
) -> list[MaterialNews]:
    """The materials of these linked courses the sync changed since then, newest first: the
    sync panel's recent updates and the assistant's activity read this."""
    course_of = {li.id: li.course_id for li in links}
    if not course_of:
        return []
    changed = list(
        await ctx.db.scalars(
            select(LmsMaterial)
            .where(
                LmsMaterial.user_id == ctx.user_id,
                LmsMaterial.link_id.in_(list(course_of)),
                LmsMaterial.change.is_not(None),
                LmsMaterial.changed_at >= since,
            )
            .order_by(LmsMaterial.changed_at.desc())
            .limit(limit)
        )
    )
    items = {
        r.id: r
        for r in await sources.find_items(
            ctx, [m.item_id for m in changed if m.item_id and m.change != "gone"]
        )
    }
    return [
        MaterialNews(
            material=m,
            change=m.change,
            course_id=course_of[m.link_id],
            item=items.get(m.item_id or "") if m.change != "gone" else None,
        )
        for m in changed
        if m.change is not None
    ]


async def _materials(
    ctx: Ctx, links: list[LmsCourseLink], label: Callable[[str], str]
) -> tuple[list[SyncMaterialChange], list[SyncRemovedMaterial], int]:
    """What the platform did lately to the courses' materials, and those the user deleted (the
    newest `RECENT_MAX`, and how many) where the course's materials sync, so they can come back."""
    course_of = {li.id: li.course_id for li in links}
    changed = await material_changes(ctx, links, ctx.now - CHANGES_KEPT, RECENT_MAX)
    syncing = [li.id for li in links if (await material_settings(ctx, li.course_id)).sync]
    dismissed = (
        LmsMaterial.user_id == ctx.user_id,
        LmsMaterial.link_id.in_(syncing),
        LmsMaterial.state == "dismissed",
    )
    removed_count = await ctx.db.scalar(select(func.count()).where(*dismissed)) or 0
    removed_rows = await ctx.db.scalars(
        select(LmsMaterial)
        .where(*dismissed)
        .order_by(LmsMaterial.state_at.desc())
        .limit(RECENT_MAX)
    )
    folders = await sources.folder_names(
        ctx, list({c.item.folder_id for c in changed if c.item and c.item.folder_id})
    )
    recent: list[SyncMaterialChange] = []
    for c in changed:
        m, row, course_id = c.material, c.item, c.course_id
        recent.append(
            SyncMaterialChange(
                id=m.id,
                course_id=course_id,
                course=label(course_id),
                title=m.title or "",
                change=c.change,
                at=m.changed_at or ctx.now,
                item_id=row.id if row is not None else None,
                folder_id=row.folder_id if row is not None else None,
                folder=folders.get(row.folder_id or "") if row is not None else None,
            )
        )
    removed = [
        SyncRemovedMaterial(
            id=m.id,
            course_id=course_of[m.link_id],
            course=label(course_of[m.link_id]),
            title=m.title or m.name or "",
            at=m.state_at or ctx.now,
        )
        for m in removed_rows
    ]
    return recent, removed, removed_count


async def _mirror(ctx: Ctx, link_ids: Sequence[str]) -> list[LmsAssignment]:
    if not link_ids:
        return []
    return list(
        await ctx.db.scalars(
            select(LmsAssignment).where(
                LmsAssignment.user_id == ctx.user_id, LmsAssignment.link_id.in_(list(link_ids))
            )
        )
    )


def _whole_at(link: LmsCourseLink, area: str) -> datetime | None:
    raw = ((link.area_reads or {}).get(area) or {}).get("whole_at")
    return datetime.fromisoformat(raw) if raw else None


async def _unreadable(
    ctx: Ctx, links: list[LmsCourseLink], label: Callable[[str], str]
) -> list[SyncUnreadable]:
    """What the sync can't read since its area is closed on the platform (M09 table 3c, note):
    the materials (`material_items.unreadable`) and imported assignments whose last single read
    was refused for it, and each course's announcements while their list is closed, as one row.
    Gone from the list by itself once the platform shows it (or tells it gone) again."""
    if not links:
        return []
    by_id = {li.id: li for li in links}
    out: list[SyncUnreadable] = []
    for m, row in await material_items.unreadable(ctx, links):
        course_id = by_id[m.link_id].course_id
        out.append(
            SyncUnreadable(
                kind="material",
                id=m.id,
                course_id=course_id,
                course=label(course_id),
                area=AREA_OF.get(m.kind, "files"),
                title=m.title or m.name or "",
                count=1,
                since=None,
                item_id=row.id if row is not None else None,
                removable=material_items.removable(m, row),
            )
        )
    held = {
        c.external_id: c
        for c in await ctx.db.scalars(
            select(LmsItemCheck).where(
                LmsItemCheck.user_id == ctx.user_id,
                LmsItemCheck.link_id.in_(list(by_id)),
                LmsItemCheck.kind == "assignment",
                LmsItemCheck.result == "unavailable",
                LmsItemCheck.reason == AREA_HIDDEN,
            )
        )
    }
    refs = list(
        await ctx.db.scalars(
            select(LmsImportedRef).where(
                LmsImportedRef.user_id == ctx.user_id, LmsImportedRef.link_id.in_(list(by_id))
            )
        )
    )
    for ref in refs:
        check = held.get(ref.external_id)
        if ref.target_id is None or ref.removed_at is not None or check is None:
            continue
        course_id = by_id[ref.link_id].course_id
        out.append(
            SyncUnreadable(
                kind="assignment",
                id=ref.id,
                course_id=course_id,
                course=label(course_id),
                area="assignments",
                title=str(ref.snapshot.get("title") or ""),
                count=1,
                since=None,
                item_id=ref.target_id,
                external_id=ref.external_id,
            )
        )
    closed = {
        (li.id, area)
        for li in links
        for area, read in (li.area_reads or {}).items()
        if (read or {}).get("result") == "hidden"
    }
    # Unimported assignments are not read one by one: while their list is closed, the course's
    # mirror rows without an object are one row (table 3c, note).
    imported = {(r.link_id, r.external_id) for r in refs if r.target_id is not None}
    unimported: dict[str, int] = {}
    for row in await _mirror(ctx, [i for i, area in closed if area == "assignments"]):
        assert row.link_id is not None
        if (row.link_id, row.external_id) not in imported:
            unimported[row.link_id] = unimported.get(row.link_id, 0) + 1
    for link_id, count in unimported.items():
        li = by_id[link_id]
        out.append(
            SyncUnreadable(
                kind="assignments",
                id=None,
                course_id=li.course_id,
                course=label(li.course_id),
                area="assignments",
                title=None,
                count=count,
                since=_whole_at(li, "assignments"),
            )
        )
    announced: dict[str, int] = dict(
        (
            await ctx.db.execute(
                select(LmsAnnouncement.link_id, func.count())
                .where(
                    LmsAnnouncement.user_id == ctx.user_id,
                    LmsAnnouncement.link_id.in_(
                        [link_id for link_id, area in closed if area == "announcements"]
                    ),
                )
                .group_by(LmsAnnouncement.link_id)
            )
        ).all()
    )
    for link_id, count in announced.items():
        li = by_id[link_id]
        out.append(
            SyncUnreadable(
                kind="announcements",
                id=None,
                course_id=li.course_id,
                course=label(li.course_id),
                area="announcements",
                title=None,
                count=count,
                since=_whole_at(li, "announcements"),
            )
        )
    out.sort(key=lambda u: (u.course, u.kind, (u.title or "").casefold()))
    return out


async def forget_old_changes(ctx: Ctx) -> None:
    """The change log keeps `CHANGES_KEPT`; so do the materials' last changes."""
    old = ctx.now - CHANGES_KEPT
    await ctx.db.execute(delete(LmsSyncChange).where(LmsSyncChange.at < old))
    await ctx.db.execute(
        update(LmsMaterial).where(LmsMaterial.changed_at < old).values(change=None, changed_at=None)
    )
