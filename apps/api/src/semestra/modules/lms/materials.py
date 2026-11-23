"""The course materials (M09 §4.2): what an item of the platform is called in the course files,
the one function that changes a material's state (table 4a), and which pages only list other
things.

The type of each material and its folder are M07's (`files.sorting`). The stage that brings
them in is `sync_files.py` (reading the platform: `material_reads.py`); what the course files
ask of them is `material_items.py`.
"""

import re
from dataclasses import dataclass
from datetime import datetime
from html.parser import HTMLParser
from typing import Literal

from semestra.modules.lms.models import LmsMaterial, MaterialChange, MaterialState
from semestra.modules.lms.schemas.dto import FileMeta

MaterialKind = Literal["file", "page", "link"]


def source_ref(kind: MaterialKind, external_id: str) -> str:
    return f"lms:{kind}:{external_id}"


def file_version(meta: FileMeta) -> str:
    changed = meta.content_at or meta.updated_at
    return f"{changed.isoformat() if changed else ''}|{meta.size_bytes or 0}"


# --- states (table 4a) ----------------------------------------------------------------------

# The states each state may go to; `None` is a row just made. Any other change is a bug.
NEXT: dict[str | None, frozenset[MaterialState]] = {
    None: frozenset({"synced", "list"}),
    # Followed (again, from a file saved anew); a page become a list; deleted by the user; gone
    # from the platform, or handed over by the user while it could not be read.
    "synced": frozenset({"synced", "list", "dismissed", "absent"}),
    "list": frozenset({"synced", "absent"}),
    # Restored by the user; saved in Semestra from the platform's own view.
    "dismissed": frozenset({"absent", "synced"}),
    # Back on the platform; a restored one gone from it meanwhile (told, no longer quiet).
    "absent": frozenset({"synced", "list", "absent"}),
}


def _forget_applied(mat: LmsMaterial) -> None:
    """Clears what was applied from the platform, so it is read whole when it comes in (its
    title stays: the status panel names what went by it)."""
    mat.version = mat.name = mat.placed_folder_id = None
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


def note(mat: LmsMaterial, change: MaterialChange, now: datetime) -> None:
    """What happened to the material, for the status panel's recent updates."""
    mat.change, mat.changed_at = change, now


# --- pages ----------------------------------------------------------------------------------

# A page whose own text (links left out) is shorter than this lists other things: it is not
# kept as a document, only read for what it lists.
LIST_TEXT_MAX = 160


class _PageText(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.links: list[str] = []
        self.own: list[str] = []
        self._in_link = 0
        self._skip = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "a":
            self._in_link += 1
            href = dict(attrs).get("href")
            if href:
                self.links.append(href)
        elif tag in ("script", "style"):
            self._skip += 1

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._in_link:
            self._in_link -= 1
        elif tag in ("script", "style") and self._skip:
            self._skip -= 1

    def handle_data(self, data: str) -> None:
        if not self._in_link and not self._skip:
            self.own.append(data)


@dataclass(frozen=True)
class PageShape:
    links: list[str]
    # Little text of its own besides its links (a table of contents), or nothing at all: not
    # kept as a document.
    is_list: bool


def page_shape(html: str | None) -> PageShape:
    parser = _PageText()
    parser.feed(html or "")
    parser.close()
    own = re.sub(r"\s+", " ", "".join(parser.own)).strip()
    is_list = not own or (bool(parser.links) and len(own) < LIST_TEXT_MAX)
    return PageShape(links=parser.links, is_list=is_list)
