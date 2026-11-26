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
from semestra.modules.lms.materials import Impossible, enter, note
from semestra.modules.lms.models import LmsCourseLink, LmsMaterial
from semestra.modules.lms.providers import Call
from semestra.modules.lms.rules import Presence
from semestra.modules.lms.service import Bound
from semestra.modules.lms.settings import materials as material_settings
from semestra.modules.lms.sync import (
    Notice,
    Shared,
    StageResult,
    hold,
    one_item,
    register_sync_stage,
)
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
    if not changed:
        # Read again when M07's reader changed since (a page's formulas; `Found.reread` had the
        # platform read it this round); not a change of the platform's, so not told as one.
        await sources.read_again_if_outdated(ctx, row)
    if title is not None:
        mat.name = row.display_name  # as named now (made unique in its folder)
    if m.modified_at is not None and row.source_modified_at != m.modified_at:
        row.source_modified_at = m.modified_at  # read the first time, or a rename moved it
    return changed


def _seen(mat: LmsMaterial, m: Material) -> None:
    """What this run saw of the platform's item; what it did not read again stays. Its version
    only while it has no followed item, whose own version it is then (M09 §4.6)."""
    mat.title = m.title
    if m.path is not None:  # else this run found it only by a way in that is no place: as it was
        mat.path = [list(level) for level in m.path]
    mat.version = m.version if mat.state != "synced" else None
    if m.links is not None:
        mat.links = m.links
    if m.attached is not None:  # else this run did not read every way in whole: as it was
        mat.attached = m.attached


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
    # Materials written by an earlier batch of this run.
    applied: set[Key] = field(default_factory=lambda: set[Key]())
    # Materials whose write failed this run (M09 table 5b, row 7): left as they were.
    failed: set[Key] = field(default_factory=lambda: set[Key]())


async def _known(ctx: Ctx, link: LmsCourseLink, *, again: bool = False) -> dict[Key, LmsMaterial]:
    query = select(LmsMaterial).where(LmsMaterial.link_id == link.id)
    if again:
        query = query.execution_options(populate_existing=True)
    return {(r.kind, r.external_id): r for r in await ctx.db.scalars(query)}


async def run(ctx: Ctx, link: LmsCourseLink, b: Bound, sync_round: SyncRound) -> StageResult:
    known = await _known(ctx, link)
    cfg = await material_settings(ctx, link.course_id)
    found = await material_reads.read(ctx, link, b, sync_round, known, cfg)
    verdicts = await material_reads.judge(ctx, link, b, sync_round, found)
    r = _Run(link, b, sync_round, found, verdicts)
    # Written a batch at a time, each in a transaction of its own: a large course comes in whole
    # in one run without holding the write lock all the while.
    while await _write(ctx, r):
        await ctx.db.commit()
    return r.result


@dataclass
class _Batch:
    """What one batch of `_write` works with, shared by its materials."""

    r: _Run
    rows: dict[str, FilesItem]  # the followed items, by id
    places: SourceFolders
    # The user's own files of the course (to tell a duplicate) and whether new files are read
    # for their text: worked out once, for the materials that need them (table 5b, row 6).
    own: Shared[list[tuple[str, int, str | None]]]
    auto_index: Shared[bool]
    settled: bool
    now: datetime


async def _write(ctx: Ctx, r: _Run) -> bool:
    """Applies what the run found, under the write lock: up to `BATCH` new items, then (once every
    one is in) what left the platform and the local copies. Each material on its own
    (`one_item`): one that fails is left as it was and skipped for the rest of the run. True
    when items are left for another batch."""
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
    course_id = link.course_id
    w = _Batch(
        r,
        rows,
        SourceFolders(ctx, course_id, "lms", b.provider.display_name),
        Shared(lambda: sources.own_files(ctx, course_id)),
        Shared(lambda: sources.reads_text(ctx, course_id)),
        # What came in before the course settled is not news.
        settled=link.materials_settled_at is not None,
        now=ctx.now,
    )

    # Which material each followed item is, and those the platform gave this round.
    keys = {mat.item_id: key for key, mat in known.items() if mat.state == "synced"}
    # A copy is let go only when the platform gave the item itself this round (table 3c, note):
    # in a list of its own area, or read on its own. One only a module lists may be refused when
    # read (its area closed), and its copy may be the only one left.
    there = {
        item_id for item_id, key in keys.items() if key in found.given and key not in found.locked
    }

    added = 0
    left: set[str] = set()  # items no longer followed: gone, or the page became a list
    for key, m in found.materials.items():
        if key in r.applied or key in r.failed:
            continue
        mat = known.get(key)
        new = not m.is_list and (mat is None or mat.state in ("list", "absent"))
        if new:
            # New, back on the platform, restored, or a list page that has become a page.
            if added == BATCH:
                return True
            added += 1
        created = dropped = notice = None
        async with one_item(ctx, link, result, m.kind, m.external_id, m.title) as item:
            created, dropped, notice = await _found(ctx, w, m, mat)
        _done(ctx, w, key, item.ok)
        if not item.ok:
            continue  # what it made went back with it, its notice too
        if created is not None:
            rows[created.id], keys[created.id] = created, key
        if dropped is not None:
            left.add(dropped.id)
        if notice is not None:
            result.notices.append(notice)

    # Gone from the platform (table 3c): one saved in Semestra stays as the user's own file, one
    # read online goes. Either comes in again if the platform shows it again.
    for key, mat in known.items():
        if r.verdicts.get(key) != "gone" or key in r.failed:
            continue
        restored_at = mat.state_at if mat.state == "absent" and mat.quiet else None
        if restored_at is not None and restored_at > (r.sync_round.started or w.now):
            continue  # restored after this run read: left to the run after it
        row = rows.get(mat.item_id or "") if mat.state == "synced" else None
        async with one_item(ctx, link, result, mat.kind, mat.external_id, mat.title) as item:
            await _gone(ctx, w, mat, row)
        _done(ctx, w, key, item.ok)
        if item.ok and row is not None:
            left.add(row.id)

    # Files read again, local copies: each with its material.
    store = cfg.store == "local"
    room = await sources.room(ctx)
    for item_id, row in rows.items():
        key = keys[item_id]
        if item_id in left or key in r.failed:  # a failed one's objects went back expired
            continue
        before = room.left
        async with one_item(ctx, link, result, *key, row.display_name) as item:
            if _retry_due(row, w.now):
                await sources.retry_synced(ctx, row)
            if _copy_due(row, w.now):
                await sources.apply_copies(ctx, [row], store, release=row.id in there, room=room)
        if not item.ok:
            r.failed.add(key)
            room.left = before  # its copy went back: so does the room it took
    if not w.settled and not r.sync_round.out_of_budget:
        link.materials_settled_at = w.now
    await ctx.db.flush()
    return False


def _done(ctx: Ctx, w: _Batch, key: Key, ok: bool) -> None:
    if ok:
        w.r.applied.add(key)
        return
    w.r.failed.add(key)
    # The folders it made went back with it: read again for the materials after it.
    w.places = SourceFolders(ctx, w.r.link.course_id, "lms", w.r.b.provider.display_name)


async def _found(
    ctx: Ctx, w: _Batch, m: Material, mat: LmsMaterial | None
) -> tuple[FilesItem | None, FilesItem | None, Notice | None]:
    """A material the platform has this round: table 4a's `appeared` or `list`. The item it
    brought in, the one it no longer follows, and its notice for the user: the caller keeps
    them once the material is written."""
    link, now = w.r.link, w.now
    row = None
    if mat is not None and mat.state == "synced":
        row = w.rows.get(mat.item_id or "")
        if row is None:
            raise Impossible(f"lms material {mat.id}: synced, its item not found")
    if m.is_list:
        if mat is None:
            mat = _material(ctx, link, m)
        enter(mat, "list", now)
        _seen(mat, m)
        if row is not None:  # a page that has become a list of links
            await sources.purge_items(ctx, [row])
        return None, row, None
    if mat is not None and mat.state in ("synced", "dismissed"):
        enter(mat, "appeared", now)  # kept
        if row is not None:
            if await _follow(ctx, m, mat, row) and w.settled:
                note(mat, "updated", now)
            await w.places.follow_names(m.start)
        _seen(mat, m)  # a dismissed one: what it links to is known without reading it every run
        return None, None, None
    news = w.settled and not (mat is not None and mat.quiet)
    folder_id = await w.places.folder_at(m.start)
    auto_index = await w.auto_index.get()
    row = await _create(ctx, link, w.r.b, m, folder_id, unseen=news, auto_index=auto_index)
    if mat is None:
        mat = _material(ctx, link, m)
    enter(mat, "appeared", now, item_id=row.id)
    _seen(mat, m)
    mat.name, mat.placed_folder_id = row.display_name, folder_id
    # Most likely one of the user's own files: listed, so they can keep just one.
    if m.kind == "file" and any(
        sources.same_file((row.display_name, m.size, None), f) for f in await w.own.get()
    ):
        note(mat, "duplicate", now)
    elif news:
        note(mat, "added", now)
    notice = Notice("material", m.external_id, m.title, item_id=row.id) if news else None
    return row, None, notice


async def _gone(ctx: Ctx, w: _Batch, mat: LmsMaterial, row: FilesItem | None) -> None:
    """A known material gone from the platform (table 3c): table 4a's `gone`."""
    now = w.now
    if mat.state == "synced":
        if row is None:
            raise Impossible(f"lms material {mat.id}: synced, its item not found")
        if has_copy(row):
            enter(mat, "gone", now, item_id=row.id)
            note(mat, "handed_over", now)
            await sources.detach_from_source(ctx, [row])
        else:
            enter(mat, "gone", now)
            note(mat, "gone", now)
            await sources.purge_items(ctx, [row])
        return
    if mat.state == "absent":  # restored, but the platform no longer has it: told, not left waiting
        enter(mat, "gone", now)
        note(mat, "gone", now)
        return
    enter(mat, "gone", now)  # a list page


async def _enabled(ctx: Ctx, link: LmsCourseLink, b: Bound) -> bool:
    if not {"modules", "pages", "folders", "syllabus"} & b.provider.features:
        return False
    return (await material_settings(ctx, link.course_id)).sync


def _reads(link: LmsCourseLink, b: Bound, sync_round: SyncRound) -> list[Call]:
    """The lists `material_reads.read` reads of every course (the syllabus comes with the
    course itself)."""
    del sync_round
    ext = link.external_course_id
    features = b.provider.features
    wanted = {"modules": "modules", "pages": "pages", "folders": "course_files"}
    return [Call(method, (ext,)) for feature, method in wanted.items() if feature in features]


register_sync_stage(
    "files", run, order=60, enabled=_enabled, parts=material_reads.PARTS, reads=_reads
)
