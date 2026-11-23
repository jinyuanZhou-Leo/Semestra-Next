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
from typing import Literal, cast

from semestra.modules.lms.models import LmsMaterial, MaterialChange, MaterialState
from semestra.modules.lms.schemas.dto import FileMeta

MaterialKind = Literal["file", "page", "link"]


def file_version(meta: FileMeta) -> str:
    changed = meta.content_at or meta.updated_at
    return f"{changed.isoformat() if changed else ''}|{meta.size_bytes or 0}"


# --- states (table 4a) ----------------------------------------------------------------------

MaterialEvent = Literal[
    "appeared",  # on the platform this round (listed or read on its own), with a body
    "list",  # on the platform, a page that only lists other things
    "gone",  # gone from the platform (table 3c)
    "deleted",  # the user deleted its item in the course files
    "saved",  # the user saved the platform's file in the course files
    "restored",  # the user restored one they deleted
    "released",  # its sync turned off, the user removed what it left
    "removed",  # the user removed it under "Not syncing for now"
    "unlinked",  # the course unlinked
]

# What each event does in each state (table 4a): the state it moves to, or KEEP. A pair left out
# cannot happen: `enter` refuses it (`Impossible`), and the sync skips that material (table 5b).
KEEP = "keep"
NEXT: dict[tuple[MaterialState | None, MaterialEvent], MaterialState | Literal["keep"]] = {
    (None, "appeared"): "synced",
    (None, "list"): "list",
    (None, "saved"): "synced",
    ("synced", "appeared"): KEEP,
    ("synced", "list"): "list",
    ("synced", "gone"): "absent",
    ("synced", "deleted"): "dismissed",
    ("synced", "saved"): KEEP,
    ("synced", "released"): "absent",
    ("synced", "removed"): "dismissed",
    ("synced", "unlinked"): "absent",
    ("list", "appeared"): "synced",
    ("list", "list"): KEEP,
    ("list", "gone"): "absent",
    ("dismissed", "appeared"): KEEP,
    ("dismissed", "list"): KEEP,
    ("dismissed", "gone"): KEEP,
    ("dismissed", "saved"): "synced",
    ("dismissed", "restored"): "absent",
    # Restored, then gone from the platform before it came in: told, no longer quiet. Else kept.
    ("absent", "gone"): "absent",
    ("absent", "appeared"): "synced",
    ("absent", "list"): "list",
    ("absent", "saved"): "synced",
}


class Impossible(RuntimeError):
    """An event table 4a says cannot happen in the material's state."""


def _forget_applied(mat: LmsMaterial) -> None:
    """Clears what was applied from the platform, so it is read whole when it comes in (its
    title stays: the status panel names what went by it)."""
    mat.version = mat.name = mat.placed_folder_id = None
    mat.links = []


def enter(
    mat: LmsMaterial,
    event: MaterialEvent,
    now: datetime,
    *,
    item_id: str | None = None,
) -> bool:
    """Applies one event of table 4a to the material (a row just made is `None`); whether its
    state changed. What each state holds:

    - `synced`: its item `item_id`, nothing applied yet (the caller applies what it read);
    - `list`: no item, nothing applied yet;
    - `dismissed`: no item; what was read stays (what the page links to still comes in), but
      its version (it was the item's, M09 §4.6: read again once);
    - `absent`: nothing applied; `item_id` the user's own file it left, if any (never
      followed); `quiet` when the user restored it."""
    before = cast(MaterialState | None, mat.state)
    if (before, event) not in NEXT:
        raise Impossible(f"lms material {mat.id}: {before} on {event}")
    state = NEXT[before, event]
    if state == KEEP:
        return False
    if before == "absent" and event == "gone":  # what it left (`item_id`) stays the user's
        if not mat.quiet:
            return False
        mat.quiet, mat.state_at = False, now
        return True
    if state == "synced" and item_id is None:
        raise Impossible(f"lms material {mat.id}: synced without an item")
    mat.state, mat.state_at, mat.quiet = state, now, event == "restored"
    mat.item_id = item_id
    if state == "synced":
        mat.imported_at = now
        mat.change = mat.changed_at = None
    if state != "dismissed":
        _forget_applied(mat)
    else:
        mat.version = None
    return True


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
