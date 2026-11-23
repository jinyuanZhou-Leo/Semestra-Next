"""What the `files` stage reads of the course's materials on the platform (M09 §4.2), before it
takes the write lock: the items found, their places, and whether each known one not found is
gone (table 3c).

Where an item goes (`_place`): a module's items in a folder named after the module; a file of
the files area in its folder there; what only a page links to (courses that hide their files
area link their files from pages) in a folder named after that page, inside the folder of the
page itself, and the page with it. The course's front page does not count: it links to
everything. At most three levels (M07's deepest), the folders made on first need and remembered
by their place (`files.source_folders`), so the user may rename or move them.

The lists of the files area, the modules and the pages are read through the round
(`SyncRound.area`), so their results are what table 3c judges by. What no list gives a version
for (a file only a module or a page shows, a page only a module or a page links to) is read on
its own, within the round's budget, oldest first, and not again within a day (table 3c, rows
7-8). Pages that are only a list of links (a module's table of contents) are not kept; what they
list goes in a folder named after them.
"""

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from urllib.parse import urlsplit

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules.files import sources
from semestra.modules.files.models import FilesItem
from semestra.modules.files.source_folders import Segment
from semestra.modules.lms import reads
from semestra.modules.lms.answers import AREA_HIDDEN, ItemAnswer, Present
from semestra.modules.lms.materials import MaterialKind, file_version, page_shape
from semestra.modules.lms.models import LmsCourseLink, LmsMaterial
from semestra.modules.lms.rules import CHECK_EVERY, Presence, presence
from semestra.modules.lms.schemas.dto import FileMeta, ModuleItem, PageDetail
from semestra.modules.lms.service import Bound
from semestra.modules.lms.sync_round import SyncRound

Key = tuple[str, str]
# The areas a material may be listed in, by the provider feature that offers each (table 3c:
# materials are judged by all of them; a page or a module may link a file of the files area).
AREAS: dict[str, str] = {"files": "folders", "modules": "modules", "pages": "pages"}
# Kinds that can be read on their own (a link only exists in its module).
READABLE = ("file", "page")
# What a material holds that the platform may still have: judged when not found this round.
FOLLOWED = ("synced", "list")


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
    # What a page links to (None: not read this round).
    links: list[list[str]] | None = None


@dataclass
class Found:
    known: dict[Key, LmsMaterial]
    # The followed items of the known materials (`synced`), whose version is theirs (§4.6).
    items: dict[str, FilesItem] = field(default_factory=lambda: {})
    materials: dict[Key, Material] = field(default_factory=lambda: {})
    # Pages to look at: slug → (title, version known from the list or None, web address).
    pages: dict[str, tuple[str, str | None, str | None]] = field(default_factory=lambda: {})
    # The module a page or file was first seen in (id, name).
    placed: dict[Key, Segment] = field(default_factory=lambda: {})
    # Pages linking to files and pages, in the order they were read: (page slug, target).
    linked_from: list[tuple[str, Key]] = field(default_factory=lambda: [])
    # The front page: it links to everything, so it is no item's place.
    front: set[str] = field(default_factory=lambda: set[str]())
    # Files no list showed with their facts, to read one by one.
    file_ids: dict[str, None] = field(default_factory=lambda: {})
    # In one of this round's area lists, locked ones too (table 3c, row 3).
    listed: set[Key] = field(default_factory=lambda: set[Key]())
    # Locked on the platform: still there, left as they are until they open.
    locked: set[Key] = field(default_factory=lambda: set[Key]())
    # Given by the platform itself this round: in its own area's list, or read on its own (a
    # file only a module shows is listed, not given). Only these may let their copies go
    # (table 3c, note): the platform gives their contents now.
    given: set[Key] = field(default_factory=lambda: set[Key]())

    def unchanged(self, key: Key, version: str | None) -> bool:
        """The platform's `version` of a known material is the one last applied: its followed
        item's, else the one the material keeps (a list page, one the user deleted)."""
        mat = self.known.get(key)
        if version is None or mat is None:
            return False
        if mat.state == "synced":
            row = self.items.get(mat.item_id or "")
            return row is not None and not sources.source_changed(row, version)
        return mat.version == version

    def add(self, m: Material) -> None:
        self.materials.setdefault((m.kind, m.external_id), m)

    def linked(self, kind: str, target: str, page: str) -> None:
        """A page links to a file or page of the course: it comes in."""
        self.linked_from.append((page, (kind, target)))
        if kind == "file":
            self.file_ids.setdefault(target, None)
        elif target not in self.pages:
            self.pages[target] = (target, None, None)


@dataclass
class _Reader:
    ctx: Ctx
    link: LmsCourseLink
    b: Bound
    round: SyncRound
    found: Found

    async def resting(self, key: Key) -> bool:
        """Read on its own within a day, so not read again now (table 3c, rows 7-8): as it was
        (an item kept in the files, or a list page), or its area closed."""
        last = await self.round.last(self.ctx, self.link, *key)
        if last is None or self.ctx.now - last.at >= CHECK_EVERY:
            return False
        if last.result == "unavailable":
            return last.reason == AREA_HIDDEN
        mat = self.found.known.get(key)
        return last.result == "present" and mat is not None and mat.state in FOLLOWED

    async def read_many(
        self, kind: str, external_ids: Sequence[str], *, budgeted: bool = True
    ) -> dict[str, ItemAnswer]:
        """Items of one kind read on their own, side by side, within the round's budget."""
        linked = (self.link, self.b)

        async def fetch(ids: list[str]) -> Sequence[Any]:
            if kind == "file":
                return await reads.files_many(self.ctx, linked, ids, refresh=True)
            return await reads.pages_many(self.ctx, linked, [(i, None) for i in ids], refresh=True)

        return await self.round.read_many(
            self.ctx, self.b, kind, external_ids, fetch, budgeted=budgeted
        )


async def read(
    ctx: Ctx, link: LmsCourseLink, b: Bound, sync_round: SyncRound, known: dict[Key, LmsMaterial]
) -> Found:
    """The course's materials on the platform, with their places."""
    followed = [m.item_id for m in known.values() if m.state == "synced" and m.item_id]
    items = {row.id: row for row in await sources.find_items(ctx, followed)}
    r = _Reader(ctx, link, b, sync_round, Found(known, items))
    features = b.provider.features
    for area, feature in AREAS.items():
        if feature not in features:
            sync_round.unsupported(area)
    if "modules" in features:
        await _modules(r)
    if "pages" in features:
        await _pages(r)
    await _files(r)
    _place(r.found)
    return r.found


async def judge(
    ctx: Ctx, link: LmsCourseLink, b: Bound, sync_round: SyncRound, found: Found
) -> dict[Key, Presence]:
    """Whether each known material this round did not bring is still on the platform (table
    3c): one followed, or restored by the user (`absent` and quiet). One that needs a read of its
    own to tell is read now, within the round's budget."""
    r = _Reader(ctx, link, b, sync_round, found)
    areas = sync_round.results(AREAS)
    out: dict[Key, Presence] = {}
    check: list[Key] = []
    for key, mat in found.known.items():
        if key in found.materials or not (
            mat.state in FOLLOWED or (mat.state == "absent" and mat.quiet)
        ):
            continue
        verdict = presence(
            listed=key in found.listed or key in found.locked,
            areas=areas,
            now=ctx.now,
            read=sync_round.read_this_round(*key),
            last=await sync_round.last(ctx, link, *key),
        )
        if verdict == "check":
            if key[0] in READABLE:
                check.append(key)
            verdict = "unknown"
        out[key] = verdict
    ordered = await sync_round.oldest_first(ctx, link, check)
    for kind in READABLE:
        got = await r.read_many(kind, [e for k, e in ordered if k == kind])
        for external_id, answer in got.items():
            if isinstance(answer, Present):
                found.given.add((kind, external_id))
            out[(kind, external_id)] = presence(listed=False, areas=areas, now=ctx.now, read=answer)
    return out


# --- the areas ------------------------------------------------------------------------------


async def _modules(r: _Reader) -> None:
    course_id = r.link.course_id
    listed = await r.round.area(
        r.ctx, r.link, r.b, "modules", lambda: reads.modules(r.ctx, course_id, refresh=True)
    )
    if listed is None:
        return
    for module in listed.items:
        items = module.items
        if items is None:
            module_id = module.external_id
            got = await r.round.area(
                r.ctx,
                r.link,
                r.b,
                "modules",
                lambda m=module_id: reads.module_items(r.ctx, course_id, m, refresh=True),
                part=True,
            )
            items = got.items if got is not None else []
        for item in sorted(items, key=lambda i: i.position):
            _module_item(item, (f"module:{module.external_id}", module.name), r.found)


def _module_item(item: ModuleItem, module: Segment, found: Found) -> None:
    target = item.target.ref if item.target is not None else None
    if item.kind in ("file", "page") and target:
        found.listed.add((item.kind, target))
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
            found.listed.add(("link", item.external_id))
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


async def _files(r: _Reader) -> None:
    features = r.b.provider.features
    course_id = r.link.course_id
    metas: dict[str, FileMeta] = {}
    if "folders" in features:
        listed = await r.round.area(
            r.ctx, r.link, r.b, "files", lambda: reads.course_files(r.ctx, course_id, refresh=True)
        )
        metas = {f.external_id: f for f in listed.items} if listed is not None else {}
        r.found.listed.update(("file", f) for f in metas)
    if "files" in features:
        # Files only a module or a page shows (the files area hidden): on their own, side by
        # side, now and then.
        wanted = [("file", f) for f in r.found.file_ids if f not in metas]
        todo = [
            key[1]
            for key in await r.round.oldest_first(r.ctx, r.link, wanted)
            if not await r.resting(key)
        ]
        for file_id, answer in (await r.read_many("file", todo)).items():
            if isinstance(answer, Present):
                metas[file_id] = answer.data
    r.found.given.update(("file", f) for f in metas)
    for meta in metas.values():
        if meta.locked:
            r.found.locked.add(("file", meta.external_id))
            continue  # comes in once it opens
        r.found.add(
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
            )
        )


async def _pages(r: _Reader) -> None:
    course_id = r.link.course_id
    listed = await r.round.area(
        r.ctx, r.link, r.b, "pages", lambda: reads.pages(r.ctx, course_id, refresh=True)
    )
    for page in listed.items if listed is not None else []:
        version = page.updated_at.isoformat() if page.updated_at else None
        r.found.pages[page.ref] = (page.title, version, page.web_url)
        r.found.listed.add(("page", page.ref))
        r.found.given.add(("page", page.ref))
        if page.front_page:
            r.found.front.add(page.ref)
    done: set[str] = set()
    # Pages bring in what they link to, other pages among it: until no new page is found. The
    # pages of one round that are to be read are read side by side; a page the pages list shows
    # changed is read whatever the budget, one only linked to within it (table 3c, note).
    while todo := [("page", slug) for slug in r.found.pages if slug not in done]:
        unread: list[str] = []
        for _, slug in await r.round.oldest_first(r.ctx, r.link, todo):
            done.add(slug)
            if not await _page_as_known(r, slug):
                unread.append(slug)
        changed = [slug for slug in unread if r.found.pages[slug][1] is not None]
        linked = [slug for slug in unread if r.found.pages[slug][1] is None]
        answers = await r.read_many("page", changed, budgeted=False)
        answers.update(await r.read_many("page", linked))
        for slug in unread:
            if isinstance(answer := answers.get(slug), Present):
                r.found.given.add(("page", slug))
                _page(r, slug, answer.data)


async def _page_as_known(r: _Reader, slug: str) -> bool:
    """A page unchanged since it was last read (its version the same, or read on its own within
    a day): taken as it was, what it links to still holds. False when it is to be read."""
    found = r.found
    title, version, _ = found.pages[slug]
    key = ("page", slug)
    mat = found.known.get(key)
    if not (found.unchanged(key, version) or (version is None and await r.resting(key))):
        return False
    if mat is None:
        return True  # its area closed: not read again today
    for kind, target in mat.links:
        found.linked(kind, target, slug)
    if mat.state == "list":
        found.add(Material("page", slug, title, version or "", is_list=True, links=mat.links))
    return True


def _page(r: _Reader, slug: str, detail: PageDetail) -> None:
    found = r.found
    title, version, web_url = found.pages[slug]
    key = ("page", slug)
    if detail.locked:
        found.locked.add(key)
        return
    title = detail.title or title
    found.pages[slug] = (title, version, web_url)
    if detail.front_page:
        found.front.add(slug)
    version = detail.updated_at.isoformat() if detail.updated_at else (version or "")
    shape = page_shape(detail.html)
    links: list[list[str]] = []
    for url in shape.links:
        target = r.b.rewrite(url, r.link.external_course_id)
        if target is not None and target.kind in ("file", "page") and target.ref != slug:
            links.append([target.kind, target.ref])
            found.linked(target.kind, target.ref, slug)
    if shape.is_list:
        found.add(Material("page", slug, title, version, is_list=True, links=links))
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
        )
    )


# --- places ---------------------------------------------------------------------------------


def _place(found: Found) -> None:
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
