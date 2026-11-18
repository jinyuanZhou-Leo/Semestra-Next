"""The `files` stage of the course sync (M09 §4.2): the course's files, pages and links on the
platform become items of the course's files (M07), in type folders (`files.sorting`).

Every item keeps following the platform: a changed file is read again, a renamed one renamed.
By default nothing is copied: an item names its platform file or page (`source_ref`) and M07
reads the bytes from the platform when they are needed (`open_source`, registered as its content
source), so the materials take none of the user's storage. With the course's `store` setting at
`local` (M11 namespace `lms.materials`, Program and course) a local copy is kept too, so they open
after the platform course closes (`sources.apply_copies`; the user may choose otherwise for one
file). Their text is read and indexed like any file's (M07's `auto_index`), for search and Sem.

Each platform item has a row in `lms_materials` (`LmsMaterial`, whose states are explained
there) with its item and what was last applied (platform title, content version, name, type).
The user's changes always win: a moved item stays where they put it, a renamed one keeps their
name, a deleted one is not brought back until they restore it (`dismissed`), one they made their
own is not followed (`handed_over`). Type folders are made on first need and remembered (M07's
`files_type_folders`, `sorting.folder_for`); once the user deleted one, the type's new items go
to the top level.

An item gone from the platform (deleted, locked again), judged only on a run that read every area
whole: with a local copy it becomes the user's own file (`handed_over`); read online, it is
removed (`gone`) and comes back if the platform shows it again. Both, and what came in or
changed, show in the status panel's recent updates (`change`); new ones are marked unseen in the
files and told by notification. Not until the course has settled (`materials_settled_at`, the
first run that brought everything in): linking a course is quiet.

Pages that are only a list of links (a module's table of contents) are not kept; what they list
is filed by their title. Files and pages that pages link to come in too (courses that hide their
files area link their files from pages).
"""

from collections.abc import AsyncIterator, Awaitable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from html import escape
from typing import Any, Literal

from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.errors import AppError, not_found
from semestra.core.events import Event, events
from semestra.modules.files import register_content_source, sorting, sources
from semestra.modules.files.models import FilesItem
from semestra.modules.files.sorting import Clues, MaterialType, classify
from semestra.modules.lms import reads, service
from semestra.modules.lms.errors import lms_error
from semestra.modules.lms.materials import page_shape
from semestra.modules.lms.models import LmsCourseLink, LmsMaterial, MaterialChange, MaterialState
from semestra.modules.lms.reads import AREA_REFUSALS, ITEM_ERRORS
from semestra.modules.lms.schemas.dto import FileMeta, ModuleItem
from semestra.modules.lms.service import Bound
from semestra.modules.lms.settings import materials as material_settings
from semestra.modules.lms.sync import UPDATED, Notice, StageResult, hold, register_sync_stage
from semestra.modules.lms.sync import queue as sync_queue

MaterialKind = Literal["file", "page", "link"]
Key = tuple[str, str]
# New items one run adds; the next run goes on.
PER_RUN = 100
# Errors that mean an area of the course is hidden from the user: the stage goes on without it.
SKIPPED = AREA_REFUSALS | {"lms.area_hidden", "lms.feature_unsupported"}
# Items no list gives a version for (a file only a module or page shows, a page when the pages
# area is hidden) are read one by one: this often, not every run.
CHECK_EVERY = timedelta(days=1)
# A file the platform failed to give is read again after this.
RETRY_AFTER = timedelta(hours=1)


def source_ref(kind: MaterialKind, external_id: str) -> str:
    return f"lms:{kind}:{external_id}"


@dataclass
class Material:
    kind: MaterialKind
    external_id: str
    title: str
    # Changes when the bytes do (not on a rename).
    version: str
    size: int = 0
    mime: str | None = None
    web_url: str | None = None
    # When the platform last changed it.
    modified_at: datetime | None = None
    # A link's address.
    url: str | None = None
    subheader: str | None = None
    module: str | None = None
    folder_path: str | None = None
    listed_by: list[str] = field(default_factory=lambda: [])
    # A page that only lists other things: remembered (so it is read again only when it
    # changes), never an item.
    is_list: bool = False
    # What a page links to, and when the item was read on its own (None: not known this run).
    links: list[list[str]] | None = None
    checked_at: datetime | None = None

    def clues(self) -> Clues:
        return Clues(
            title=self.title,
            mime=self.mime,
            url=self.url,
            subheader=self.subheader,
            module=self.module,
            folder_path=self.folder_path,
            listed_by=tuple(self.listed_by),
        )


def file_version(meta: FileMeta) -> str:
    changed = meta.content_at or meta.updated_at
    return f"{changed.isoformat() if changed else ''}|{meta.size_bytes or 0}"


@dataclass
class _Found:
    known: dict[Key, LmsMaterial]
    now: datetime
    materials: dict[Key, Material] = field(default_factory=lambda: {})
    # Pages to look at: slug → (title, version known from the list or None, web address).
    pages: dict[str, tuple[str, str | None, str | None]] = field(default_factory=lambda: {})
    # Where a page or file was seen in a module: (subheader, module).
    placed: dict[Key, tuple[str | None, str]] = field(default_factory=lambda: {})
    # The titles of the list pages that list it.
    listed_by: dict[Key, list[str]] = field(default_factory=lambda: {})
    # Files no list showed, to read one by one.
    file_ids: dict[str, None] = field(default_factory=lambda: {})
    # Items there and unchanged, not read again this run.
    kept: set[Key] = field(default_factory=lambda: set[Key]())
    # Every area was read whole: what is not found is gone from the platform.
    complete: bool = True

    def add(self, m: Material) -> None:
        self.materials.setdefault((m.kind, m.external_id), m)

    def checked_lately(self, key: Key) -> bool:
        """Read on its own within `CHECK_EVERY` (an item in the files, or a list page): taken
        to be as it was."""
        mat = self.known.get(key)
        if mat is None or mat.state not in ("synced", "list"):
            return False
        return mat.checked_at is not None and self.now - mat.checked_at < CHECK_EVERY

    def linked(self, kind: str, target: str, list_title: str | None) -> None:
        """A page links to a file or page of the course: it comes in, filed by the list page's
        title when it is one."""
        key = (kind, target)
        if list_title is not None:
            titles = self.listed_by.setdefault(key, [])
            if list_title not in titles:
                titles.append(list_title)
        if kind == "file":
            self.file_ids.setdefault(target, None)
        elif target not in self.pages:
            self.pages[target] = (target, None, None)


async def _optional[T](found: _Found, read: Awaitable[T]) -> T | None:
    """A read of one area of the course; None when the user can't open that area (then what is
    missing from this run can't be told gone)."""
    try:
        got = await read
    except AppError as exc:
        if exc.code in SKIPPED:
            found.complete = False
            return None
        raise
    if getattr(got, "truncated", False):
        found.complete = False
    return got


async def _one[T](found: _Found, read: Awaitable[T]) -> T | None:
    """A read of one file or page; None when it is gone or not for this user (a link to a
    deleted file), which says nothing about the rest of the course. Its area refused (hidden,
    not offered) still leaves this run incomplete."""
    try:
        return await read
    except AppError as exc:
        if exc.code in ITEM_ERRORS:
            return None
        if exc.code in SKIPPED:
            found.complete = False
            return None
        raise


async def _modules(ctx: Ctx, link: LmsCourseLink, found: _Found) -> None:
    listed = await _optional(found, reads.modules(ctx, link.course_id, refresh=True))
    if listed is None:
        return
    for module in listed.items:
        items = module.items
        if items is None:
            got = await _optional(
                found, reads.module_items(ctx, link.course_id, module.external_id, refresh=True)
            )
            items = got.items if got is not None else []
        subheader: str | None = None
        for item in sorted(items, key=lambda i: i.position):
            if item.kind == "subheader":
                subheader = item.title
                continue
            _module_item(item, subheader, module.name, found)


def _module_item(item: ModuleItem, subheader: str | None, module: str, found: _Found) -> None:
    if item.locked:
        return
    target = item.target.ref if item.target is not None else None
    if item.kind == "file" and target:
        found.placed.setdefault(("file", target), (subheader, module))
        found.file_ids.setdefault(target, None)
    elif item.kind == "page" and target:
        found.placed.setdefault(("page", target), (subheader, module))
        found.pages.setdefault(target, (item.title, None, item.web_url))
    elif item.kind in ("external_url", "external_tool"):
        url = item.external_url if item.kind == "external_url" else item.web_url
        if url:
            found.add(
                Material(
                    "link",
                    item.external_id,
                    item.title or url,
                    version=url,
                    url=url,
                    web_url=item.web_url,
                    subheader=subheader,
                    module=module,
                )
            )


async def _files(ctx: Ctx, link: LmsCourseLink, b: Bound, found: _Found) -> None:
    metas: dict[str, FileMeta] = {}
    if "folders" in b.provider.features:
        listed = await _optional(found, reads.course_files(ctx, link.course_id, refresh=True))
        metas = {f.external_id: f for f in listed.items} if listed is not None else {}
    checked: set[str] = set()
    # Files only a module or a page shows (the files area hidden): one by one, now and then.
    for file_id in found.file_ids:
        if file_id in metas or "files" not in b.provider.features:
            continue
        if found.checked_lately(("file", file_id)):
            found.kept.add(("file", file_id))
            continue
        meta = await _one(found, reads.file(ctx, link.course_id, file_id, refresh=True))
        if meta is not None:
            metas[file_id] = meta
            checked.add(file_id)
    for meta in metas.values():
        if meta.locked:
            continue  # comes in once it opens
        found.add(
            Material(
                "file",
                meta.external_id,
                meta.name,
                version=file_version(meta),
                size=meta.size_bytes or 0,
                mime=meta.mime_type,
                web_url=meta.web_url,
                folder_path=meta.folder_path,
                modified_at=meta.content_at or meta.updated_at,
                checked_at=found.now if meta.external_id in checked else None,
            )
        )


async def _pages(ctx: Ctx, link: LmsCourseLink, b: Bound, found: _Found) -> None:
    listed = await _optional(found, reads.pages(ctx, link.course_id, refresh=True))
    for page in listed.items if listed is not None else []:
        version = page.updated_at.isoformat() if page.updated_at else None
        found.pages[page.ref] = (page.title, version, page.web_url)
    done: set[str] = set()
    # Pages bring in what they link to, other pages among it: until no new page is found.
    while todo := [slug for slug in found.pages if slug not in done]:
        for slug in todo:
            done.add(slug)
            await _page(ctx, link, b, found, slug)


async def _page(ctx: Ctx, link: LmsCourseLink, b: Bound, found: _Found, slug: str) -> None:
    title, version, web_url = found.pages[slug]
    key = ("page", slug)
    mat = found.known.get(key)
    unchanged = version is not None and mat is not None and mat.version == version
    if unchanged or (version is None and found.checked_lately(key)):
        assert mat is not None
        # As it was when last read: what it links to still holds.
        listed = mat.state == "list"
        for kind, target in mat.links:
            found.linked(kind, target, title if listed else None)
        if listed:
            found.add(
                Material(
                    "page",
                    slug,
                    title,
                    version or "",
                    is_list=True,
                    links=mat.links,
                    checked_at=mat.checked_at,
                )
            )
        elif mat.state == "synced":
            found.kept.add(key)
        return
    detail = await _one(found, reads.page(ctx, link.course_id, slug, refresh=True))
    if detail is None or detail.locked:
        return
    title = detail.title or title
    version = detail.updated_at.isoformat() if detail.updated_at else (version or "")
    shape = page_shape(detail.html)
    links: list[list[str]] = []
    for url in shape.links:
        target = b.rewrite(url, link.external_course_id)
        if target is not None and target.kind in ("file", "page") and target.ref != slug:
            links.append([target.kind, target.ref])
            found.linked(target.kind, target.ref, title if shape.is_list else None)
    if shape.is_list:
        found.add(
            Material("page", slug, title, version, is_list=True, links=links, checked_at=found.now)
        )
        return
    size = len((detail.html or "").encode())
    found.add(
        Material(
            "page",
            slug,
            title,
            version,
            size=size,
            mime="text/html",
            web_url=detail.web_url or web_url,
            modified_at=detail.updated_at,
            links=links,
            checked_at=found.now,
        )
    )


def _place(found: _Found) -> None:
    """Pages and files get the module they were seen in and the list pages that list them."""
    for key, material in found.materials.items():
        if material.kind == "link":
            continue
        subheader, module = found.placed.get(key, (None, None))
        material.subheader = material.subheader or subheader
        material.module = material.module or module
        material.listed_by = found.listed_by.get(key, [])


# --- what the rules leave in "general" -------------------------------------------------------


@dataclass
class _Sorting:
    """The model's types for the new items of this run that the rules put in "general": one
    request per course and run. Without a model, or when it fails, they stay in "general" (the
    user can sort them with M07's organizing, where they review it first)."""

    answers: dict[Key, MaterialType]

    def kind_of(self, key: Key, m: Material) -> MaterialType:
        return self.answers.get(key) or classify(m.clues())

    def by_model(self, key: Key) -> bool:
        return key in self.answers


async def _sort(ctx: Ctx, found: _Found) -> _Sorting:
    asked: dict[Key, Clues] = {}
    new = 0
    for key, m in found.materials.items():
        mat = found.known.get(key)
        if m.is_list or (mat is not None and mat.state in ("synced", "dismissed", "handed_over")):
            continue
        new += 1
        if new > PER_RUN:
            break
        if classify(clues := m.clues()) == "general":
            asked[key] = clues
    keys = {f"{kind}:{external_id}": (kind, external_id) for kind, external_id in asked}
    try:
        answers = await sorting.classify_leftovers(
            ctx, {name: asked[key] for name, key in keys.items()}
        )
    except AppError as exc:
        if not exc.code.startswith("ai."):
            raise
        answers = None
    return _Sorting({keys[name]: kind for name, kind in (answers or {}).items()})


# --- writing --------------------------------------------------------------------------------


async def _create(
    ctx: Ctx, link: LmsCourseLink, b: Bound, m: Material, folder_id: str | None, unseen: bool
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
    )


async def _follow(ctx: Ctx, m: Material, mat: LmsMaterial, row: FilesItem) -> bool:
    """The item follows the platform's, except where the user changed it: a new name unless
    they renamed it, new contents (read again only when the bytes changed, not on a rename; a
    local copy is let go until stored again). True when the contents changed."""
    title = None if row.display_name != mat.name else m.title
    retitled = title is not None and title != (mat.title if mat.title is not None else mat.name)
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
    if m.modified_at is not None and row.source_modified_at != m.modified_at:
        row.source_modified_at = m.modified_at  # read the first time, or a rename moved it
    return changed


def forget_applied(mat: LmsMaterial) -> None:
    """Clears what was applied from the platform (its title stays: the status panel names what
    went by it)."""
    mat.version = mat.name = mat.type = mat.checked_at = None
    mat.sorted_by_model = False
    mat.links = []


def enter(mat: LmsMaterial, state: MaterialState, now: datetime) -> None:
    mat.state, mat.state_at = state, now


def _note(mat: LmsMaterial, change: MaterialChange, now: datetime) -> None:
    mat.change, mat.changed_at = change, now


def _seen(mat: LmsMaterial, m: Material) -> None:
    """What this run saw of the platform's item; what it did not read again stays."""
    mat.title, mat.version = m.title, m.version
    if m.links is not None:
        mat.links = m.links
    if m.checked_at is not None:
        mat.checked_at = m.checked_at


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


async def run(ctx: Ctx, link: LmsCourseLink, b: Bound) -> StageResult:
    def read_materials() -> Any:
        return select(LmsMaterial).where(LmsMaterial.link_id == link.id)

    mats = list(await ctx.db.scalars(read_materials()))
    found = _Found({(r.kind, r.external_id): r for r in mats}, ctx.now)
    features = b.provider.features
    if "modules" in features:
        await _modules(ctx, link, found)
    if "pages" in features:
        await _pages(ctx, link, b, found)
    await _files(ctx, link, b, found)
    _place(found)
    plan = await _sort(ctx, found)
    cfg = await material_settings(ctx, link.course_id)

    await hold(ctx, link)
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
        if mat.state != "synced":
            continue
        row = rows.get(mat.item_id or "")
        if row is None:
            # The user deleted it (told at once by `files.item.deleted`, unless that was missed).
            mat.item_id = None
            enter(mat, "dismissed", now)
        elif row.source_ref is None:
            enter(mat, "handed_over", now)  # the user made it their own
            del rows[row.id]
    # What came in before the course settled is not news.
    settled = link.materials_settled_at is not None
    folders: dict[MaterialType, str | None] = {}
    type_folders = await sorting.type_folders(ctx, link.course_id)

    async def folder_of(kind: MaterialType) -> str | None:
        if kind not in folders:
            folders[kind] = await sorting.folder_for(
                ctx, link.course_id, kind, type_folders, if_deleted="top_level"
            )
        return folders[kind]

    result = StageResult()
    added: list[FilesItem] = []
    gone: list[FilesItem] = []
    for key, m in found.materials.items():
        mat = known.get(key)
        row = rows.get(mat.item_id or "") if mat is not None and mat.state == "synced" else None
        if mat is not None and mat.state in ("dismissed", "handed_over"):
            continue
        if m.is_list:
            if mat is None:
                mat = _material(ctx, link, m)
            elif row is not None:
                gone.append(row)  # a page that has become a list of links
                mat.item_id = None
            forget_applied(mat)
            _seen(mat, m)
            enter(mat, "list", now)
            continue
        if mat is not None and row is not None:
            if await _follow(ctx, m, mat, row) and settled:
                _note(mat, "updated", now)
            _seen(mat, m)
            mat.name = row.display_name
            continue
        # New, back on the platform, or a list page that has become a page.
        if len(added) >= PER_RUN:
            result.cap_reached = True
            continue
        news = settled and (mat is None or mat.state != "restored")
        kind = plan.kind_of(key, m)
        row = await _create(ctx, link, b, m, await folder_of(kind), unseen=news)
        added.append(row)
        if mat is None:
            mat = _material(ctx, link, m)
        mat.item_id, mat.imported_at = row.id, now
        enter(mat, "synced", now)
        forget_applied(mat)
        _seen(mat, m)
        mat.name, mat.type, mat.sorted_by_model = row.display_name, kind, plan.by_model(key)
        mat.change = mat.changed_at = None
        if news:
            _note(mat, "added", now)
            result.notices.append(Notice("material", m.external_id, m.title, item_id=row.id))

    handed: list[FilesItem] = []
    if found.complete:
        # Gone from the platform: a local copy becomes the user's own file, an item read online
        # goes (it comes back if the platform shows it again).
        for key, mat in known.items():
            row = rows.get(mat.item_id or "") if mat.state == "synced" else None
            if row is None or key in found.materials or key in found.kept:
                continue
            if row.kind == "file" and row.storage_key:
                handed.append(row)
                enter(mat, "handed_over", now)
                _note(mat, "handed_over", now)
            else:
                gone.append(row)
                mat.item_id = None
                enter(mat, "gone", now)
                _note(mat, "gone", now)
            forget_applied(mat)
    await sources.purge_items(ctx, gone)
    await sources.detach_from_source(ctx, handed)
    left = {r.id for r in (*gone, *handed)}

    followed = [r for r in (*rows.values(), *added) if r.id not in left]
    for row in followed:
        if _retry_due(row, now):
            await sources.retry_synced(ctx, row)
    await sources.apply_copies(
        ctx, followed, cfg.store == "local", dedupe=f"lms.materials:{link.id}"
    )
    if not settled and not result.cap_reached:
        link.materials_settled_at = now
    await ctx.db.flush()
    return result


async def _enabled(ctx: Ctx, link: LmsCourseLink, b: Bound) -> bool:
    if not {"modules", "pages", "folders"} & b.provider.features:
        return False
    return (await material_settings(ctx, link.course_id)).sync


register_sync_stage("files", run, order=60, enabled=_enabled)


async def synced_items(ctx: Ctx, link_id: str) -> list[FilesItem]:
    """The items of the course's files that follow its materials."""
    ids = await ctx.db.scalars(
        select(LmsMaterial.item_id).where(
            LmsMaterial.link_id == link_id,
            LmsMaterial.state == "synced",
            LmsMaterial.item_id.is_not(None),
        )
    )
    return [r for r in await sources.find_items(ctx, [i for i in ids if i]) if r.source_ref]


def has_copy(row: FilesItem) -> bool:
    """A material that would become the user's own file if it left the platform or the course
    were unlinked: one with a local copy."""
    return row.kind == "file" and bool(row.storage_key)


# --- reading the bytes (M07's content source) -----------------------------------------------


async def _material_of(ctx: Ctx, item: FilesItem) -> tuple[LmsMaterial, LmsCourseLink]:
    found = (
        await ctx.db.execute(
            select(LmsMaterial, LmsCourseLink)
            .join(LmsCourseLink, LmsCourseLink.id == LmsMaterial.link_id)
            .where(
                LmsMaterial.user_id == ctx.user_id,
                LmsMaterial.item_id == item.id,
                LmsCourseLink.course_id == item.course_id,
            )
        )
    ).first()
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


register_content_source("lms:", open_source)


@events.subscribe("lms.course.unlinking", in_transaction=True)
async def on_unlinking(ctx: Ctx, event: Event) -> None:
    """The course is no longer linked to this platform course: its materials with a local copy
    become the user's own files, those read online go. Its type folders stay: they are the
    user's."""
    link_id = event.data.get("link_id")
    if not isinstance(link_id, str):
        return
    rows = await synced_items(ctx, link_id)
    await sources.purge_items(ctx, [r for r in rows if not has_copy(r)])
    await sources.detach_from_source(ctx, [r for r in rows if has_copy(r)])


@events.subscribe("files.item.deleted")
async def on_item_deleted(ctx: Ctx, event: Event) -> None:
    """The user deleted a material's item: it is not brought back (`dismissed`), and the status
    panel lists it under the removed materials at once, where it can be restored."""
    item_id = event.data.get("item_id")
    if not isinstance(item_id, str):
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
    ).all()
    for mat, link in found:
        mat.item_id = None
        enter(mat, "dismissed", ctx.now)
        await events.publish(ctx, UPDATED, {"program_id": link.program_id})


async def restore(ctx: Ctx, material_id: str) -> str:
    """A material the user deleted comes in again with a sync queued now (`restored`). Returns
    its Program."""
    mat = await ctx.db.get(LmsMaterial, material_id)
    if mat is None or mat.user_id != ctx.user_id:
        raise not_found("lms_material", material_id)
    link = await ctx.db.get(LmsCourseLink, mat.link_id)
    assert link is not None
    await hold(ctx, link)
    await ctx.db.refresh(mat)
    if mat.state != "dismissed":
        raise lms_error("lms.sync_nothing_to_resolve")
    enter(mat, "restored", ctx.now)
    await sync_queue(ctx, [link], manual=True)
    return link.program_id


@events.subscribe("settings.values.updated")
async def on_settings_changed(ctx: Ctx, event: Event) -> None:
    """The materials settings of a Program or course changed: turned on, its courses sync now;
    a new way of keeping them applies at once (local copies let go, or stored)."""
    data = event.data
    scope = data.get("scope")
    changed = set(data.get("changed") or [])
    if (
        data.get("namespace") != "lms.materials"
        or not isinstance(scope, dict)
        or not isinstance(scope_id := scope.get("id"), str)
    ):
        return
    if scope.get("type") == "course":
        link = await service.link_row(ctx, scope_id)
        links = [link] if link is not None else []
    else:
        links = await service.program_links(ctx, scope_id)
    turned_on: list[LmsCourseLink] = []
    for link in links:
        if not link.sync_enabled:
            continue
        cfg = await material_settings(ctx, link.course_id)
        if "sync" in changed and cfg.sync:
            turned_on.append(link)
        if "store" in changed:
            await sources.apply_copies(
                ctx,
                await synced_items(ctx, link.id),
                cfg.store == "local",
                dedupe=f"lms.materials:{link.id}",
            )
    await sync_queue(ctx, turned_on)
