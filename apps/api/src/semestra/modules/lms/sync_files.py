"""The `files` stage of the course sync (M09 §4.2): the course's files, pages and links on the
platform become items of the course's files (M07), in type folders (`files.sorting`).

By default nothing is copied: an item names its platform file or page (`source_ref`) and M07
reads the bytes from the platform when they are needed (`open_source`, registered as its content
source), so the materials take none of the user's storage. With the course's `files_offline` on
they are stored here too (M07's `files.keep_offline_synced`), so they open after the platform
course closes; they still follow the platform. Only a copy the user keeps (`kept_offline`) is
left alone. Their text is read and indexed like any file's (M07's `auto_index`), for search and Sem.

Each platform item has a row in `lms_materials` (`LmsMaterial`) with its item and what was last
applied (platform title, content version, name, type). The user's changes always win: a moved
item stays where they put it, a renamed one keeps their name, a deleted one is not brought back
(`deleted_at`). Type folders are made on first need and remembered (M07's `files_type_folders`,
`sorting.folder_for`); once the user deleted one, the type's new items go to the top level.

An item gone from the platform (deleted, locked again) goes from the files too, unless the user
stored a copy; its row is cleared, so it comes back if the platform shows it again. That is only
judged on a run that read every area whole.

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
from semestra.core.errors import AppError
from semestra.core.events import Event, events
from semestra.modules.files import register_content_source, sorting, sources
from semestra.modules.files.models import FilesItem
from semestra.modules.files.sorting import Clues, MaterialType, classify
from semestra.modules.lms import reads
from semestra.modules.lms.errors import lms_error
from semestra.modules.lms.materials import page_shape
from semestra.modules.lms.models import LmsCourseLink, LmsMaterial
from semestra.modules.lms.reads import AREA_REFUSALS, ITEM_ERRORS
from semestra.modules.lms.schemas.dto import FileMeta, ModuleItem
from semestra.modules.lms.service import Bound
from semestra.modules.lms.sync import StageResult, hold, register_sync_stage

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
        if mat is None or (mat.item_id is None and not mat.is_list):
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
        for kind, target in mat.links:
            found.linked(kind, target, title if mat.is_list else None)
        if mat.is_list:
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
        elif mat.item_id is not None:
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
        if m.is_list or (mat is not None and (mat.deleted_at or mat.item_id)):
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


async def _create(ctx: Ctx, link: LmsCourseLink, m: Material, folder_id: str | None) -> FilesItem:
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
    )


async def _follow(ctx: Ctx, m: Material, mat: LmsMaterial, row: FilesItem) -> None:
    """The item follows the platform's, except where the user changed it: a new name unless
    they renamed it, new contents unless they keep their own copy (read again only when the
    bytes changed, not on a rename). A copy stored for "store here" follows like the rest."""
    title = None if row.display_name != mat.name else m.title
    retitled = title is not None and title != (mat.title if mat.title is not None else mat.name)
    if m.kind == "link":
        if mat.version != m.version or retitled:
            await sources.update_link(ctx, row, url=m.url or row.url or "", name=title)
    elif mat.version != m.version and not row.kept_offline:
        await sources.update_remote_file(
            ctx, row, name=title, mime=m.mime, size=m.size, version=m.version, url=m.web_url
        )
    elif retitled and title is not None:
        await sources.rename_synced(ctx, row, title)


def forget_applied(mat: LmsMaterial) -> None:
    """Clears what was applied from the platform (the item and the user's deletion stay)."""
    mat.title = mat.version = mat.name = mat.type = mat.checked_at = None
    mat.sorted_by_model = mat.is_list = False
    mat.links = []


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

    await hold(ctx, link)
    # Read again under the write lock: the user may have answered (deleted, moved) meanwhile.
    mats = list(await ctx.db.scalars(read_materials().execution_options(populate_existing=True)))
    known = {(r.kind, r.external_id): r for r in mats}
    rows = {
        r.id: r
        for r in await sources.find_items(ctx, [r.item_id for r in known.values() if r.item_id])
    }
    for mat in known.values():
        if mat.item_id is not None and mat.item_id not in rows:
            # The user deleted it: not brought back.
            mat.item_id, mat.deleted_at = None, ctx.now
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
        row = rows.get(mat.item_id) if mat is not None and mat.item_id else None
        if m.is_list:
            if mat is None:
                mat = LmsMaterial(
                    user_id=ctx.user_id, link_id=link.id, kind=m.kind, external_id=m.external_id
                )
                ctx.db.add(mat)
            elif row is not None and not row.kept_offline:
                gone.append(row)  # a page that has become a list of links
                mat.item_id = None
            forget_applied(mat)
            _seen(mat, m)
            mat.is_list = True
            continue
        if mat is not None and mat.deleted_at is not None:
            continue
        if mat is not None and row is not None:
            await _follow(ctx, m, mat, row)
            _seen(mat, m)
            mat.name = row.display_name
            continue
        if len(added) >= PER_RUN:
            result.cap_reached = True
            continue
        kind = plan.kind_of(key, m)
        row = await _create(ctx, link, m, await folder_of(kind))
        added.append(row)
        if mat is None:
            mat = LmsMaterial(
                user_id=ctx.user_id, link_id=link.id, kind=m.kind, external_id=m.external_id
            )
            ctx.db.add(mat)
        mat.item_id, mat.imported_at = row.id, ctx.now
        forget_applied(mat)
        _seen(mat, m)
        mat.name, mat.type, mat.sorted_by_model = row.display_name, kind, plan.by_model(key)

    if found.complete:
        # Gone from the platform: gone here too, unless the user keeps a copy. The row forgets
        # it, so it comes back if the platform shows it again.
        for key, mat in known.items():
            row = rows.get(mat.item_id) if mat.item_id else None
            if row is None or key in found.materials or key in found.kept or row.kept_offline:
                continue
            gone.append(row)
            mat.item_id = None
            forget_applied(mat)
    await sources.purge_items(ctx, gone)
    left = {r.id for r in gone}

    remote = [r for r in (*rows.values(), *added) if r.id not in left and sources.remote(r)]
    for row in remote:
        if _retry_due(row, ctx.now):
            await sources.retry_synced(ctx, row)
    if link.files_offline:
        await sources.keep_synced_offline(ctx, remote, dedupe=f"lms.files:{link.id}")
    await ctx.db.flush()
    return result


async def _enabled(ctx: Ctx, link: LmsCourseLink, b: Bound) -> bool:
    del ctx
    return link.files_sync and bool({"modules", "pages", "folders"} & b.provider.features)


register_sync_stage("files", run, order=60, enabled=_enabled)


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
    """The course is no longer linked to this platform course: the items that were only read
    from it or stored for it go (a copy the user keeps stays). Its type folders stay: they are
    the user's."""
    link_id = event.data.get("link_id")
    if not isinstance(link_id, str):
        return
    ids = list(
        await ctx.db.scalars(
            select(LmsMaterial.item_id).where(
                LmsMaterial.link_id == link_id, LmsMaterial.item_id.is_not(None)
            )
        )
    )
    rows = await sources.find_items(ctx, [i for i in ids if i])
    await sources.purge_items(ctx, [r for r in rows if not r.kept_offline])
    await sources.detach_from_source(ctx, [r for r in rows if r.kept_offline])
