"""The `files` stage of the course sync (M09 §4.2): the course's files, pages and links on the
platform become items of the course's files (M07), in the folders they are in on the platform
(`material_reads` reads them and tells what left).

Every item keeps following the platform: a changed file is read again, a renamed one renamed.
By default nothing is copied: an item names its platform file or page (`source_ref`) and M07
reads the bytes from the platform when they are needed (`material_items.open_source`, its
content source), so the materials take none of the user's storage. With the course's `store`
setting at `local` (M11 namespace `lms.materials`, account and course) a local copy is kept too,
so they open after the platform course closes (`sources.apply_copies`; the user may choose
otherwise for one file). Their text is read and indexed like any file's (M07's `auto_index`),
for search and Sem.

Each platform item has a row in `lms_materials` (`LmsMaterial`, whose states are explained
there) with its item and what was last applied (platform title, content version, name, place).
The user's changes always win: a moved item stays where they put it (an item is placed once,
when it comes in; one the sync put somewhere else than its place now is offered to move back by
the course's "Organize", `material_items.homes`), a renamed one keeps their name, a deleted one
is not brought back until they restore it (`dismissed`). A folder of a place the user deleted is
not made again: its new items go to the folder above.

An item gone from the platform (table 3c) becomes `absent`: one saved in Semestra stays as the
user's own file (`handed_over`), one read online is removed (`gone`); either comes in again if
the platform shows it again. One locked on the platform is still there: it stays as it was.
What left, and what came in or changed, shows in the status panel's recent updates (`change`);
new ones are marked unseen in the files and told by notification. Not until the course has
settled (`materials_settled_at`, the first run that brought everything in): linking a course is
quiet.

A run reads the platform first, then, under the write lock, takes what happened to each material
to `materials.enter` its next state (table 4a).
"""

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.modules.files import sources
from semestra.modules.files.models import FilesItem
from semestra.modules.files.source_folders import SourceFolders
from semestra.modules.lms import material_reads
from semestra.modules.lms.material_items import has_copy
from semestra.modules.lms.material_reads import Material
from semestra.modules.lms.materials import enter, note, source_ref
from semestra.modules.lms.models import LmsCourseLink, LmsMaterial
from semestra.modules.lms.service import Bound
from semestra.modules.lms.settings import materials as material_settings
from semestra.modules.lms.sync import Notice, StageResult, hold, register_sync_stage
from semestra.modules.lms.sync_round import SyncRound

# New items one run adds; the next run goes on.
PER_RUN = 100
# A file the platform failed to give is read again after this.
RETRY_AFTER = timedelta(hours=1)


async def _create(
    ctx: Ctx,
    link: LmsCourseLink,
    b: Bound,
    m: Material,
    folder_id: str | None,
    *,
    unseen: bool,
    auto_index: bool,
) -> FilesItem:
    if m.kind == "link":
        out = await sources.create_link(
            ctx,
            link.course_id,
            m.url or "",
            m.title,
            folder_id,
            source_kind="lms",
            source_ref=source_ref("link", m.external_id),
            source_name=b.provider.display_name,
        )
        [row] = await sources.find_items(ctx, [out.id])
        return row
    return await sources.add_remote_file(
        ctx,
        link.course_id,
        folder_id,
        name=m.title,
        mime=m.mime,
        size=m.size,
        source_ref=source_ref(m.kind, m.external_id),
        version=m.version,
        url=m.web_url,
        source_name=b.provider.display_name,
        modified_at=m.modified_at,
        unseen=unseen,
        auto_index=auto_index,
    )


async def _follow(ctx: Ctx, m: Material, mat: LmsMaterial, row: FilesItem) -> bool:
    """The item follows the platform's, except where the user changed it: a new name unless
    they renamed it, new contents (read again only when the bytes changed, not on a rename; a
    local copy is let go until stored again). True when the contents changed. `mat.name` is
    what the sync named it: the user's own name never takes its place, so it stays theirs."""
    title = None if row.display_name != mat.name else m.title
    # Named anew when its name here would change (not on every new spelling of the title): also
    # mends a name an older sync cut at a slash.
    retitled = title is not None and sources.name_from_source(title) not in ("", mat.name)
    changed = mat.version != m.version
    if m.kind == "link":
        if changed or retitled:
            await sources.update_link(ctx, row, url=m.url or row.url or "", name=title)
    elif changed:
        await sources.update_remote_file(
            ctx,
            row,
            name=title,
            mime=m.mime,
            size=m.size,
            version=m.version,
            url=m.web_url,
            modified_at=m.modified_at,
        )
    elif retitled and title is not None:
        await sources.rename_synced(ctx, row, title)
    if title is not None:
        mat.name = row.display_name  # as named now (made unique in its folder)
    if m.modified_at is not None and row.source_modified_at != m.modified_at:
        row.source_modified_at = m.modified_at  # read the first time, or a rename moved it
    return changed


def _seen(mat: LmsMaterial, m: Material) -> None:
    """What this run saw of the platform's item; what it did not read again stays."""
    mat.title, mat.version, mat.path = m.title, m.version, [list(level) for level in m.path]
    if m.links is not None:
        mat.links = m.links


def _retry_due(row: FilesItem, now: datetime) -> bool:
    """A file the platform did not give (it was down, the credentials were missing) is read
    again: at once when it never was, else after `RETRY_AFTER`."""
    if row.doc_status != "failed" or not sources.remote(row):
        return False
    code = row.doc_error_code or ""
    if code == sources.SOURCE_UNREAD:
        return True
    return code.startswith("lms.") and now - row.updated_at >= RETRY_AFTER


def _material(ctx: Ctx, link: LmsCourseLink, m: Material) -> LmsMaterial:
    mat = LmsMaterial(user_id=ctx.user_id, link_id=link.id, kind=m.kind, external_id=m.external_id)
    ctx.db.add(mat)
    return mat


async def run(ctx: Ctx, link: LmsCourseLink, b: Bound, sync_round: SyncRound) -> StageResult:
    def read_materials() -> Any:
        return select(LmsMaterial).where(LmsMaterial.link_id == link.id)

    mats = list(await ctx.db.scalars(read_materials()))
    known = {(r.kind, r.external_id): r for r in mats}
    found = await material_reads.read(ctx, link, b, sync_round, known)
    verdicts = await material_reads.judge(ctx, link, b, sync_round, found)
    release = material_reads.all_read(sync_round)

    await hold(ctx, link)
    await sync_round.save(ctx, link, material_reads.READABLE)
    # Under the lock: the user may have turned the sync off (and removed what it left) while the
    # platform was read; bringing it all back now would undo that.
    cfg = await material_settings(ctx, link.course_id)
    if not cfg.sync:
        return StageResult()
    # Read again under the write lock: the user may have answered (deleted, moved) meanwhile.
    mats = list(await ctx.db.scalars(read_materials().execution_options(populate_existing=True)))
    known = {(r.kind, r.external_id): r for r in mats}
    rows = {
        r.id: r
        for r in await sources.find_items(
            ctx, [r.item_id for r in known.values() if r.state == "synced" and r.item_id]
        )
    }
    now = ctx.now
    for mat in known.values():
        if mat.state == "synced" and mat.item_id not in rows:
            # The user deleted it (told at once by `files.item.deleted`, unless that was missed).
            enter(mat, "dismissed", now)
    # What came in before the course settled is not news.
    settled = link.materials_settled_at is not None
    places = SourceFolders(ctx, link.course_id, "lms", b.provider.display_name)
    # Read once for the run, not for each new item.
    own = await sources.own_files(ctx, link.course_id)
    auto_index = await sources.reads_text(ctx, link.course_id)

    result = StageResult()
    added: list[FilesItem] = []
    gone: list[FilesItem] = []
    handed: list[FilesItem] = []
    for key, m in found.materials.items():
        mat = known.get(key)
        row = rows.get(mat.item_id or "") if mat is not None and mat.state == "synced" else None
        if mat is not None and mat.state == "dismissed":
            continue
        if m.is_list:
            if mat is None:
                mat = _material(ctx, link, m)
            elif row is not None:
                gone.append(row)  # a page that has become a list of links
            if mat.state != "list":
                enter(mat, "list", now)
            _seen(mat, m)
            continue
        if mat is not None and row is not None:
            if await _follow(ctx, m, mat, row) and settled:
                note(mat, "updated", now)
            _seen(mat, m)
            await places.follow_names(m.path)
            continue
        # New, back on the platform, restored, or a list page that has become a page.
        if len(added) >= PER_RUN:
            result.cap_reached = True
            continue
        news = settled and not (mat is not None and mat.quiet)
        folder_id = await places.folder_at(m.path)
        row = await _create(ctx, link, b, m, folder_id, unseen=news, auto_index=auto_index)
        added.append(row)
        if mat is None:
            mat = _material(ctx, link, m)
        enter(mat, "synced", now, item_id=row.id)
        _seen(mat, m)
        mat.name, mat.placed_folder_id = row.display_name, folder_id
        # Most likely one of the user's own files: listed, so they can keep just one.
        if m.kind == "file" and any(
            sources.same_file((row.display_name, m.size, None), f) for f in own
        ):
            note(mat, "duplicate", now)
        elif news:
            note(mat, "added", now)
        if news:
            result.notices.append(Notice("material", m.external_id, m.title, item_id=row.id))

    # Gone from the platform (table 3c): one saved in Semestra stays as the user's own file, one
    # read online goes. Either comes in again if the platform shows it again.
    for key, mat in known.items():
        if verdicts.get(key) != "gone":
            continue
        if mat.state == "absent" and mat.quiet:
            if mat.state_at is not None and mat.state_at > (sync_round.started or now):
                continue  # restored after this run read: left to the run after it
            # Restored, but the platform no longer has it: told, not left waiting.
            enter(mat, "absent", now)
            note(mat, "gone", now)
        elif mat.state == "list":
            enter(mat, "absent", now)
        elif mat.state == "synced" and (row := rows.get(mat.item_id or "")) is not None:
            if has_copy(row):
                handed.append(row)
                enter(mat, "absent", now, item_id=row.id)
                note(mat, "handed_over", now)
            else:
                gone.append(row)
                enter(mat, "absent", now)
                note(mat, "gone", now)
    await sources.purge_items(ctx, gone)
    await sources.detach_from_source(ctx, handed)
    left = {r.id for r in (*gone, *handed)}

    followed = [r for r in (*rows.values(), *added) if r.id not in left]
    for row in followed:
        if _retry_due(row, now):
            await sources.retry_synced(ctx, row)
    # Copies are let go only on a run that read every area whole (table 3c, note).
    await sources.apply_copies(ctx, followed, cfg.store == "local", release=release)
    if not settled and not result.cap_reached and not sync_round.out_of_budget:
        link.materials_settled_at = now
    await ctx.db.flush()
    return result


async def _enabled(ctx: Ctx, link: LmsCourseLink, b: Bound) -> bool:
    if not {"modules", "pages", "folders"} & b.provider.features:
        return False
    return (await material_settings(ctx, link.course_id)).sync


register_sync_stage("files", run, order=60, enabled=_enabled)
