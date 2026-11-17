"""Pages of a course on the platform (M09 §4.2): which ones only list other things.

The type of each material and its folder are M07's (`files.sorting`).
"""

import re
from dataclasses import dataclass
from html.parser import HTMLParser

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
