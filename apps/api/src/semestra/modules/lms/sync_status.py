"""What the app shows about a Program's sync (M09 §4.1): the status line, its panel and the
reminders. Read from the database only, so it answers at once while courses sync."""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import delete, select

from semestra.core.context import Ctx
from semestra.modules.academics import service as academics
from semestra.modules.lms import service, sync
from semestra.modules.lms.models import LmsImportedRef, LmsSyncChange
from semestra.modules.lms.schemas.sync import (
    SyncChange,
    SyncConflict,
    SyncCourseError,
    SyncItem,
    SyncItemKind,
    SyncStatus,
)
from semestra.modules.lms.settings import account
from semestra.modules.lms.sync_assignments import local_values, toggleable

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
        errors=[],
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
    asking = [r for r in refs if r.target_id is not None and r.conflicts and r.removed_at is None]
    local = await local_values(ctx, asking, ZoneInfo(program.timezone))
    pending: list[SyncItem] = []
    ignored: list[SyncItem] = []
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
            (ignored if ref.dismissed_at is not None else pending).append(item("new"))
        elif ref.removed_at is not None:
            pending.append(item("removed"))
        elif ref.conflicts:
            mine = local.get(ref.id, {})
            asked = item("conflict")
            asked.conflicts = [
                SyncConflict(field=name, mine=mine.get(name), platform=c["value"])
                for name, c in ref.conflicts.items()
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
    recent = [
        SyncChange(
            id=change.id,
            course_id=by_link[ref.link_id].course_id,
            course=label(by_link[ref.link_id].course_id),
            title=str(ref.snapshot.get("title") or ""),
            field=change.field,
            old=change.old,
            new=change.new,
            at=change.at,
            reverted=change.reverted_at is not None,
            toggleable=change.id in can_toggle,
        )
        for change, ref in rows
    ]
    errors = [
        SyncCourseError(course_id=li.course_id, course=label(li.course_id), stage=stage, code=code)
        for li in links
        for stage, code in li.sync_errors.items()
    ]
    synced = [li.synced_at for li in links]
    busy = await sync.syncing_courses(ctx, [li.course_id for li in links])
    return empty.model_copy(
        update={
            "provider": connection.provider,
            "connection_name": connection.display_name,
            "connection_error": error,
            "courses": len(links),
            "synced_at": None if not synced or None in synced else min(s for s in synced if s),
            "syncing": bool(busy),
            "pending": pending,
            "ignored": ignored,
            "recent": recent,
            "errors": errors,
        }
    )


async def forget_old_changes(ctx: Ctx) -> None:
    """The change log keeps `CHANGES_KEPT`."""
    await ctx.db.execute(delete(LmsSyncChange).where(LmsSyncChange.at < ctx.now - CHANGES_KEPT))
