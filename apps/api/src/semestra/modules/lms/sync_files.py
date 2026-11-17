"""The `files` stage of the course sync (M09 §4.2): the course's files, pages and links on the
platform become items of the course's files (M07), in type folders (`files.sorting`).

By default nothing is copied: an item names its platform file or page (`source_ref`) and M07
reads the bytes from the platform when they are needed (`open_source`, registered as its content
source), so the materials take none of the user's storage. With the course's `files_offline` on
they are stored here too (M07's `files.keep_offline_synced`), so they open after the platform
course closes; they still follow the platform. Only a copy the user keeps (`kept_offline`) is
left alone. Their text is read and indexed like any file's (M07's `auto_index`), for search and Sem.

Each platform item has a ref (`external_kind` `file`, `page` or `link`) with what was last
applied (`snapshot`: its type, platform title, content version, name). The user's changes always
win: a moved item stays where they put it, a renamed one keeps their name, a deleted one is not
brought back (`dismissed_at`). Type folders are made on first need and remembered (M07's
`files_type_folders`); one the user deleted is replaced by the folder where they put that type's
items since, else the type's new items go to the top level.

An item gone from the platform (deleted, locked again) goes from the files too, unless the user
stored a copy; its ref is cleared, so it comes back if the platform shows it again. That is only
judged on a run that read every area whole.

Pages that are only a list of links (a module's table of contents) are not kept; what they list
is filed by their title. Files and pages that pages link to come in too (courses that hide their
files area link their files from pages).
"""

from collections import Counter
from collections.abc import AsyncIterator, Awaitable
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta
from html import escape
from typing import Any, Literal

from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.core.events import Event, events
from semestra.modules.files import content, sorting
from semestra.modules.files import service as files
from semestra.modules.files.content import register_content_source
from semestra.modules.files.models import FilesItem, FilesTypeFolder
from semestra.modules.files.sorting import Clues, MaterialType, classify
from semestra.modules.lms import reads
from semestra.modules.lms.errors import lms_error
from semestra.modules.lms.materials import page_shape
from semestra.modules.lms.models import LmsCourseLink, LmsImportedRef
from semestra.modules.lms.reads import AREA_REFUSALS, ITEM_ERRORS
from semestra.modules.lms.schemas.dto import FileMeta, ModuleItem
from semestra.modules.lms.service import Bound
from semestra.modules.lms.sync import StageResult, hold, register_sync_stage

MaterialKind = Literal["file", "page", "link"]
KINDS: tuple[MaterialKind, ...] = ("file", "page", "link")
Key = tuple[str, str]
# `target_kind` of the refs: an item of the course's files.
ITEM = "file_item"
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
    # More to remember (what a page links to, when an item was last read on its own).
    notes: dict[str, Any] = field(default_factory=lambda: {})

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
    known: dict[Key, LmsImportedRef]
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
        ref = self.known.get(key)
        if ref is None or (ref.target_id is None and not ref.snapshot.get("list")):
            return False
        checked = ref.snapshot.get("checked")
        return isinstance(checked, str) and self.now - datetime.fromisoformat(checked) < CHECK_EVERY

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
                notes={"checked": found.now.isoformat()} if meta.external_id in checked else {},
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
    ref = found.known.get(key)
    snap = ref.snapshot if ref is not None else {}
    unchanged = version is not None and snap.get("version") == version
    if unchanged or (version is None and found.checked_lately(key)):
        # As it was when last read: what it links to still holds.
        for kind, target in snap.get("links") or []:
            found.linked(kind, target, title if snap.get("list") else None)
        if snap.get("list"):
            found.add(Material("page", slug, title, version or "", is_list=True, notes=snap))
        elif ref is not None and ref.target_id is not None:
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
    notes: dict[str, Any] = {"links": links, "checked": found.now.isoformat()}
    if shape.is_list:
        found.add(Material("page", slug, title, version, is_list=True, notes=notes))
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
            notes=notes,
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

# In a ref's snapshot: placed in "general" while no model could be asked (where it was put, and
# its clues). Asked about again on later runs, and moved if the user has not moved it meanwhile.
SORT_LATER = "sort_later"


@dataclass
class _Sorting:
    """The model's types for the items the rules put in "general": the new ones of this run,
    and those placed while no model could answer. One request per course and run."""

    asked: dict[Key, Clues]
    # None: no model answered (none set up, it failed); they stay in "general" for now.
    answers: dict[Key, MaterialType] | None

    def kind_of(self, key: Key, m: Material) -> MaterialType:
        if self.answers is not None and key in self.asked:
            return self.answers[key]
        return classify(m.clues())

    def note(self, key: Key, row: FilesItem) -> dict[str, object]:
        """What a new item's snapshot records of how it was sorted."""
        if key not in self.asked:
            return {}
        if self.answers is None:
            return {SORT_LATER: {"folder": row.folder_id, "clues": asdict(self.asked[key])}}
        return {"by": "ai"}


async def _sort(ctx: Ctx, found: _Found) -> _Sorting:
    asked: dict[Key, Clues] = {}
    new = 0
    for key, m in found.materials.items():
        ref = found.known.get(key)
        if m.is_list or (ref is not None and (ref.dismissed_at or ref.target_id)):
            continue
        new += 1
        if new > PER_RUN:
            break
        if classify(clues := m.clues()) == "general":
            asked[key] = clues
    waiting = {
        key: ref
        for key, ref in found.known.items()
        if ref.target_id and isinstance(ref.snapshot.get(SORT_LATER), dict)
    }
    rows = {
        r.id: r for r in await files.find_items(ctx, [r.target_id or "" for r in waiting.values()])
    }
    for key, ref in waiting.items():
        row = rows.get(ref.target_id or "")
        later = ref.snapshot[SORT_LATER]
        if row is not None and row.folder_id == later["folder"] and len(asked) < PER_RUN:
            asked.setdefault(key, Clues(**later["clues"]))
    keys = {f"{kind}:{external_id}": (kind, external_id) for kind, external_id in asked}
    answers = await sorting.classify_leftovers(
        ctx, {name: asked[key] for name, key in keys.items()}
    )
    return _Sorting(
        asked,
        None if answers is None else {keys[name]: kind for name, kind in answers.items()},
    )


# --- writing --------------------------------------------------------------------------------


class _Folders:
    """The course's type folders (M07's `files_type_folders`): remembered, found again, or
    made."""

    def __init__(self, ctx: Ctx, course_id: str, known: dict[MaterialType, FilesTypeFolder]):
        self.ctx, self.course_id, self.known = ctx, course_id, known
        self.resolved: dict[MaterialType, str | None] = {}

    async def of(
        self, kind: MaterialType, imported: list[tuple[MaterialType, FilesItem]]
    ) -> str | None:
        if kind == "info":
            return None
        if kind not in self.resolved:
            self.resolved[kind] = await self._resolve(kind, imported)
        return self.resolved[kind]

    async def _resolve(
        self, kind: MaterialType, imported: list[tuple[MaterialType, FilesItem]]
    ) -> str | None:
        ctx, course_id = self.ctx, self.course_id
        row = self.known.get(kind)
        if row is None:
            return await sorting.make_folder(ctx, course_id, kind, self.known)
        if row.folder_id and await files.find_folder(ctx, course_id, row.folder_id) is not None:
            return row.folder_id
        # The user deleted the folder: where did they put this type's items since? Nowhere
        # (still): the type's new items go to the top level.
        places = Counter(i.folder_id for t, i in imported if t == kind and i.folder_id)
        for folder_id, _ in places.most_common():
            if await files.find_folder(ctx, course_id, folder_id) is not None:
                return sorting.remember(ctx, course_id, kind, folder_id, self.known)
        return None


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


async def _follow(ctx: Ctx, m: Material, ref: LmsImportedRef, row: FilesItem) -> None:
    """The item follows the platform's, except where the user changed it: a new name unless
    they renamed it, new contents unless they keep their own copy (read again only when the
    bytes changed, not on a rename). A copy stored for "store here" follows like the rest."""
    snap = ref.snapshot
    title = None if row.display_name != snap.get("name") else m.title
    retitled = title is not None and title != snap.get("title", snap.get("name"))
    if m.kind == "link":
        if snap.get("version") != m.version or retitled:
            await files.update_link(ctx, row, url=m.url or row.url or "", name=title)
    elif snap.get("version") != m.version and not row.kept_offline:
        await files.update_remote_file(
            ctx, row, name=title, mime=m.mime, size=m.size, version=m.version, url=m.web_url
        )
    elif retitled and title is not None:
        await files.rename_synced(ctx, row, title)


def _snapshot(m: Material, kind: MaterialType | None, row: FilesItem | None) -> dict[str, object]:
    snap: dict[str, object] = {**m.notes, "version": m.version, "size": m.size, "title": m.title}
    if kind is not None:
        snap["type"] = kind
    if row is not None:
        snap["name"] = row.display_name
    if m.is_list:
        snap["list"] = True
    return snap


def _retry_due(row: FilesItem, now: datetime) -> bool:
    """A file the platform did not give (it was down, the credentials were missing) is read
    again: at once when it never was, else after `RETRY_AFTER`."""
    if row.doc_status != "failed" or not content.remote(row):
        return False
    code = row.doc_error_code or ""
    if code == files.SOURCE_UNREAD:
        return True
    return code.startswith("lms.") and now - row.updated_at >= RETRY_AFTER


async def run(ctx: Ctx, link: LmsCourseLink, b: Bound) -> StageResult:
    def read_refs() -> Any:
        return select(LmsImportedRef).where(
            LmsImportedRef.link_id == link.id,
            LmsImportedRef.external_kind.in_(KINDS),
        )

    refs = list(await ctx.db.scalars(read_refs()))
    found = _Found({(r.external_kind, r.external_id): r for r in refs}, ctx.now)
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
    refs = list(await ctx.db.scalars(read_refs().execution_options(populate_existing=True)))
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
    folders = _Folders(ctx, link.course_id, await sorting.type_folders(ctx, link.course_id))

    result = StageResult()
    added: list[FilesItem] = []
    gone: list[FilesItem] = []
    for key, m in found.materials.items():
        ref = known.get(key)
        row = rows.get(ref.target_id) if ref is not None and ref.target_id else None
        if m.is_list:
            if ref is None:
                ref = LmsImportedRef(
                    user_id=ctx.user_id, link_id=link.id, external_kind=m.kind,
                    external_id=m.external_id, snapshot={},
                )  # fmt: skip
                ctx.db.add(ref)
            elif row is not None and not row.kept_offline:
                gone.append(row)  # a page that has become a list of links
                ref.target_id = None
            ref.snapshot = _snapshot(m, None, None)
            continue
        if ref is not None and ref.dismissed_at is not None:
            continue
        if ref is not None and row is not None:
            await _follow(ctx, m, ref, row)
            ref.snapshot = {**ref.snapshot, **_snapshot(m, None, row)}
            continue
        if len(added) >= PER_RUN:
            result.cap_reached = True
            continue
        kind = plan.kind_of(key, m)
        row = await _create(ctx, link, m, await folders.of(kind, imported))
        added.append(row)
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
        ref.snapshot = {**_snapshot(m, kind, row), **plan.note(key, row)}
        imported.append((kind, row))

    if found.complete:
        # Gone from the platform: gone here too, unless the user keeps a copy. The ref forgets
        # it, so it comes back if the platform shows it again.
        for key, ref in known.items():
            row = rows.get(ref.target_id) if ref.target_id else None
            if row is None or key in found.materials or key in found.kept or row.kept_offline:
                continue
            gone.append(row)
            ref.target_id, ref.snapshot = None, {}
    await files.purge_items(ctx, gone)
    left = {r.id for r in gone}

    # Placed in "general" while no model could answer: moved now that one has, unless the user
    # moved it meanwhile (then it is theirs and no longer waits).
    for key, ref in known.items():
        later = ref.snapshot.get(SORT_LATER)
        if not isinstance(later, dict):
            continue
        row = rows.get(ref.target_id) if ref.target_id else None
        moved = row is None or row.id in left or row.folder_id != later.get("folder")
        if not moved and (plan.answers is None or key not in plan.answers):
            continue
        snap = {k: v for k, v in ref.snapshot.items() if k != SORT_LATER}
        if row is not None and not moved and plan.answers is not None:
            kind = plan.answers[key]
            if kind != "general":
                to = await folders.of(kind, imported)
                await files.move_entries(ctx, link.course_id, [row.id], [], to)
            snap |= {"type": kind, "by": "ai"}
        ref.snapshot = snap

    remote = [r for r in (*rows.values(), *added) if r.id not in left and content.remote(r)]
    for row in remote:
        if _retry_due(row, ctx.now):
            await files.retry_synced(ctx, row)
    if link.files_offline:
        await files.keep_synced_offline(ctx, remote, dedupe=f"lms.files:{link.id}")
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
    from it or stored for it go (a copy the user keeps stays). Its type folders stay: they are
    the user's."""
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
    rows = await files.find_items(ctx, [i for i in ids if i])
    await files.purge_items(ctx, [r for r in rows if not r.kept_offline])
    await files.detach_from_source(ctx, [r for r in rows if r.kept_offline])
