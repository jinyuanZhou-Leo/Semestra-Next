"""What the course files ask of the materials the sync keeps there (M09 §4.2, M07's hooks):
the items that follow the platform, their places for "Organize", their bytes (M07's content
source), the user deleting, restoring or handing one over, the courses' settings changing, and
what turning the sync off left behind.

States change only through `materials.enter` (table 4a).
"""

from collections.abc import AsyncIterator, Mapping, Sequence
from html import escape

from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.errors import not_found
from semestra.core.events import Event, events
from semestra.modules.academics import service as academics
from semestra.modules.files import register_content_source, sources
from semestra.modules.files.models import FilesItem
from semestra.modules.files.source_folders import SourceFolders
from semestra.modules.lms import reads, service
from semestra.modules.lms.answers import AREA_HIDDEN
from semestra.modules.lms.errors import lms_error
from semestra.modules.lms.materials import enter
from semestra.modules.lms.models import LmsConnection, LmsCourseLink, LmsItemCheck, LmsMaterial
from semestra.modules.lms.providers.base import get_provider
from semestra.modules.lms.schemas.io import HeldMaterials
from semestra.modules.lms.settings import materials as material_settings
from semestra.modules.lms.sync import UPDATED, hold
from semestra.modules.lms.sync import queue as sync_queue
from semestra.modules.settings import service as settings_service


async def synced_items(ctx: Ctx, link_id: str) -> list[FilesItem]:
    """The items of the course's files that follow its materials."""
    ids = await ctx.db.scalars(
        select(LmsMaterial.item_id).where(
            LmsMaterial.link_id == link_id,
            LmsMaterial.state == "synced",
            LmsMaterial.item_id.is_not(None),
        )
    )
    return list(await sources.find_items(ctx, [i for i in ids if i]))


def has_copy(row: FilesItem) -> bool:
    """A material that would become the user's own file if it left the platform or the course
    were unlinked: one with a local copy."""
    return row.kind == "file" and bool(row.storage_key)


async def homes(ctx: Ctx, course_id: str) -> list[sources.Home]:
    """The course's materials still where the sync put them but away from their place on the
    platform now (filed by type before places were kept, or moved on the platform since): for
    the course's "Organize" to offer moving back."""
    link = await service.link_row(ctx, course_id)
    if link is None:
        return []
    mats = [
        m
        for m in await ctx.db.scalars(
            select(LmsMaterial).where(
                LmsMaterial.link_id == link.id,
                LmsMaterial.state == "synced",
                LmsMaterial.item_id.is_not(None),
                LmsMaterial.path.is_not(None),
            )
        )
    ]
    rows = {r.id: r for r in await sources.find_items(ctx, [m.item_id for m in mats if m.item_id])}
    name = (await source_names(ctx, [course_id])).get(course_id, "LMS")
    places: SourceFolders | None = None
    found: list[sources.Home] = []
    for mat in mats:
        row = rows.get(mat.item_id or "")
        if row is None or row.source_kind is None or row.folder_id != mat.placed_folder_id:
            continue  # the user moved it, or it is theirs now
        if places is None:
            places = SourceFolders(ctx, course_id, "lms", name)
        folder_id, complete = await places.existing(mat.path or [])
        if complete and folder_id == row.folder_id:
            continue
        place = tuple((str(key), str(n)) for key, n in mat.path or [])
        found.append(sources.Home(row.id, place, "lms", name))
    return found


async def moved_back(ctx: Ctx, placed: Mapping[str, str | None]) -> None:
    """Items "Organize" moved back to their platform folder: that is where the sync put them now,
    so a later move on the platform is offered again."""
    for mat in await ctx.db.scalars(
        select(LmsMaterial).where(
            LmsMaterial.user_id == ctx.user_id,
            LmsMaterial.state == "synced",
            LmsMaterial.item_id.in_(list(placed)),
        )
    ):
        mat.placed_folder_id = placed[mat.item_id or ""]


sources.register_homes("lms", homes, moved_back)


# --- reading the bytes (M07's content source) -----------------------------------------------


async def _material_of(ctx: Ctx, item: FilesItem) -> tuple[LmsMaterial, LmsCourseLink]:
    found = (
        await ctx.db.execute(
            select(LmsMaterial, LmsCourseLink)
            .join(LmsCourseLink, LmsCourseLink.id == LmsMaterial.link_id)
            .where(
                LmsMaterial.user_id == ctx.user_id,
                LmsMaterial.item_id == item.id,
                LmsMaterial.state == "synced",
                LmsCourseLink.course_id == item.course_id,
            )
        )
    ).one_or_none()  # one at most (`uq_lms_materials_followed`)
    if found is None:
        raise lms_error("lms.not_found")
    mat, link = found
    return mat, link


async def _once(data: bytes) -> AsyncIterator[bytes]:
    yield data


def page_document(title: str, html: str | None) -> bytes:
    head = f'<!doctype html><html><head><meta charset="utf-8"><title>{escape(title)}</title>'
    return f"{head}</head><body><h1>{escape(title)}</h1>{html or ''}</body></html>".encode()


async def open_source(ctx: Ctx, item: FilesItem) -> AsyncIterator[bytes]:
    """The bytes of an item the sync made: the platform's file, or its page as an HTML
    document (read fresh, so a changed page is read as it is now)."""
    mat, link = await _material_of(ctx, item)
    if mat.kind == "file":
        _, stream = await reads.open_file(ctx, link.course_id, mat.external_id)
        return stream
    if mat.kind == "page":
        page = await reads.page(ctx, link.course_id, mat.external_id, refresh=True)
        return _once(page_document(page.title, page.html))
    raise lms_error("lms.not_found")


async def source_names(ctx: Ctx, course_ids: Sequence[str]) -> dict[str, str]:
    """The platform each course is linked to, by name: what its synced items are shown as
    coming from (`ItemOut.source_name`)."""
    found = await ctx.db.execute(
        select(LmsCourseLink.course_id, LmsConnection.provider)
        .join(LmsConnection, LmsConnection.id == LmsCourseLink.connection_id)
        .where(LmsCourseLink.user_id == ctx.user_id, LmsCourseLink.course_id.in_(course_ids))
    )
    return {course_id: get_provider(kind).display_name for course_id, kind in found.all()}


register_content_source("lms", open_source, source_names)


@events.subscribe("lms.course.unlinking", in_transaction=True)
async def on_unlinking(ctx: Ctx, event: Event) -> None:
    """The course is no longer linked to this platform course: its materials with a local copy
    become the user's own files, those read online go. Its type folders stay: they are the
    user's."""
    link_id = event.data.get("link_id")
    if not isinstance(link_id, str):
        return
    mats = list(
        await ctx.db.scalars(
            select(LmsMaterial).where(LmsMaterial.link_id == link_id, LmsMaterial.state == "synced")
        )
    )
    rows = await sources.find_items(ctx, [m.item_id for m in mats if m.item_id])
    # Moved on before the items go, so `on_item_deleting` does not take them as the user's
    # deletes; the rows go with the link right after.
    for mat in mats:
        enter(mat, "absent", ctx.now)
    await sources.purge_items(ctx, [r for r in rows if not has_copy(r)])
    await sources.detach_from_source(ctx, [r for r in rows if has_copy(r)])


@events.subscribe("files.item.deleting", in_transaction=True)
async def on_item_deleting(ctx: Ctx, event: Event) -> None:
    """A followed item is being deleted, in this transaction. The sync's own deletes move the
    material on first, so one still `synced` is the user's: it is not brought back
    (`dismissed`), and the status panel lists it under the removed materials at once, where it
    can be restored."""
    item_id = event.data.get("item_id")
    if event.data.get("source_kind") != "lms" or not isinstance(item_id, str):
        return
    found = (
        await ctx.db.execute(
            select(LmsMaterial, LmsCourseLink)
            .join(LmsCourseLink, LmsCourseLink.id == LmsMaterial.link_id)
            .where(
                LmsMaterial.user_id == ctx.user_id,
                LmsMaterial.item_id == item_id,
                LmsMaterial.state == "synced",
            )
        )
    ).one_or_none()
    if found is None:
        return
    mat, link = found
    enter(mat, "dismissed", ctx.now)
    await events.publish(ctx, UPDATED, {"program_id": link.program_id})


async def _restorable(ctx: Ctx, link: LmsCourseLink) -> bool:
    """Only where the materials sync: elsewhere nothing would bring a removed one back."""
    return link.sync_enabled and (await material_settings(ctx, link.course_id)).sync


async def restore(ctx: Ctx, material_id: str) -> str:
    """A material the user deleted comes in again, quietly, with a sync queued now. Returns its
    Program."""
    mat = await ctx.db.get(LmsMaterial, material_id)
    if mat is None or mat.user_id != ctx.user_id:
        raise not_found("lms_material", material_id)
    link = await ctx.db.get(LmsCourseLink, mat.link_id)
    assert link is not None
    await hold(ctx, link)
    await ctx.db.refresh(mat)
    if mat.state != "dismissed" or not await _restorable(ctx, link):
        raise lms_error("lms.sync_nothing_to_resolve")
    enter(mat, "absent", ctx.now, quiet=True)
    await sync_queue(ctx, [link], manual=True)
    return link.program_id


async def restore_all(ctx: Ctx, program_id: str) -> None:
    """Every material the user deleted in the Program's syncing courses comes in again, as with
    `restore`: all in this transaction, one sync queued per course."""
    await academics.get_program_row(ctx, program_id)  # owned, or not found
    links = [
        li for li in await service.program_links(ctx, program_id) if await _restorable(ctx, li)
    ]
    if not links:
        return
    await hold(ctx, links[0])  # the database's write lock: one for every course
    by_id = {li.id: li for li in links}
    restored: dict[str, LmsCourseLink] = {}
    for mat in await ctx.db.scalars(
        select(LmsMaterial)
        .where(
            LmsMaterial.user_id == ctx.user_id,
            LmsMaterial.link_id.in_(list(by_id)),
            LmsMaterial.state == "dismissed",
        )
        .execution_options(populate_existing=True)
    ):
        enter(mat, "absent", ctx.now, quiet=True)
        restored[mat.link_id] = by_id[mat.link_id]
    if restored:
        await sync_queue(ctx, list(restored.values()), manual=True)


async def unreadable(
    ctx: Ctx, links: list[LmsCourseLink]
) -> list[tuple[LmsMaterial, FilesItem | None]]:
    """The materials listed under "Not syncing for now" (M09 table 3c, note): of courses whose
    materials sync, followed (`synced`) or restored and waiting (`absent` with `quiet`), whose
    last single read was refused since their area is closed. With their course file, if any."""
    links = [li for li in links if (await material_settings(ctx, li.course_id)).sync]
    if not links:
        return []
    ids = [li.id for li in links]
    held = {
        (c.link_id, c.kind, c.external_id)
        for c in await ctx.db.scalars(
            select(LmsItemCheck).where(
                LmsItemCheck.user_id == ctx.user_id,
                LmsItemCheck.link_id.in_(ids),
                LmsItemCheck.result == "unavailable",
                LmsItemCheck.reason == AREA_HIDDEN,
            )
        )
    }
    mats = [
        m
        for m in await ctx.db.scalars(
            select(LmsMaterial)
            .where(
                LmsMaterial.user_id == ctx.user_id,
                LmsMaterial.link_id.in_(ids),
                (LmsMaterial.state == "synced")
                | ((LmsMaterial.state == "absent") & LmsMaterial.quiet),
            )
            .execution_options(populate_existing=True)
        )
        if (m.link_id, m.kind, m.external_id) in held
    ]
    rows = {r.id: r for r in await sources.find_items(ctx, [m.item_id for m in mats if m.item_id])}
    return [(m, rows.get(m.item_id or "")) for m in mats]


def removable(mat: LmsMaterial, row: FilesItem | None) -> bool:
    """Only a followed material read from the platform: a saved copy may be the user's only
    one, so it is never removed from this list (M09 table 3c, note)."""
    return mat.state == "synced" and row is not None and not has_copy(row)


async def _remove(ctx: Ctx, mat: LmsMaterial, row: FilesItem) -> None:
    """Table 4a, "remove in Not syncing for now": dismissed first, so `on_item_deleting` finds
    nothing left to dismiss; then the course file goes."""
    enter(mat, "dismissed", ctx.now)
    await sources.purge_items(ctx, [row])


async def remove_unreadable(ctx: Ctx, material_id: str) -> str:
    """Removes one material listed under "Not syncing for now" that has no local copy. Returns
    its Program."""
    mat = await ctx.db.get(LmsMaterial, material_id)
    if mat is None or mat.user_id != ctx.user_id:
        raise not_found("lms_material", material_id)
    link = await ctx.db.get(LmsCourseLink, mat.link_id)
    assert link is not None
    await hold(ctx, link)
    found = dict((m.id, row) for m, row in await unreadable(ctx, [link]))
    row = found.get(mat.id)
    if mat.id not in found or row is None or not removable(mat, row):
        raise lms_error("lms.sync_nothing_to_resolve")
    await _remove(ctx, mat, row)
    await events.publish(ctx, UPDATED, {"program_id": link.program_id})
    return link.program_id


async def remove_all_unreadable(ctx: Ctx, program_id: str) -> None:
    """Removes every such material of the Program, in one transaction."""
    await academics.get_program_row(ctx, program_id)  # owned, or not found
    links = await service.program_links(ctx, program_id)
    if links:
        await hold(ctx, links[0])  # the database's write lock: one for every course
    found = [(m, row) for m, row in await unreadable(ctx, links) if removable(m, row)]
    if not found:
        raise lms_error("lms.sync_nothing_to_resolve")
    for mat, row in found:
        assert row is not None
        await _remove(ctx, mat, row)
    await events.publish(ctx, UPDATED, {"program_id": program_id})


async def _scope_links(ctx: Ctx, course_id: str | None) -> list[LmsCourseLink]:
    if course_id is None:
        return await service.user_links(ctx)
    await academics.get_course_row(ctx, course_id)  # owned, or not found
    link = await service.link_row(ctx, course_id)
    if link is None:
        raise lms_error("lms.course_not_linked")
    return [link]


async def _held_links(links: list[LmsCourseLink], ctx: Ctx) -> list[LmsCourseLink]:
    """Of `links`, the courses whose materials no longer sync."""
    return [li for li in links if not (await material_settings(ctx, li.course_id)).sync]


async def _left(ctx: Ctx, link: LmsCourseLink) -> tuple[list[LmsMaterial], list[FilesItem]]:
    """The materials the sync left in the course files and their items, without the ones the
    user chose to keep for themselves (saved from the Canvas tab, or "Save in Semestra" on the
    file): those are the user's own decision, and are neither counted nor removed."""
    mats = [
        m
        for m in await ctx.db.scalars(
            select(LmsMaterial)
            .where(LmsMaterial.link_id == link.id, LmsMaterial.state == "synced")
            .execution_options(populate_existing=True)
        )
        if m.item_id
    ]
    rows = {
        r.id: r
        for r in await sources.find_items(ctx, [m.item_id for m in mats if m.item_id])
        if r.keep_copy is not True
    }
    mats = [m for m in mats if m.item_id in rows]
    return mats, [rows[m.item_id] for m in mats if m.item_id]


async def held(ctx: Ctx, course_id: str | None) -> HeldMaterials:
    """What turning the materials sync off left in the course files (they stay, no longer
    updated), so the user can take it out (`remove_held`)."""
    out = HeldMaterials(courses=0, local=0, online=0)
    for link in await _held_links(await _scope_links(ctx, course_id), ctx):
        _, rows = await _left(ctx, link)
        if not rows:
            continue
        local = sum(1 for r in rows if has_copy(r))
        out.courses += 1
        out.local += local
        out.online += len(rows) - local
    return out


async def remove_held(ctx: Ctx, course_id: str | None) -> HeldMaterials:
    """Deletes the materials left in the course files after their sync was turned off, local
    copies too, except the ones the user kept for themselves (`_left`). They are not dismissed:
    turning the sync on again brings them back (`absent`), unlike a material the user deleted by
    hand."""
    scope = await _scope_links(ctx, course_id)
    if not scope:
        raise lms_error("lms.sync_nothing_to_resolve")
    await hold(ctx, scope[0])  # the database's write lock: one for every course
    # The settings are read under the lock, like a sync stage does (`run`).
    links = await _held_links(scope, ctx)
    if not links:
        raise lms_error("lms.sync_nothing_to_resolve")
    for link in links:
        mats, rows = await _left(ctx, link)
        if not mats:
            continue
        # Before the items go, so `on_item_deleting` does not take them as the user's deletes.
        for mat in mats:
            enter(mat, "absent", ctx.now)
        await sources.purge_items(ctx, rows)
        await events.publish(ctx, UPDATED, {"program_id": link.program_id})
    return await held(ctx, course_id)


@events.subscribe("settings.values.updated", in_transaction=True)
async def on_store_changing(ctx: Ctx, event: Event) -> None:
    """The way a course keeps its materials changed (its own value, or the account's it
    follows): the choices made for single files there are cleared, so every file follows the
    new setting (owner 2026-11-19: the last change the user made wins). In the settings'
    transaction, before the change is applied after it commits (`on_settings_changed`)."""
    data = event.data
    scope = data.get("scope")
    if (
        data.get("namespace") != "lms.materials"
        or "store" not in (data.get("changed") or [])
        or not isinstance(scope, dict)
    ):
        return
    if scope.get("type") == "account":
        links = [
            link
            for link in await service.user_links(ctx)
            if (
                await settings_service.get_values(ctx, "lms.materials", "course", link.course_id)
            ).sources.get("store")
            != "course"
        ]
    elif scope.get("type") == "course" and isinstance(scope_id := scope.get("id"), str):
        link = await service.link_row(ctx, scope_id)
        links = [link] if link is not None else []
    else:
        return
    for link in links:
        await sources.reset_copy_choices(ctx, await synced_items(ctx, link.id))


@events.subscribe("settings.values.updated")
async def on_settings_changed(ctx: Ctx, event: Event) -> None:
    """The materials settings of the account or a course changed: turned on, the courses sync
    now and quietly, as at first (what came meanwhile is not told as new); a new way of keeping
    them applies at once (local copies let go, or stored). A course with its own value is left
    alone by a change to the account's (`material_settings` reads what applies)."""
    data = event.data
    scope = data.get("scope")
    changed = set(data.get("changed") or [])
    if data.get("namespace") != "lms.materials" or not isinstance(scope, dict):
        return
    if scope.get("type") == "account":
        links = await service.user_links(ctx)
    elif scope.get("type") == "course" and isinstance(scope_id := scope.get("id"), str):
        link = await service.link_row(ctx, scope_id)
        links = [link] if link is not None else []
    else:
        return
    turned_on: list[LmsCourseLink] = []
    again: list[LmsCourseLink] = []
    for link in links:
        if not link.sync_enabled:
            continue
        cfg = await material_settings(ctx, link.course_id)
        if "sync" in changed and cfg.sync:
            # What the platform added while off is not news: the next run is quiet again.
            link.materials_settled_at = None
            turned_on.append(link)
        if "store" in changed and cfg.store == "local":
            await sources.apply_copies(
                ctx,
                await synced_items(ctx, link.id),
                True,
            )
        elif "store" in changed and cfg.sync:
            # Read from the platform again: the copies go with the next run, once it has read
            # the course whole (they may be the only ones left of a course closed there).
            again.append(link)
    await sync_queue(ctx, [*turned_on, *(li for li in again if li not in turned_on)])
