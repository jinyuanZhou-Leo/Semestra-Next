"""The `files` stage of the course sync (M09 §4.2): the course's files, pages and links on the
platform become items of the course's files (M07), in the folders they are in on the platform.

Where an item goes (`_place`): a module's items in a folder named after the module; a file of
the files area in its folder there; what only a page links to (courses that hide their files
area link their files from pages) in a folder named after that page, inside the folder of the
page itself, and the page with it. The course's front page does not count: it links to
everything. At most three levels (M07's deepest), the folders made on first need and remembered
by their place (`files.source_folders`), so the user may rename or move them.

Every item keeps following the platform: a changed file is read again, a renamed one renamed.
By default nothing is copied: an item names its platform file or page (`source_ref`) and M07
reads the bytes from the platform when they are needed (`open_source`, registered as its content
source), so the materials take none of the user's storage. With the course's `store` setting at
`local` (M11 namespace `lms.materials`, account and course) a local copy is kept too, so they
open after the platform course closes (`sources.apply_copies`; the user may choose otherwise for
one file). Their text is read and indexed like any file's (M07's `auto_index`), for search and
Sem.

Each platform item has a row in `lms_materials` (`LmsMaterial`, whose states are explained
there) with its item and what was last applied (platform title, content version, name, place).
The user's changes always win: a moved item stays where they put it (an item is placed once,
when it comes in; one the sync put somewhere else than its place now is offered to move back by
the course's "Organize", `homes`), a renamed one keeps their name, a deleted one is not brought
back until they restore it (`dismissed`). A folder of a place the user deleted is not made
again: its new items go to the folder above.

An item gone from the platform (deleted, unpublished) becomes `absent`. Where an area of the
course could not be read whole (hidden, cut short), each item missing from the run is read on
its own and taken as gone only when the platform says it has no such item (`_check_missing`);
nothing is judged gone while the course can't be read at all (closed there). One saved in
Semestra stays as the user's own file (`handed_over`), one read online is removed (`gone`);
either comes in again if the platform shows it again. One locked on the platform is still
there: it stays as it was. What left, and what came in or changed, shows
in the status panel's recent updates (`change`); new ones are marked unseen in the files and told
by notification. Not until the course has settled (`materials_settled_at`, the first run that
brought everything in): linking a course is quiet.

A run reads the platform first, then, under the write lock (a batch of new items at a time,
each in a transaction of its own: `_write`), takes what happened to each material
to `enter` its next state: the one place that changes `LmsMaterial.state`, keeping what each
state holds (an item only while `synced`; what was applied from the platform forgotten when it
left the files) and refusing a change `NEXT` does not list.

Pages that are only a list of links (a module's table of contents) are not kept; what they list
goes in a folder named after them.
"""

from collections.abc import AsyncIterator, Awaitable, Mapping
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from html import escape
from typing import Any, Literal
from urllib.parse import urlsplit

from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.errors import AppError, not_found
from semestra.core.events import Event, events
from semestra.modules.academics import service as academics
from semestra.modules.files import register_content_source, sources
from semestra.modules.files.models import FilesItem
from semestra.modules.files.source_folders import Segment, SourceFolders
from semestra.modules.lms import reads, service
from semestra.modules.lms.errors import lms_error
from semestra.modules.lms.materials import page_shape
from semestra.modules.lms.models import LmsCourseLink, LmsMaterial, MaterialChange, MaterialState
from semestra.modules.lms.reads import AREA_REFUSALS, ITEM_ERRORS
from semestra.modules.lms.schemas.dto import FileMeta, ModuleItem, PageDetail
from semestra.modules.lms.schemas.io import HeldMaterials
from semestra.modules.lms.service import Bound
from semestra.modules.lms.settings import materials as material_settings
from semestra.modules.lms.sync import UPDATED, Notice, StageResult, hold, register_sync_stage
from semestra.modules.lms.sync import queue as sync_queue
from semestra.modules.settings import service as settings_service

MaterialKind = Literal["file", "page", "link"]
Key = tuple[str, str]
Area = Literal["modules", "pages", "files"]
# New items written in one transaction: a run brings in all it found, a batch at a time, so the
# write lock is let go between them.
BATCH = 100
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
    # A module it is in (id, name), or its folder in the files area (names and ids).
    module: Segment | None = None
    folder_path: str | None = None
    folder_ids: list[str] = field(default_factory=lambda: [])
    # Its place on the platform, (id, name) pairs from the top (`_place`).
    path: list[Segment] = field(default_factory=lambda: [])
    # A page that only lists other things: remembered (so it is read again only when it
    # changes), never an item.
    is_list: bool = False
    # What a page links to, and when the item was read on its own (None: not known this run).
    links: list[list[str]] | None = None
    checked_at: datetime | None = None


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
    # The module a page or file was first seen in (id, name).
    placed: dict[Key, Segment] = field(default_factory=lambda: {})
    # Pages linking to files and pages, in the order they were read: (page slug, target).
    linked_from: list[tuple[str, Key]] = field(default_factory=lambda: [])
    # The front page: it links to everything, so it is no item's place.
    front: set[str] = field(default_factory=lambda: set[str]())
    # Files no list showed, to read one by one.
    file_ids: dict[str, None] = field(default_factory=lambda: {})
    # Items there and unchanged, not read again this run.
    kept: set[Key] = field(default_factory=lambda: set[Key]())
    # Items locked on the platform: still there, left as they are until they open.
    locked: set[Key] = field(default_factory=lambda: set[Key]())
    # Areas read whole, and areas the user can't open or that were cut short.
    read: set[Area] = field(default_factory=lambda: set[Area]())
    refused: set[Area] = field(default_factory=lambda: set[Area]())
    # Items no area showed, read on their own (`_check_missing`): still there (with when they
    # were read), or not known to be gone (not readable now).
    confirmed: dict[Key, datetime] = field(default_factory=lambda: {})
    unsure: set[Key] = field(default_factory=lambda: set[Key]())
    # Items written by an earlier batch of this run.
    applied: set[Key] = field(default_factory=lambda: set[Key]())

    @property
    def complete(self) -> bool:
        """Every area was read whole: what is not found is gone from the platform."""
        return not self.refused

    def add(self, m: Material) -> None:
        self.materials.setdefault((m.kind, m.external_id), m)

    def seen(self, key: Key) -> bool:
        """Found on the platform this run, one way or another: not gone."""
        return (
            key in self.materials
            or key in self.kept
            or key in self.locked
            or key in self.confirmed
            or key in self.unsure
        )

    def checked_lately(self, key: Key) -> bool:
        """Read on its own within `CHECK_EVERY` (an item in the files or one the user deleted,
        or a list page): taken to be as it was."""
        mat = self.known.get(key)
        if mat is None or mat.state not in ("synced", "list", "dismissed"):
            return False
        return mat.checked_at is not None and self.now - mat.checked_at < CHECK_EVERY

    def linked(self, kind: str, target: str, page: str) -> None:
        """A page links to a file or page of the course: it comes in."""
        self.linked_from.append((page, (kind, target)))
        if kind == "file":
            self.file_ids.setdefault(target, None)
        elif target not in self.pages:
            self.pages[target] = (target, None, None)


async def _optional[T](found: _Found, area: Area, read: Awaitable[T]) -> T | None:
    """A read of one area of the course; None when the user can't open that area (then what is
    missing from it can't be told gone without reading it on its own: `_check_missing`)."""
    try:
        got = await read
    except AppError as exc:
        if exc.code in SKIPPED:
            found.refused.add(area)
            return None
        raise
    if getattr(got, "truncated", False):
        found.refused.add(area)
    else:
        found.read.add(area)
    return got


def _many[T](found: _Found, area: Area, got: T | AppError) -> T | None:
    """One file or page of a read of several; None when it is gone or not for this user (a link
    to a deleted file), which says nothing about the rest of the course."""
    if not isinstance(got, AppError):
        return got
    if got.code in SKIPPED - ITEM_ERRORS:
        found.refused.add(area)
    return None


async def _modules(ctx: Ctx, link: LmsCourseLink, found: _Found) -> None:
    listed = await _optional(found, "modules", reads.modules(ctx, link.course_id, refresh=True))
    if listed is None:
        return
    for module in listed.items:
        items = module.items
        if items is None:
            got = await _optional(
                found,
                "modules",
                reads.module_items(ctx, link.course_id, module.external_id, refresh=True),
            )
            items = got.items if got is not None else []
        for item in sorted(items, key=lambda i: i.position):
            _module_item(item, (f"module:{module.external_id}", module.name), found)


def _module_item(item: ModuleItem, module: Segment, found: _Found) -> None:
    target = item.target.ref if item.target is not None else None
    if item.locked:
        if item.kind in ("file", "page") and target:
            found.locked.add((item.kind, target))
        return
    if item.kind == "file" and target:
        found.placed.setdefault(("file", target), module)
        found.file_ids.setdefault(target, None)
    elif item.kind == "page" and target:
        found.placed.setdefault(("page", target), module)
        found.pages.setdefault(target, (item.title, None, item.web_url))
    elif item.kind in ("external_url", "external_tool"):
        own = item.external_url if item.kind == "external_url" else None
        if url := _link_url(own, item.web_url):
            found.add(
                Material(
                    "link",
                    item.external_id,
                    item.title or urlsplit(url).hostname or url,
                    version=url,
                    url=url,
                    web_url=item.web_url,
                    module=module,
                )
            )


def _link_url(*candidates: str | None) -> str | None:
    """The first address a link in the files can open (http or https): one to another kind of
    address (mailto:, an app's own scheme) opens through the platform's view of the item."""
    for url in candidates:
        if not url:
            continue
        try:
            sources.normalize_url(url)
        except AppError:
            continue
        return url
    return None


async def _files(ctx: Ctx, link: LmsCourseLink, b: Bound, found: _Found) -> None:
    metas: dict[str, FileMeta] = {}
    if "folders" in b.provider.features:
        listed = await _optional(
            found, "files", reads.course_files(ctx, link.course_id, refresh=True)
        )
        metas = {f.external_id: f for f in listed.items} if listed is not None else {}
    checked: set[str] = set()
    # Files only a module or a page shows (the files area hidden): on their own, now and then.
    todo: list[str] = []
    for file_id in found.file_ids:
        if file_id in metas or "files" not in b.provider.features:
            continue
        if found.checked_lately(("file", file_id)):
            found.kept.add(("file", file_id))
            continue
        todo.append(file_id)
    read = await reads.files_many(ctx, (link, b), todo, refresh=True) if todo else []
    for file_id, got in zip(todo, read, strict=True):
        if (meta := _many(found, "files", got)) is not None:
            metas[file_id] = meta
            checked.add(file_id)
    for meta in metas.values():
        if meta.locked:
            found.locked.add(("file", meta.external_id))
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
                folder_ids=meta.folder_ids,
                modified_at=meta.content_at or meta.updated_at,
                checked_at=found.now if meta.external_id in checked else None,
            )
        )


async def _pages(ctx: Ctx, link: LmsCourseLink, b: Bound, found: _Found) -> None:
    listed = await _optional(found, "pages", reads.pages(ctx, link.course_id, refresh=True))
    for page in listed.items if listed is not None else []:
        version = page.updated_at.isoformat() if page.updated_at else None
        found.pages[page.ref] = (page.title, version, page.web_url)
        if page.front_page:
            found.front.add(page.ref)
    done: set[str] = set()
    # Pages bring in what they link to, other pages among it: until no new page is found. The
    # pages of one round that are to be read again are read side by side.
    while todo := [slug for slug in found.pages if slug not in done]:
        done.update(todo)
        unread = [slug for slug in todo if not _page_as_known(found, slug)]
        details = (
            await reads.pages_many(ctx, (link, b), [(slug, None) for slug in unread], refresh=True)
            if unread
            else []
        )
        for slug, got in zip(unread, details, strict=True):
            _page(link, b, found, slug, _many(found, "pages", got))


def _page_as_known(found: _Found, slug: str) -> bool:
    """A page unchanged since it was last read (its version the same, or read on its own
    lately): taken as it was, what it links to still holds. False when it is to be read."""
    _, version, _ = found.pages[slug]
    key = ("page", slug)
    mat = found.known.get(key)
    unchanged = version is not None and mat is not None and mat.version == version
    if not (unchanged or (version is None and found.checked_lately(key))):
        return False
    assert mat is not None
    for kind, target in mat.links:
        found.linked(kind, target, slug)
    if mat.state == "list":
        found.add(
            Material(
                "page",
                slug,
                found.pages[slug][0],
                version or "",
                is_list=True,
                links=mat.links,
                checked_at=mat.checked_at,
            )
        )
    elif mat.state == "synced":
        found.kept.add(key)
    return True


def _page(
    link: LmsCourseLink, b: Bound, found: _Found, slug: str, detail: PageDetail | None
) -> None:
    title, version, web_url = found.pages[slug]
    key = ("page", slug)
    if detail is not None and detail.locked:
        found.locked.add(key)
    if detail is None or detail.locked:
        return
    title = detail.title or title
    found.pages[slug] = (title, version, web_url)
    if detail.front_page:
        found.front.add(slug)
    version = detail.updated_at.isoformat() if detail.updated_at else (version or "")
    shape = page_shape(detail.html)
    links: list[list[str]] = []
    for url in shape.links:
        target = b.rewrite(url, link.external_course_id)
        if target is not None and target.kind in ("file", "page") and target.ref != slug:
            links.append([target.kind, target.ref])
            found.linked(target.kind, target.ref, slug)
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


def _missing(found: _Found) -> list[Key]:
    """Items in the course files (or restored, waiting to come in) that this run did not find."""
    return [
        key
        for key, mat in found.known.items()
        if (mat.state == "synced" or (mat.state == "absent" and mat.quiet)) and not found.seen(key)
    ]


# What an item read on its own says when it is no longer there for the user. The course was
# open in this run (an area was read), so a refusal is about the item, not the course.
_GONE = frozenset(("lms.not_found", "lms.forbidden"))


async def _check_missing(ctx: Ctx, link: LmsCourseLink, b: Bound, found: _Found) -> None:
    """What this run did not find, where an area could not be read whole: each item is judged
    on its own, so one hidden area does not keep the whole course from noticing deletions.

    - Nothing of the course could be read (closed on the platform): nothing is judged.
    - A link: only modules show links, so it is gone when they were read whole.
    - A file or page: read on its own (not again within `CHECK_EVERY` once read). Gone when
      the platform says it has no such item or refuses it (unpublished, no longer shown to the
      user), as when it is missing from an area read whole; one it can't answer for now
      (unreachable, rate limited) is left as it is, its copy kept."""
    if found.complete:
        return
    missing = _missing(found)
    if not found.read:
        found.unsure.update(missing)
        return
    files: list[str] = []
    pages: list[str] = []
    for key in missing:
        kind, external_id = key
        if kind == "link":
            if "modules" in found.refused:
                found.unsure.add(key)
        elif found.checked_lately(key):
            found.kept.add(key)
        elif kind == "file" and "files" in b.provider.features:
            files.append(external_id)
        elif kind == "page" and "pages" in b.provider.features:
            pages.append(external_id)
        else:
            found.unsure.add(key)
    got: list[tuple[Key, Any]] = []
    if files:
        read = await reads.files_many(ctx, (link, b), files, refresh=True)
        got += [(("file", i), r) for i, r in zip(files, read, strict=True)]
    if pages:
        read = await reads.pages_many(ctx, (link, b), [(i, None) for i in pages], refresh=True)
        got += [(("page", i), r) for i, r in zip(pages, read, strict=True)]
    for key, result in got:
        if isinstance(result, AppError):
            if result.code not in _GONE:
                found.unsure.add(key)  # asked again next run
            continue
        if result.locked:
            found.locked.add(key)
        found.confirmed[key] = found.now


def _place(found: _Found) -> None:
    """Each item's place on the platform (see the module docstring): its module, else its
    folder in the files area, else the place of the page that first links to it plus that page's
    title (a page with such items goes in that folder too)."""
    parent: dict[Key, str] = {}

    def ancestors(slug: str) -> set[str]:
        seen: set[str] = set()
        while slug not in seen:
            seen.add(slug)
            up = parent.get(("page", slug))
            if up is None:
                break
            slug = up
        return seen

    for page, key in found.linked_from:
        if page in found.front or key in parent or key in found.placed:
            continue
        if key[0] == "page" and key[1] in ancestors(page):
            continue  # pages linking to each other
        parent[key] = page
    holders = {
        page
        for key, page in parent.items()
        if key in found.materials and not found.materials[key].is_list
    }
    memo: dict[Key, list[Segment]] = {}

    def own(key: Key, seen: frozenset[Key]) -> list[Segment]:
        """Where the item's folder is (the place of its parent page's folder)."""
        if key in memo:
            return memo[key]
        m = found.materials.get(key)
        module = found.placed.get(key) or (m.module if m is not None else None)
        if module:
            path = [module]
        elif m is not None and m.folder_path:
            path = _folder_place(m.folder_path, m.folder_ids)
        elif (page := parent.get(key)) is not None and ("page", page) not in seen:
            title = found.pages.get(page, (page,))[0]
            path = [*own(("page", page), seen | {key}), (f"page:{page}", title)]
        else:
            path = []
        memo[key] = path
        return path

    for key, material in found.materials.items():
        path = own(key, frozenset())
        if key[0] == "page" and key[1] in holders and not material.is_list:
            path = [*path, (f"page:{key[1]}", material.title)]
        material.path = path


def _folder_place(folder_path: str, ids: list[str]) -> list[Segment]:
    """A files-area folder's levels, by the platform's folder ids (by the path's names when the
    provider gives none)."""
    names = folder_path.split("/")
    if len(ids) != len(names):
        ids = ["/".join(names[: i + 1]) for i in range(len(names))]
    return [(f"folder:{i}", n) for i, n in zip(ids, names, strict=True) if n]


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


# The states each state may go to; `None` is a row just made. Any other change is a bug.
NEXT: dict[str | None, frozenset[MaterialState]] = {
    None: frozenset({"synced", "list"}),
    # Followed (again, from a file saved anew); a page become a list; deleted by the user; gone
    # from the platform.
    "synced": frozenset({"synced", "list", "dismissed", "absent"}),
    "list": frozenset({"synced"}),
    # Restored by the user; saved in Semestra from the platform's own view.
    "dismissed": frozenset({"absent", "synced"}),
    # Back on the platform; a restored one gone from it meanwhile (told, no longer quiet).
    "absent": frozenset({"synced", "list", "absent"}),
}


def _forget_applied(mat: LmsMaterial) -> None:
    """Clears what was applied from the platform, so it is read whole when it comes in (its
    title stays: the status panel names what went by it)."""
    mat.version = mat.name = mat.checked_at = mat.placed_folder_id = None
    mat.links = []


def enter(
    mat: LmsMaterial,
    state: MaterialState,
    now: datetime,
    *,
    item_id: str | None = None,
    quiet: bool = False,
) -> None:
    """The material's next state, and what that state holds:

    - `synced`: its item `item_id`, nothing applied yet (the caller applies what it read);
    - `list`: no item, nothing applied yet;
    - `dismissed`: no item; what was read stays (what the page links to still comes in);
    - `absent`: nothing applied; `item_id` the user's own file it left, if any (never
      followed); `quiet` when the user restored it."""
    if state not in NEXT[mat.state]:
        raise RuntimeError(f"lms material {mat.id}: {mat.state} -> {state}")
    if state == "synced" and item_id is None:
        raise RuntimeError(f"lms material {mat.id}: synced without an item")
    mat.state, mat.state_at, mat.quiet = state, now, quiet
    mat.item_id = item_id
    if state == "synced":
        mat.imported_at = now
        mat.change = mat.changed_at = None
    if state != "dismissed":
        _forget_applied(mat)


def _note(mat: LmsMaterial, change: MaterialChange, now: datetime) -> None:
    mat.change, mat.changed_at = change, now


def _seen(mat: LmsMaterial, m: Material) -> None:
    """What this run saw of the platform's item; what it did not read again stays."""
    mat.title, mat.version, mat.path = m.title, m.version, [list(level) for level in m.path]
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


def _copy_due(row: FilesItem, now: datetime) -> bool:
    """A local copy the platform refused to give (the file unpublished, or not there) is asked
    for again after `RETRY_AFTER`, not on every run."""
    return row.copy_error_code not in ITEM_ERRORS or now - row.updated_at >= RETRY_AFTER


async def run(ctx: Ctx, link: LmsCourseLink, b: Bound) -> StageResult:
    mats = await ctx.db.scalars(select(LmsMaterial).where(LmsMaterial.link_id == link.id))
    found = _Found({(r.kind, r.external_id): r for r in mats}, ctx.now)
    features = b.provider.features
    if "modules" in features:
        await _modules(ctx, link, found)
    if "pages" in features:
        await _pages(ctx, link, b, found)
    await _files(ctx, link, b, found)
    await _check_missing(ctx, link, b, found)
    _place(found)

    result = StageResult()
    # Written a batch at a time, each in a transaction of its own: a large course comes in
    # whole in one run without holding the write lock all the while.
    while await _write(ctx, link, b, found, result):
        await ctx.db.commit()
    return result


async def _write(
    ctx: Ctx, link: LmsCourseLink, b: Bound, found: _Found, result: StageResult
) -> bool:
    """Applies what the run found, under the write lock: up to `BATCH` new items, then (once
    every one is in) what left the platform and the local copies. True when items are left for
    another batch."""
    await hold(ctx, link)
    # Under the lock: the user may have turned the sync off (and removed what it left) while the
    # platform was read; bringing it all back now would undo that.
    cfg = await material_settings(ctx, link.course_id)
    if not cfg.sync:
        return False
    # Read again under the write lock: the user may have answered (deleted, moved) meanwhile.
    mats = await ctx.db.scalars(
        select(LmsMaterial)
        .where(LmsMaterial.link_id == link.id)
        .execution_options(populate_existing=True)
    )
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

    added = 0
    gone: list[FilesItem] = []
    for key, m in found.materials.items():
        if key in found.applied:
            continue
        mat = known.get(key)
        row = rows.get(mat.item_id or "") if mat is not None and mat.state == "synced" else None
        if mat is not None and mat.state == "dismissed":
            _seen(mat, m)  # what it links to is known without reading it every run
            found.applied.add(key)
            continue
        if m.is_list:
            if mat is None:
                mat = _material(ctx, link, m)
            elif row is not None:
                gone.append(row)  # a page that has become a list of links
            if mat.state != "list":
                enter(mat, "list", now)
            _seen(mat, m)
            found.applied.add(key)
            continue
        if mat is not None and row is not None:
            if await _follow(ctx, m, mat, row) and settled:
                _note(mat, "updated", now)
            _seen(mat, m)
            await places.follow_names(m.path)
            found.applied.add(key)
            continue
        # New, back on the platform, restored, or a list page that has become a page.
        if added == BATCH:
            await sources.purge_items(ctx, gone)
            await ctx.db.flush()
            return True
        added += 1
        news = settled and not (mat is not None and mat.quiet)
        folder_id = await places.folder_at(m.path)
        row = await _create(ctx, link, b, m, folder_id, unseen=news)
        rows[row.id] = row
        if mat is None:
            mat = _material(ctx, link, m)
        enter(mat, "synced", now, item_id=row.id)
        _seen(mat, m)
        mat.name, mat.placed_folder_id = row.display_name, folder_id
        found.applied.add(key)
        # Most likely one of the user's own files: listed, so they can keep just one.
        if m.kind == "file" and await sources.find_duplicate(
            ctx, link.course_id, name=row.display_name, size=m.size, own_only=True
        ):
            _note(mat, "duplicate", now)
        elif news:
            _note(mat, "added", now)
        if news:
            result.notices.append(Notice("material", m.external_id, m.title, item_id=row.id))

    handed: list[FilesItem] = []
    for key, mat in known.items():
        if found.seen(key):
            if key in found.confirmed and mat.state == "synced":
                mat.checked_at = found.confirmed[key]
            continue
        # Gone from the platform: one saved in Semestra stays as the user's own file, one read
        # online goes. Either comes in again if the platform shows it again.
        if mat.state == "absent" and mat.quiet:
            if mat.state_at is not None and mat.state_at > found.now:
                continue  # restored after this run read: left to the run after it
            # Restored, but the platform no longer has it: told, not left waiting.
            enter(mat, "absent", now)
            _note(mat, "gone", now)
            continue
        row = rows.get(mat.item_id or "") if mat.state == "synced" else None
        if row is None:
            continue
        if has_copy(row):
            handed.append(row)
            enter(mat, "absent", now, item_id=row.id)
            _note(mat, "handed_over", now)
        else:
            gone.append(row)
            enter(mat, "absent", now)
            _note(mat, "gone", now)
    await sources.purge_items(ctx, gone)
    await sources.detach_from_source(ctx, handed)
    left = {r.id for r in (*gone, *handed)}

    followed = [r for r in rows.values() if r.id not in left]
    for row in followed:
        if _retry_due(row, now):
            await sources.retry_synced(ctx, row)
    # A copy is let go only when the platform still has the file: a course closed there refuses
    # its areas, and its copies may be the only ones left.
    there = {
        mat.item_id
        for key, mat in known.items()
        if mat.state == "synced" and key not in found.unsure and key not in found.locked
    }
    copies = [r for r in followed if _copy_due(r, now)]
    await sources.apply_copies(ctx, [r for r in copies if r.id in there], cfg.store == "local")
    await sources.apply_copies(
        ctx, [r for r in copies if r.id not in there], cfg.store == "local", release=False
    )
    if not settled:
        link.materials_settled_at = now
    await ctx.db.flush()
    return False


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
    places: SourceFolders | None = None
    found: list[sources.Home] = []
    for mat in mats:
        row = rows.get(mat.item_id or "")
        if row is None or row.source_ref is None or row.folder_id != mat.placed_folder_id:
            continue  # the user moved it, or it is theirs now
        name = row.source_name or "LMS"
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
        # Before the items go, so `on_item_deleted` does not take them as the user's deletes.
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
