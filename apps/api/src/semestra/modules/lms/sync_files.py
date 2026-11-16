"""The `files` stage of the course sync (M09 §4.2): the course's files, pages and links on the
platform become items of the course's files (M07), in type folders (`materials.py`).

Nothing is copied: an item names its platform file or page (`source_ref`) and M07 reads the
bytes from the platform when they are needed (`open_source`, registered as its content source),
so the materials take none of the user's storage. Their text is read and indexed like any file's,
for search and Sem.

Each platform item has a ref (`external_kind` `file`, `page` or `link`) with what was last
applied (`snapshot`: its type, name and version). The user's changes always win: a moved item
stays where they put it, a renamed one keeps their name (a new version still replaces the
contents), a deleted one is not brought back (`dismissed_at`). Type folders are made on first
need and remembered (`type_folder` refs); one the user deleted is replaced by the folder where
they put that type's items since, else the type's new items go to the top level.

Pages that are only a list of links (a module's table of contents) are not kept; what they list
is filed by their title instead.
"""

from collections import Counter
from collections.abc import AsyncIterator, Awaitable
from dataclasses import dataclass, field
from html import escape
from typing import Literal

from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.core.events import Event, events
from semestra.modules.files import service as files
from semestra.modules.files.content import register_content_source
from semestra.modules.files.models import FilesItem
from semestra.modules.lms import reads
from semestra.modules.lms.errors import lms_error
from semestra.modules.lms.materials import (
    Clues,
    MaterialType,
    classify,
    folder_name,
    page_shape,
)
from semestra.modules.lms.models import LmsCourseLink, LmsImportedRef
from semestra.modules.lms.reads import AREA_REFUSALS
from semestra.modules.lms.schemas.dto import FileMeta, ModuleItem
from semestra.modules.lms.service import Bound
from semestra.modules.lms.sync import StageResult, hold, register_sync_stage

MaterialKind = Literal["file", "page", "link"]
KINDS: tuple[MaterialKind, ...] = ("file", "page", "link")
TYPE_FOLDER = "type_folder"
# `target_kind` of the refs: an item, a folder of the course's files.
ITEM = "file_item"
FOLDER = "file_folder"
# New items one run adds; the next run goes on.
PER_RUN = 100
# Errors that mean an area of the course is hidden from the user: the stage goes on without it.
SKIPPED = AREA_REFUSALS | {"lms.area_hidden", "lms.feature_unsupported"}


def source_ref(kind: MaterialKind, external_id: str) -> str:
    return f"lms:{kind}:{external_id}"


@dataclass
class Material:
    kind: MaterialKind
    external_id: str
    title: str
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

    def kind_of(self) -> MaterialType:
        return classify(
            Clues(
                title=self.title,
                mime=self.mime,
                url=self.url,
                subheader=self.subheader,
                module=self.module,
                folder_path=self.folder_path,
                listed_by=self.listed_by,
            )
        )


def file_version(meta: FileMeta) -> str:
    return f"{meta.updated_at.isoformat() if meta.updated_at else ''}|{meta.size_bytes or 0}"


async def _optional[T](read: Awaitable[T]) -> T | None:
    """A read of one area of the course; None when the user can't open that area."""
    try:
        return await read
    except AppError as exc:
        if exc.code in SKIPPED:
            return None
        raise


@dataclass
class _Found:
    materials: dict[tuple[MaterialKind, str], Material] = field(default_factory=lambda: {})
    # Pages to look at: slug → (title, version known from the list, or None).
    pages: dict[str, tuple[str, str | None, str | None]] = field(default_factory=lambda: {})
    # Where a page or file was seen in a module: (subheader, module).
    placed: dict[tuple[str, str], tuple[str | None, str]] = field(default_factory=lambda: {})
    file_ids: list[str] = field(default_factory=lambda: [])

    def add(self, m: Material) -> None:
        self.materials.setdefault((m.kind, m.external_id), m)


async def _modules(ctx: Ctx, link: LmsCourseLink, b: Bound, found: _Found) -> None:
    listed = await _optional(reads.modules(ctx, link.course_id, refresh=True))
    if listed is None:
        return
    for module in listed.items:
        items = module.items
        if items is None:
            got = await _optional(
                reads.module_items(ctx, link.course_id, module.external_id, refresh=True)
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
        found.file_ids.append(target)
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
                    version=f"{url}|{item.title}",
                    url=url,
                    web_url=item.web_url,
                    subheader=subheader,
                    module=module,
                )
            )


async def _files(ctx: Ctx, link: LmsCourseLink, b: Bound, found: _Found) -> None:
    metas: dict[str, FileMeta] = {}
    if "folders" in b.provider.features:
        listed = await _optional(reads.course_files(ctx, link.course_id, refresh=True))
        metas = {f.external_id: f for f in listed.items} if listed is not None else {}
    # Files only a module shows (the files area hidden): their details one by one.
    for file_id in dict.fromkeys(found.file_ids):
        if file_id not in metas and "files" in b.provider.features:
            meta = await _optional(reads.file(ctx, link.course_id, file_id, refresh=True))
            if meta is not None:
                metas[file_id] = meta
    for meta in metas.values():
        if meta.locked:
            continue  # comes in once it opens
        subheader, module = found.placed.get(("file", meta.external_id), (None, None))
        found.add(
            Material(
                "file",
                meta.external_id,
                meta.name,
                version=file_version(meta),
                size=meta.size_bytes or 0,
                mime=meta.mime_type,
                web_url=meta.web_url,
                subheader=subheader,
                module=module,
                folder_path=meta.folder_path,
            )
        )


async def _pages(
    ctx: Ctx,
    link: LmsCourseLink,
    b: Bound,
    found: _Found,
    known: dict[tuple[str, str], LmsImportedRef],
) -> None:
    listed = await _optional(reads.pages(ctx, link.course_id, refresh=True))
    for page in listed.items if listed is not None else []:
        version = page.updated_at.isoformat() if page.updated_at else None
        found.pages[page.ref] = (page.title, version, page.web_url)
    for slug, (title, version, web_url) in found.pages.items():
        ref = known.get(("page", slug))
        snap = ref.snapshot if ref is not None else {}
        if version is not None and snap.get("version") == version:
            # Unchanged since it was last read: what it was then still holds.
            if not snap.get("list"):
                _add_page(found, slug, title, version, web_url, int(snap.get("size") or 0))
            continue
        detail = await _optional(reads.page(ctx, link.course_id, slug, refresh=True))
        if detail is None or detail.locked:
            continue
        version = detail.updated_at.isoformat() if detail.updated_at else (version or "")
        shape = page_shape(detail.html)
        if shape.is_list:
            # Not kept; files and pages it lists are filed by its title.
            for url in shape.links:
                target = b.rewrite(url, link.external_course_id)
                if target is not None and target.kind in ("file", "page"):
                    found.placed.setdefault((target.kind, target.ref), (None, title))
            found.add(Material("page", slug, detail.title or title, version, is_list=True))
            continue
        size = len((detail.html or "").encode())
        _add_page(found, slug, detail.title or title, version, detail.web_url or web_url, size)


def _add_page(
    found: _Found, slug: str, title: str, version: str, web_url: str | None, size: int
) -> None:
    found.add(
        Material("page", slug, title, version=version, size=size, mime="text/html", web_url=web_url)
    )


def _place(found: _Found) -> None:
    """Pages and files get the module (or list page) they were seen in."""
    for (kind, external_id), material in found.materials.items():
        if kind == "link" or material.module is not None:
            continue
        subheader, module = found.placed.get((kind, external_id), (None, None))
        material.subheader = material.subheader or subheader
        material.module = module


# --- writing --------------------------------------------------------------------------------


class _Folders:
    """The course's type folders: remembered, found again, or made."""

    def __init__(self, ctx: Ctx, link: LmsCourseLink, refs: dict[str, LmsImportedRef]) -> None:
        self.ctx, self.link, self.refs = ctx, link, refs
        self.resolved: dict[MaterialType, str | None] = {}

    async def of(
        self, kind: MaterialType, imported: list[tuple[MaterialType, FilesItem]]
    ) -> str | None:
        if kind == "info":
            return None
        if kind in self.resolved:
            return self.resolved[kind]
        folder_id = await self._resolve(kind, imported)
        self.resolved[kind] = folder_id
        return folder_id

    async def _resolve(
        self, kind: MaterialType, imported: list[tuple[MaterialType, FilesItem]]
    ) -> str | None:
        ctx, link = self.ctx, self.link
        ref = self.refs.get(kind)
        if (
            ref is not None
            and ref.target_id is not None
            and await files.find_folder(ctx, link.course_id, ref.target_id) is not None
        ):
            return ref.target_id
        if ref is not None:
            # The folder is gone: where did the user put this type's items since?
            places = Counter(i.folder_id for t, i in imported if t == kind and i.folder_id)
            for folder_id, _ in places.most_common():
                if await files.find_folder(ctx, link.course_id, folder_id) is not None:
                    return self._remember(ref, folder_id)
            if ref.target_id is not None or ref.dismissed_at is None:
                ref.target_id, ref.dismissed_at = None, ctx.now
            return None
        name = folder_name(kind, ctx.locale)
        folder = await files.root_folder_named(ctx, link.course_id, name)
        folder_id = (
            folder.id
            if folder is not None
            else (await files.create_folder(ctx, link.course_id, name, None)).id
        )
        ref = LmsImportedRef(
            user_id=ctx.user_id,
            link_id=link.id,
            external_kind=TYPE_FOLDER,
            external_id=kind,
            target_kind=FOLDER,
            imported_at=ctx.now,
            snapshot={},
        )
        ctx.db.add(ref)
        self.refs[kind] = ref
        return self._remember(ref, folder_id)

    def _remember(self, ref: LmsImportedRef, folder_id: str) -> str:
        ref.target_id, ref.dismissed_at = folder_id, None
        return folder_id


async def _create(ctx: Ctx, link: LmsCourseLink, m: Material, folder_id: str | None) -> FilesItem:
    if m.kind == "link":
        out = await files.create_link(
            ctx,
            link.course_id,
            m.url or "",
            m.title,
            folder_id,
            source_kind="lms",
            source_ref=source_ref("link", m.external_id),
        )
        [row] = await files.find_items(ctx, [out.id])
        return row
    return await files.add_remote_file(
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


async def _update(ctx: Ctx, m: Material, ref: LmsImportedRef, row: FilesItem) -> None:
    """The platform's item changed: the item follows, except where the user changed it."""
    renamed = row.display_name != ref.snapshot.get("name")
    if m.kind == "link":
        await files.update_link(
            ctx, row, url=m.url or row.url or "", name=None if renamed else m.title
        )
    elif row.storage_key:
        return  # a copy the user saved: theirs to keep as it is
    else:
        await files.update_remote_file(
            ctx,
            row,
            name=None if renamed else m.title,
            mime=m.mime,
            size=m.size,
            version=m.version,
            url=m.web_url,
        )


def _snapshot(m: Material, kind: MaterialType | None, row: FilesItem | None) -> dict[str, object]:
    snap: dict[str, object] = {"version": m.version, "size": m.size}
    if kind is not None:
        snap["type"] = kind
    if row is not None:
        snap["name"] = row.display_name
    if m.is_list:
        snap["list"] = True
    return snap


async def run(ctx: Ctx, link: LmsCourseLink, b: Bound) -> StageResult:
    refs = list(
        await ctx.db.scalars(
            select(LmsImportedRef).where(
                LmsImportedRef.link_id == link.id,
                LmsImportedRef.external_kind.in_((*KINDS, TYPE_FOLDER)),
            )
        )
    )
    known = {(r.external_kind, r.external_id): r for r in refs if r.external_kind in KINDS}
    found = _Found()
    features = b.provider.features
    if "modules" in features:
        await _modules(ctx, link, b, found)
    if "pages" in features:
        await _pages(ctx, link, b, found, known)
    await _files(ctx, link, b, found)
    _place(found)

    await hold(ctx, link)
    # Read again under the write lock: the user may have answered (deleted, moved) meanwhile.
    refs = list(
        await ctx.db.scalars(
            select(LmsImportedRef)
            .where(
                LmsImportedRef.link_id == link.id,
                LmsImportedRef.external_kind.in_((*KINDS, TYPE_FOLDER)),
            )
            .execution_options(populate_existing=True)
        )
    )
    known = {(r.external_kind, r.external_id): r for r in refs if r.external_kind in KINDS}
    rows = {
        r.id: r
        for r in await files.find_items(ctx, [r.target_id for r in known.values() if r.target_id])
    }
    imported: list[tuple[MaterialType, FilesItem]] = []
    for ref in known.values():
        if ref.target_id is None:
            continue
        row = rows.get(ref.target_id)
        if row is None:
            # The user deleted it: not brought back.
            ref.target_id, ref.dismissed_at = None, ctx.now
        elif (kind := ref.snapshot.get("type")) is not None:
            imported.append((kind, row))
    folders = _Folders(
        ctx,
        link,
        {r.external_id: r for r in refs if r.external_kind == TYPE_FOLDER},
    )

    result = StageResult()
    added = 0
    for key, m in found.materials.items():
        ref = known.get(key)
        if m.is_list:
            if ref is None:
                ref = LmsImportedRef(
                    user_id=ctx.user_id, link_id=link.id, external_kind=m.kind,
                    external_id=m.external_id, snapshot={},
                )  # fmt: skip
                ctx.db.add(ref)
            ref.snapshot = _snapshot(m, None, None)
            continue
        if ref is not None and ref.dismissed_at is not None:
            continue
        if ref is not None and ref.target_id is not None:
            if ref.snapshot.get("version") != m.version:
                await _update(ctx, m, ref, rows[ref.target_id])
            ref.snapshot = {**ref.snapshot, **_snapshot(m, None, rows[ref.target_id])}
            continue
        if added >= PER_RUN:
            result.cap_reached = True
            continue
        kind = m.kind_of()
        row = await _create(ctx, link, m, await folders.of(kind, imported))
        added += 1
        if ref is None:
            ref = LmsImportedRef(
                user_id=ctx.user_id,
                link_id=link.id,
                external_kind=m.kind,
                external_id=m.external_id,
                snapshot={},
            )
            ctx.db.add(ref)
        ref.target_kind, ref.target_id, ref.imported_at = ITEM, row.id, ctx.now
        ref.snapshot = _snapshot(m, kind, row)
        imported.append((kind, row))
    await ctx.db.flush()
    return result


async def _enabled(ctx: Ctx, link: LmsCourseLink, b: Bound) -> bool:
    del ctx
    return link.files_sync and bool({"modules", "pages", "folders"} & b.provider.features)


register_sync_stage("files", run, order=60, enabled=_enabled)


# --- reading the bytes (M07's content source) -----------------------------------------------


async def _ref_of(ctx: Ctx, item: FilesItem) -> tuple[LmsImportedRef, LmsCourseLink]:
    found = (
        await ctx.db.execute(
            select(LmsImportedRef, LmsCourseLink)
            .join(LmsCourseLink, LmsCourseLink.id == LmsImportedRef.link_id)
            .where(
                LmsImportedRef.user_id == ctx.user_id,
                LmsImportedRef.target_kind == ITEM,
                LmsImportedRef.target_id == item.id,
                LmsCourseLink.course_id == item.course_id,
            )
        )
    ).first()
    if found is None:
        raise lms_error("lms.not_found")
    ref, link = found
    return ref, link


async def _once(data: bytes) -> AsyncIterator[bytes]:
    yield data


def page_document(title: str, html: str | None) -> bytes:
    head = f'<!doctype html><html><head><meta charset="utf-8"><title>{escape(title)}</title>'
    return f"{head}</head><body><h1>{escape(title)}</h1>{html or ''}</body></html>".encode()


async def open_source(ctx: Ctx, item: FilesItem) -> AsyncIterator[bytes]:
    """The bytes of an item the sync made: the platform's file, or its page as an HTML
    document (read fresh, so a changed page is read as it is now)."""
    ref, link = await _ref_of(ctx, item)
    if ref.external_kind == "file":
        _, stream = await reads.open_file(ctx, link.course_id, ref.external_id)
        return stream
    if ref.external_kind == "page":
        page = await reads.page(ctx, link.course_id, ref.external_id, refresh=True)
        return _once(page_document(page.title, page.html))
    raise lms_error("lms.not_found")


register_content_source("lms:", open_source)


@events.subscribe("lms.course.unlinking", in_transaction=True)
async def on_unlinking(ctx: Ctx, event: Event) -> None:
    """The course is no longer linked to this platform course: the items that were only read
    from it go (a copy the user saved stays). Its type folders stay: they are the user's."""
    link_id = event.data.get("link_id")
    if not isinstance(link_id, str):
        return
    ids = list(
        await ctx.db.scalars(
            select(LmsImportedRef.target_id).where(
                LmsImportedRef.link_id == link_id,
                LmsImportedRef.target_kind == ITEM,
                LmsImportedRef.target_id.is_not(None),
            )
        )
    )
    rows = [r for r in await files.find_items(ctx, [i for i in ids if i]) if not r.storage_key]
    await files.purge_items(ctx, rows)
