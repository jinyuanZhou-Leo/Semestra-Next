"""The `files` stage of the course sync (M09 §4.2): the course's files, pages and links on the
platform become items of the course's files (M07), in the folders they are in on the platform
(`material_reads` reads them and tells what left).

Every item keeps following the platform: a changed file is read again, a renamed one renamed.
By default nothing is copied: an item follows the platform (`source_kind` `lms`; which file or
page it is, its `LmsMaterial.item_id` says, M09 §4.6) and M07 reads the bytes from the platform
when they are needed (`material_items.open_source`, its content source), so the materials take
none of the user's storage. With the course's `store`
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

A run reads the platform first, then, under the write lock (a batch of new items at a time,
each in a transaction of its own: `_write`), takes what happened to each material to
`materials.enter` its next state (table 4a).
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.modules.files import sources
from semestra.modules.files.models import FilesItem
from semestra.modules.files.source_folders import SourceFolders
from semestra.modules.lms import material_reads
from semestra.modules.lms.material_items import has_copy
from semestra.modules.lms.material_reads import Found, Key, Material
from semestra.modules.lms.materials import enter, note
from semestra.modules.lms.models import LmsCourseLink, LmsMaterial
from semestra.modules.lms.rules import Presence
from semestra.modules.lms.service import Bound
from semestra.modules.lms.settings import materials as material_settings
from semestra.modules.lms.sync import Notice, StageResult, hold, register_sync_stage
from semestra.modules.lms.sync_round import SyncRound

# New items written in one transaction: a run brings in all it found, a batch at a time, so the
# write lock is let go between them.
BATCH = 100
# A file the platform failed to give is read again after this; a copy it refused to give (the
# file unpublished, or not there) is asked for again after it too.
RETRY_AFTER = timedelta(hours=1)
REFUSED = frozenset(("lms.not_found", "lms.forbidden"))


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
            version=m.version,
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
        version=m.version,
        url=m.web_url,
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
    changed = sources.source_changed(row, m.version)
    if m.kind == "link":
        if changed or retitled:
            await sources.update_link(
                ctx, row, url=m.url or row.url or "", name=title, version=m.version
            )
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
    """What this run saw of the platform's item; what it did not read again stays. Its version
    only while it has no followed item, whose own version it is then (M09 §4.6)."""
    mat.title, mat.path = m.title, [list(level) for level in m.path]
    mat.version = m.version if mat.state != "synced" else None
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


def _copy_due(row: FilesItem, now: datetime) -> bool:
    """A local copy the platform refused to give is asked for again after `RETRY_AFTER`, not on
    every run."""
    return row.copy_error_code not in REFUSED or now - row.updated_at >= RETRY_AFTER


def _material(ctx: Ctx, link: LmsCourseLink, m: Material) -> LmsMaterial:
    mat = LmsMaterial(user_id=ctx.user_id, link_id=link.id, kind=m.kind, external_id=m.external_id)
    ctx.db.add(mat)
    return mat


@dataclass
class _Run:
    link: LmsCourseLink
    b: Bound
    sync_round: SyncRound
    found: Found
    verdicts: dict[Key, Presence]
    result: StageResult = field(default_factory=StageResult)
    # Items written by an earlier batch of this run.
    applied: set[Key] = field(default_factory=lambda: set[Key]())


async def _known(ctx: Ctx, link: LmsCourseLink, *, again: bool = False) -> dict[Key, LmsMaterial]:
    query = select(LmsMaterial).where(LmsMaterial.link_id == link.id)
    if again:
        query = query.execution_options(populate_existing=True)
    return {(r.kind, r.external_id): r for r in await ctx.db.scalars(query)}


async def run(ctx: Ctx, link: LmsCourseLink, b: Bound, sync_round: SyncRound) -> StageResult:
    known = await _known(ctx, link)
    found = await material_reads.read(ctx, link, b, sync_round, known)
    verdicts = await material_reads.judge(ctx, link, b, sync_round, found)
    r = _Run(link, b, sync_round, found, verdicts)
    # Written a batch at a time, each in a transaction of its own: a large course comes in whole
    # in one run without holding the write lock all the while.
    while await _write(ctx, r):
        await ctx.db.commit()
    return r.result


async def _write(ctx: Ctx, r: _Run) -> bool:
    """Applies what the run found, under the write lock: up to `BATCH` new items, then (once every
    one is in) what left the platform and the local copies. True when items are left for another
    batch."""
    link, b, found, result = r.link, r.b, r.found, r.result
    await hold(ctx, link)
    await r.sync_round.save(ctx, link, material_reads.READABLE)
    # Under the lock: the user may have turned the sync off (and removed what it left) while the
    # platform was read; bringing it all back now would undo that.
    cfg = await material_settings(ctx, link.course_id)
    if not cfg.sync:
        return False
    # Read again under the write lock: the user may have answered (deleted, moved) meanwhile.
    known = await _known(ctx, link, again=True)
    rows = {
        x.id: x
        for x in await sources.find_items(
            ctx, [x.item_id for x in known.values() if x.state == "synced" and x.item_id]
        )
    }
    now = ctx.now
    # What came in before the course settled is not news.
    settled = link.materials_settled_at is not None
    places = SourceFolders(ctx, link.course_id, "lms", b.provider.display_name)
    # Read once for the batch, not for each new item.
    own = await sources.own_files(ctx, link.course_id)
    auto_index = await sources.reads_text(ctx, link.course_id)

    added = 0
    gone: list[FilesItem] = []
    handed: list[FilesItem] = []
    for key, m in found.materials.items():
        if key in r.applied:
            continue
        mat = known.get(key)
        row = rows.get(mat.item_id or "") if mat is not None and mat.state == "synced" else None
        if mat is not None and mat.state == "dismissed":
            _seen(mat, m)  # what it links to is known without reading it every run
            r.applied.add(key)
            continue
        if m.is_list:
            if mat is None:
                mat = _material(ctx, link, m)
            elif row is not None:
                gone.append(row)  # a page that has become a list of links
            if mat.state != "list":
                enter(mat, "list", now)
            _seen(mat, m)
            r.applied.add(key)
            continue
        if mat is not None and row is not None:
            if await _follow(ctx, m, mat, row) and settled:
                note(mat, "updated", now)
            _seen(mat, m)
            await places.follow_names(m.path)
            r.applied.add(key)
            continue
        # New, back on the platform, restored, or a list page that has become a page.
        if added == BATCH:
            await sources.purge_items(ctx, gone)
            await ctx.db.flush()
            return True
        added += 1
        news = settled and not (mat is not None and mat.quiet)
        folder_id = await places.folder_at(m.path)
        row = await _create(ctx, link, b, m, folder_id, unseen=news, auto_index=auto_index)
        rows[row.id] = row
        if mat is None:
            mat = _material(ctx, link, m)
        enter(mat, "synced", now, item_id=row.id)
        _seen(mat, m)
        mat.name, mat.placed_folder_id = row.display_name, folder_id
        r.applied.add(key)
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
        if r.verdicts.get(key) != "gone":
            continue
        if mat.state == "absent" and mat.quiet:
            if mat.state_at is not None and mat.state_at > (r.sync_round.started or now):
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
    left = {x.id for x in (*gone, *handed)}

    followed = [row for row in rows.values() if row.id not in left]
    for row in followed:
        if _retry_due(row, now):
            await sources.retry_synced(ctx, row)
    # A copy is let go only when the platform gave the item itself this round (table 3c, note):
    # in a list of its own area, or read on its own. One only a module lists may be refused when
    # read (its area closed), and its copy may be the only one left.
    there = {
        mat.item_id
        for key, mat in known.items()
        if mat.state == "synced" and key in found.given and key not in found.locked
    }
    copies = [row for row in followed if _copy_due(row, now)]
    store = cfg.store == "local"
    await sources.apply_copies(ctx, [row for row in copies if row.id in there], store)
    await sources.apply_copies(
        ctx, [row for row in copies if row.id not in there], store, release=False
    )
    if not settled and not r.sync_round.out_of_budget:
        link.materials_settled_at = now
    await ctx.db.flush()
    return False


async def _enabled(ctx: Ctx, link: LmsCourseLink, b: Bound) -> bool:
    if not {"modules", "pages", "folders"} & b.provider.features:
        return False
    return (await material_settings(ctx, link.course_id)).sync


register_sync_stage("files", run, order=60, enabled=_enabled)
