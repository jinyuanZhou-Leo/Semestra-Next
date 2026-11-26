"""What the `files` stage reads of the course's materials on the platform (M09 §4.2), before it
takes the write lock: the items found, their places, and whether each known one not found is
gone (table 3c).

Where an item goes (`_place`): a module's items in a folder named after the module; a file of
the files area in its folder there; what only a page links to (courses that hide their files
area link their files from pages) in a folder named after that page, inside the folder of the
page itself, and the page with it. The course's front page and its syllabus do not count: they
link to everything (what only they link to is at the top). What only an assignment, an
announcement or a calendar event links to goes in a folder named after that source ("Assignments",
...). At most three levels (M07's deepest), the folders made on first need and remembered by
their place (`files.source_folders`), so the user may rename or move them.

Every text of the course the sync reads is a way in (M09 §4.6, table 4d), and all are read each
round: the lists, the front page, the syllabus (read with the lists), and the descriptions of
the assignments, the announcements and the calendar events (their mirrors, written by this
round's earlier stages: no request). What they link to of the course is read the same way.
The files attached to the announcements come in from the mirror too, never read on their own;
one last seen only that way leaves when no announcement carries it (`Material.attached`). The
settings turn some ways in off (`MaterialSettings`): then they bring in nothing new.

Pages are found from the pages list, the modules and the links of pages. The front page is a page
like the others (no item's place, though): in the pages list when that is read whole; else found
by the way to it (`front_page`, M09 table 2 row 21), read first, as that page's single read of
this round. A page no list gives a version of is read every round within the budget (only reading
it tells whether it changed); one its closed area refused is not read again within a day (table
3c, row 8).

The lists of the files area, the modules and the pages are read through the round
(`SyncRound.area`), so their results are what table 3c judges by. What no list gives a version
for (a file only a module or a page shows, a page only a module or a page links to) is read on
its own, within the round's budget, oldest first (a file not again within a day, table 3c rows
7-8). Pages that are only a list of links (a module's table of contents) are not kept; what they
list goes in a folder named after them.
"""

import hashlib
from collections.abc import Sequence
from dataclasses import dataclass, field, replace
from datetime import datetime
from typing import Any
from urllib.parse import urlsplit

from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules.files import sources
from semestra.modules.files.models import FilesItem
from semestra.modules.files.source_folders import Segment
from semestra.modules.lms import announcements, reads
from semestra.modules.lms.answers import AREA_HIDDEN, Gone, ItemAnswer, Present
from semestra.modules.lms.materials import (
    SYLLABUS_ID,
    MaterialKind,
    file_version,
    names,
    page_shape,
)
from semestra.modules.lms.models import (
    LmsAnnouncement,
    LmsAssignment,
    LmsCalendarEvent,
    LmsCourseLink,
    LmsMaterial,
)
from semestra.modules.lms.rules import CHECK_EVERY, Presence
from semestra.modules.lms.schemas.dto import (
    FRONT_PAGE_REF,
    FileMeta,
    ModuleItem,
    PageDetail,
    RichText,
)
from semestra.modules.lms.service import Bound
from semestra.modules.lms.settings import MaterialSettings
from semestra.modules.lms.sync_round import Asked, SyncRound

Key = tuple[str, str]
# The areas a material may be listed in, by the provider feature that offers each (table 3c:
# materials are judged by all of them; a page or a module may link a file of the files area).
AREAS: dict[str, str] = {"files": "folders", "modules": "modules", "pages": "pages"}
# The syllabus is listed only in its own area, where nothing else is.
SYLLABUS_AREA = "syllabus"
SYLLABUS: tuple[str, str] = ("syllabus", SYLLABUS_ID)
# The parts of the course the stage reads (M09 表 5c).
PARTS = (*AREAS, SYLLABUS_AREA)
# The texts kept by the stages before this one that are ways in (table 4d, rows 6-8), in the
# order they place what only they link to, with the table holding each.
ENTRIES = ("assignments", "announcements", "calendar")
ANNOUNCEMENTS: tuple[str, str] = ("entry", "announcements")
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
    # Its place on the platform, (id, name) pairs from the top (`_place`): None when only a way
    # in that is no place links to it (the front page, the syllabus, an assignment, an
    # announcement, a calendar event; M09 §4.6), so this round tells nothing of where it is.
    path: list[Segment] | None = field(default_factory=lambda: [])
    # The folder it goes in when it first comes in: its place, else where the way in that found
    # it puts it (the top, or the folder named after that way in).
    start: list[Segment] = field(default_factory=lambda: [])
    # A page that only lists other things: remembered (so it is read again only when it
    # changes), never an item.
    is_list: bool = False
    # What a page links to (None: not read this round).
    links: list[list[str]] | None = None
    # Seen this round only as an announcement's attachment (M09 §4.6, "公告附件"); None: this
    # round did not read every way in whole, so it does not tell (`attached` stays as it was).
    attached: bool | None = None


@dataclass
class Found:
    known: dict[Key, LmsMaterial]
    # The followed items of the known materials (`synced`), whose version is theirs (§4.6).
    items: dict[str, FilesItem] = field(default_factory=lambda: {})
    # Followed items whose text M07 reads differently now (`sources.outdated_items`): read from the
    # platform again even when unchanged there, so their text is read again (not told as a change).
    reread: set[str] = field(default_factory=lambda: set[str]())
    materials: dict[Key, Material] = field(default_factory=lambda: {})
    # Pages to look at: slug → (title, version known from the list or None, web address).
    pages: dict[str, tuple[str, str | None, str | None]] = field(default_factory=lambda: {})
    # The module a page or file was first seen in (id, name).
    placed: dict[Key, Segment] = field(default_factory=lambda: {})
    # What links to files and pages, in the order it was read: (source, target). A source is a
    # page `("page", slug)`, the syllabus, or a way in kept by another stage `("entry", name)`.
    linked_from: list[tuple[Key, Key]] = field(default_factory=lambda: [])
    # The front page: it links to everything, so it is no item's place.
    front: set[str] = field(default_factory=lambda: set[str]())
    # The names of the places the platform does not name (`materials.names`).
    names: dict[str, str] = field(default_factory=lambda: names("en"))
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
    # What the course's materials settings bring in (`settings.MaterialSettings`).
    cfg: MaterialSettings = field(default_factory=MaterialSettings)
    # Files attached to the kept announcements (table 4d row 7), by id: their facts are the
    # mirror's, never read on their own.
    attachments: dict[str, FileMeta] = field(default_factory=lambda: {})
    # A page that was to be read this round was not (refused, not answered, left for the
    # budget): what it links to is not known.
    pages_short: bool = False

    def unchanged(self, key: Key, version: str | None) -> bool:
        """The platform's `version` of a known material is the one last applied: its followed
        item's, else the one the material keeps (a list page, one the user deleted)."""
        mat = self.known.get(key)
        if version is None or mat is None:
            return False
        if mat.state == "synced":
            row = self.items.get(mat.item_id or "")
            return (
                row is not None
                and not sources.source_changed(row, version)
                and row.id not in self.reread
            )
        return mat.version == version

    def linked_elsewhere(self) -> set[str]:
        """The files something other than an announcement links to (a page, the syllabus, an
        assignment, a calendar event): an announcement's own link goes with it, so it tells of
        no other place the file is in (M09 §4.6, "只作为附件出现的")."""
        return {
            target
            for source, (kind, target) in self.linked_from
            if kind == "file" and source != ANNOUNCEMENTS
        }

    def by_announcements(self) -> set[str]:
        """The files the kept announcements carry or link to."""
        return set(self.attachments) | {
            target
            for source, (kind, target) in self.linked_from
            if kind == "file" and source == ANNOUNCEMENTS
        }

    def add(self, m: Material) -> None:
        self.materials.setdefault((m.kind, m.external_id), m)

    def linked(self, kind: str, target: str, source: Key) -> None:
        """A page, the syllabus or another way in links to a file or page of the course: it
        comes in."""
        self.linked_from.append((source, (kind, target)))
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

    async def closed_lately(self, key: Key) -> bool:
        """Its last single read, within a day, was refused for its area closed: not read again
        now (table 3c, row 8)."""
        last = await self.round.last(self.ctx, self.link, *key)
        return (
            last is not None
            and self.ctx.now - last.at < CHECK_EVERY
            and last.result == "unavailable"
            and last.reason == AREA_HIDDEN
        )

    async def fetch(self, kind: str, ids: list[str]) -> Sequence[Any]:
        """Files or pages read side by side: each one's data or the error it got."""
        linked = (self.link, self.b)
        if kind == "file":
            return await reads.files_many(self.ctx, linked, ids, refresh=True)
        return await reads.pages_many(self.ctx, linked, [(i, None) for i in ids], refresh=True)

    async def read_many(
        self, kind: str, external_ids: Sequence[str], *, budgeted: bool = True
    ) -> dict[str, ItemAnswer]:
        """Items of one kind read on their own, side by side, within the round's budget."""
        return await self.round.read_many(
            self.ctx,
            self.b,
            kind,
            external_ids,
            lambda ids: self.fetch(kind, ids),
            budgeted=budgeted,
        )


async def read(
    ctx: Ctx,
    link: LmsCourseLink,
    b: Bound,
    sync_round: SyncRound,
    known: dict[Key, LmsMaterial],
    cfg: MaterialSettings,
) -> Found:
    """The course's materials on the platform, with their places."""
    followed = [m.item_id for m in known.values() if m.state == "synced" and m.item_id]
    items = {row.id: row for row in await sources.find_items(ctx, followed)}
    found = Found(known, items, names=names(ctx.locale), cfg=cfg)
    found.reread = await sources.outdated_items(ctx, list(items.values()))
    r = _Reader(ctx, link, b, sync_round, found)
    features = b.provider.features
    for area, feature in {**AREAS, SYLLABUS_AREA: SYLLABUS_AREA}.items():
        if feature not in features:
            sync_round.unsupported(area)
    if "modules" in features:
        await _modules(r)
    if SYLLABUS_AREA in features:
        await _syllabus(r)
    await _entries(r)
    if "pages" in features:
        await _pages(r)
    await _files(r)
    _attachments(r)
    _place(r.found)
    return r.found


async def judge(
    ctx: Ctx, link: LmsCourseLink, b: Bound, sync_round: SyncRound, found: Found
) -> dict[Key, Presence]:
    """Whether each known material this round did not bring is still on the platform (table
    3c, `SyncRound.judge`): one followed, or restored by the user (`absent` and quiet). Files and
    pages can be read on their own; one given that way is the platform's (`Found.given`)."""
    r = _Reader(ctx, link, b, sync_round, found)
    asked = [
        Asked(key[0], key[1], listed=key in found.listed or key in found.locked,
              readable=key[0] in READABLE)
        for key, mat in found.known.items()
        if key not in found.materials
        and (mat.state in FOLLOWED or (mat.state == "absent" and mat.quiet))
    ]  # fmt: skip
    verdicts: dict[Key, Presence] = {}

    carried = found.by_announcements()

    def attached(a: Asked) -> bool:
        mat = found.known[(a.kind, a.external_id)]
        return mat.attached and a.kind == "file"

    # The syllabus may be listed only in its own area; one last seen only as an attachment only
    # among the announcements (not read on its own: it leaves when none carries it, §4.6); the
    # rest in the files, modules and pages.
    for wanted, areas in (
        (
            [a for a in asked if (a.kind, a.external_id) != SYLLABUS and not attached(a)],
            tuple(AREAS),
        ),
        ([a for a in asked if (a.kind, a.external_id) == SYLLABUS], (SYLLABUS_AREA,)),
        (
            [
                replace(a, readable=False, listed=a.external_id in carried)
                for a in asked
                if attached(a)
            ],
            (announcements.AREA,),
        ),
    ):
        if not wanted:
            continue
        judged = await sync_round.judge(ctx, link, b, wanted, areas=areas, read=r.fetch)
        found.given |= {k for k, answer in judged.answers.items() if isinstance(answer, Present)}
        verdicts |= judged.verdicts
    return verdicts


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
        reads.keep_downloads(r.ctx, (r.link, r.b), list(metas.values()))
    if "files" in features:
        # Files only a module or a page shows (the files area hidden): on their own, side by
        # side, now and then.
        # Not one an announcement carries, nor one last seen only as an attachment that only an
        # announcement links: the announcements tell of it (M09 §4.6, "公告附件").
        elsewhere = r.found.linked_elsewhere()
        wanted = [
            ("file", f)
            for f in r.found.file_ids
            if f not in metas
            and f not in r.found.attachments
            and not (_attached_only(r.found, f) and f not in elsewhere)
        ]
        todo = [
            key[1]
            for key in await r.round.oldest_first(r.ctx, r.link, wanted)
            if not await r.resting(key)
        ]
        for file_id, answer in (await r.read_many("file", todo)).items():
            if isinstance(answer, Present):
                metas[file_id] = answer.data
                reads.keep_downloads(r.ctx, (r.link, r.b), [answer.data])
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
    if (front := await _front_page(r)) is not None:
        done.add(front)
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
            answer = answers.get(slug)
            if isinstance(answer, Present):
                r.found.given.add(("page", slug))
                _page(r, slug, answer.data)
            elif not isinstance(answer, Gone):
                r.found.pages_short = True


async def _page_as_known(r: _Reader, slug: str) -> bool:
    """A page unchanged since it was last read (its version in the pages list the same), or
    refused for its closed area within a day: taken as it was, what it links to still holds.
    False when it is to be read (a page no list gives a version of is read every round)."""
    found = r.found
    title, version, _ = found.pages[slug]
    key = ("page", slug)
    mat = found.known.get(key)
    if not (found.unchanged(key, version) or (version is None and await r.closed_lately(key))):
        return False
    if mat is None:
        return True  # its area closed: not read again today
    for kind, target in mat.links:
        found.linked(kind, target, ("page", slug))
    if mat.state == "list":
        found.add(Material("page", slug, title, version or "", is_list=True, links=mat.links))
    return True


async def _front_page(r: _Reader) -> str | None:
    """The course's front page found by the way to it (M09 §4.6, table 2 row 21), when the pages
    list was not read whole (read whole, it lists the front page, and the way to it is not
    recorded): a page no list gives a version of, read within the budget and first of the
    round's pages; got, it is that page's single read of this round. Its slug, or None (none
    set, not read, or not needed)."""
    course_id = r.link.course_id
    if r.round.areas.get("pages") == "whole":
        r.round.drop("front_page")
        return None
    if not r.round.spend(["front_page"]):
        return None

    async def read() -> PageDetail | None:
        try:
            return await reads.page(
                r.ctx, course_id, FRONT_PAGE_REF, refresh=True, linked=(r.link, r.b)
            )
        except AppError as exc:
            if exc.code == "lms.not_found":
                return None  # the platform says there is none: no starting point
            raise

    detail = await r.round.area(r.ctx, r.link, r.b, "front_page", read)
    if detail is None:
        return None
    slug = detail.ref
    r.round.read_another_way(r.ctx, "page", slug)
    r.found.pages[slug] = (detail.title, None, detail.web_url)
    r.found.front.add(slug)
    r.found.given.add(("page", slug))
    _page(r, slug, detail)
    return slug


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
    links = _links(r, shape.links, ("page", slug))
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


def _links(
    r: _Reader, urls: Sequence[str], source: Key, *, known_only: bool = False
) -> list[list[str]]:
    """The course's files and pages among `urls` (a text's links), each brought in as linked
    from `source`: as `[kind, external id]` pairs, once each. `known_only`: a way in turned off
    in the settings (M09 §4.6): it brings in nothing new, only keeps linking what it brought."""
    out: list[list[str]] = []
    for url in urls:
        target = r.b.rewrite(url, r.link.external_course_id)
        if target is None or target.kind not in ("file", "page"):
            continue
        if known_only and (target.kind, target.ref) not in r.found.known:
            continue
        if source == ("page", target.ref) and target.kind == "page":
            continue  # a page linking to itself
        pair = [target.kind, target.ref]
        if pair not in out:
            out.append(pair)
            r.found.linked(target.kind, target.ref, source)
    return out


async def _syllabus(r: _Reader) -> None:
    """The course's syllabus (M09 table 2 row 22, table 4d row 5): read with the lists, the one
    item of its area. Kept as a document of its own when it has text of its own (else, like a
    page, only what it links to comes in); none when it is empty."""
    text = await r.round.area(
        r.ctx,
        r.link,
        r.b,
        SYLLABUS_AREA,
        lambda: reads.syllabus(r.ctx, r.link.course_id, refresh=True, linked=(r.link, r.b)),
        lambda _: False,
    )
    if not isinstance(text, RichText) or not (text.html or "").strip():
        return
    html = text.html or ""
    found = r.found
    found.listed.add(SYLLABUS)
    found.given.add(SYLLABUS)
    shape = page_shape(html)
    links = _links(r, shape.links, SYLLABUS)
    title = found.names["syllabus"]
    version = hashlib.sha256(html.encode()).hexdigest()[:32]
    found.add(
        Material(
            "syllabus",
            SYLLABUS_ID,
            title,
            version,
            size=len(html.encode()),
            mime="text/html",
            web_url=text.web_url,
            is_list=shape.is_list,
            links=links,
        )
    )


async def _entries(r: _Reader) -> None:
    """The texts the stages before this one kept (M09 table 4d, rows 6-8): what they link to of
    the course comes in. No request: their last reads, as the mirrors hold them."""
    link_id = r.link.id
    texts: dict[str, list[str | None]] = {
        "assignments": [
            (row.get("html") if isinstance(row, dict) else None)
            for row in await r.ctx.db.scalars(
                select(LmsAssignment.assignment).where(LmsAssignment.link_id == link_id)
            )
        ],
        "announcements": list(
            await r.ctx.db.scalars(
                select(LmsAnnouncement.html).where(LmsAnnouncement.link_id == link_id)
            )
        ),
        "calendar": list(
            await r.ctx.db.scalars(
                select(LmsCalendarEvent.html).where(LmsCalendarEvent.link_id == link_id)
            )
        ),
    }
    off = {"calendar": not r.found.cfg.calendar_links}
    for name in ENTRIES:
        for html in texts[name]:
            if html:
                _links(r, page_shape(html).links, ("entry", name), known_only=off.get(name, False))
    # The files attached to the announcements (table 4d row 7): turned off, only those that came
    # in already keep coming.
    for row in await r.ctx.db.scalars(
        select(LmsAnnouncement).where(LmsAnnouncement.link_id == link_id)
    ):
        for meta in announcements.attachment_files(row):
            key = ("file", meta.external_id)
            if r.found.cfg.announcement_attachments or key in r.found.known:
                r.found.attachments.setdefault(meta.external_id, meta)
                r.found.linked_from.append((ANNOUNCEMENTS, key))


def _attachments(r: _Reader) -> None:
    """The announcements' attachments no list showed come in from what the mirror holds (table
    4d row 7): no read of their own. Whether each was seen only that way, when this round read
    every way in whole (`_saw_everything`)."""
    found = r.found
    whole = r.round.areas.get(announcements.AREA) == "whole"
    for file_id, meta in found.attachments.items():
        key = ("file", file_id)
        if key in found.materials or key in found.locked:
            continue  # a list or a read of its own gave it
        version = file_version(meta)
        if meta.content_at is None and meta.updated_at is None:
            # Kept before the mirror held when it changed: taken as it was, not read again.
            version = _known_version(found, key) or version
        found.add(
            Material(
                "file",
                file_id,
                meta.name,
                version=version,
                size=meta.size_bytes or 0,
                mime=meta.mime_type,
                modified_at=meta.content_at or meta.updated_at,
            )
        )
        if whole:
            found.given.add(key)
    if not _saw_everything(r):
        return
    elsewhere = found.linked_elsewhere()
    for (kind, external_id), m in found.materials.items():
        m.attached = (
            kind == "file"
            and external_id in found.attachments
            and (kind, external_id) not in found.listed
            and external_id not in elsewhere
        )


def _attached_only(found: Found, file_id: str) -> bool:
    mat = found.known.get(("file", file_id))
    return mat is not None and mat.attached


def _known_version(found: Found, key: Key) -> str | None:
    mat = found.known.get(key)
    if mat is None:
        return None
    if mat.state == "synced":
        row = found.items.get(mat.item_id or "")
        return row.source_version if row is not None else None
    return mat.version


_READ_IN_FULL = ("whole", "hidden", "unsupported")


def _saw_everything(r: _Reader) -> bool:
    """Every way in of table 4d read in full this round (M09 §4.6, "只作为附件出现的"): the
    areas, the front page (in the whole pages list, else by its way in), this round's stages that
    kept the texts (a way in turned off not counted), every page that was to be read. Else one
    of them may list or link a file this round did not see."""
    areas = r.round.areas
    parts = [*AREAS, SYLLABUS_AREA, "assignments", announcements.AREA]
    if r.found.cfg.calendar_links:
        parts.append("calendar")
    if any(areas.get(a) not in _READ_IN_FULL for a in parts):
        return False
    if areas.get("pages") != "whole" and areas.get("front_page") != "whole":
        return False
    return not r.found.pages_short


# --- places ---------------------------------------------------------------------------------


_TOP: Key = ("top", "")


def _place(found: Found) -> None:
    """Each item's place on the platform (see the module docstring): its module, else its
    folder in the files area, else the place of the page that first links to it plus that page's
    title (a page with such items goes in that folder too), else the top level when the front
    page or the syllabus links to it, else the folder of the kept text that links to it."""
    parent: dict[Key, Key] = {}

    def ancestors(slug: str) -> set[str]:
        seen: set[str] = set()
        while slug not in seen:
            seen.add(slug)
            up = parent.get(("page", slug))
            if up is None or up[0] != "page":
                break
            slug = up[1]
        return seen

    def rank(source: Key) -> int:
        if source[0] == "page":
            return 1 if source[1] in found.front else 0
        if source == SYLLABUS:
            return 1
        return 2 + ENTRIES.index(source[1])

    for source, key in sorted(found.linked_from, key=lambda pair: rank(pair[0])):
        if key in parent or key in found.placed:
            continue
        if rank(source) == 1:
            parent[key] = _TOP
            continue
        if source[0] == "page" and key[0] == "page" and key[1] in ancestors(source[1]):
            continue  # pages linking to each other
        parent[key] = source
    holders = {
        source[1]
        for key, source in parent.items()
        if source[0] == "page" and key in found.materials and not found.materials[key].is_list
    }
    memo: dict[Key, tuple[list[Segment], bool]] = {}

    def own(key: Key, seen: frozenset[Key]) -> tuple[list[Segment], bool]:
        """Where the item's folder is (the place of its parent page's folder), and whether that
        is a place on the platform (not only where a way in that is no place put it)."""
        if key in memo:
            return memo[key]
        m = found.materials.get(key)
        module = found.placed.get(key) or (m.module if m is not None else None)
        source = parent.get(key)
        out: tuple[list[Segment], bool]
        if module:
            out = [module], True
        elif m is not None and m.folder_path:
            out = _folder_place(m.folder_path, m.folder_ids), True
        elif source == _TOP:
            out = [], False
        elif source is not None and source[0] == "entry":
            # In the folder named after the way in, or at the top (`entry_folders` off).
            folder = [(f"entry:{source[1]}", found.names[source[1]])]
            out = (folder if found.cfg.entry_folders else []), False
        elif source is not None and source[0] == "page" and source not in seen:
            title = found.pages.get(source[1], (source[1],))[0]
            above, located = own(source, seen | {key})
            out = [*above, (f"page:{source[1]}", title)], located
        else:
            out = [], True  # listed at the top of its area
        memo[key] = out
        return out

    for key, material in found.materials.items():
        path, located = own(key, frozenset())
        if key[0] == "page" and key[1] in holders and not material.is_list:
            path = [*path, (f"page:{key[1]}", material.title)]
        material.start = path
        material.path = path if located else None


def _folder_place(folder_path: str, ids: list[str]) -> list[Segment]:
    """A files-area folder's levels, by the platform's folder ids (by the path's names when the
    provider gives none)."""
    names = folder_path.split("/")
    if len(ids) != len(names):
        ids = ["/".join(names[: i + 1]) for i in range(len(names))]
    return [(f"folder:{i}", n) for i, n in zip(ids, names, strict=True) if n]
