"""HTML from the LMS (pages, announcements, syllabi, descriptions), cleaned by the module so
every provider gets the same treatment (M09 §2.1).

Allowed: basic formatting, lists, tables, images and links, and inline styles limited to
`STYLE_PROPERTIES` (colors, type, spacing, borders, sizes; nothing that positions, layers, hides or
loads anything) so the Canvas tab can show content as it looks on the platform. Agents get the
text as Markdown (`markdown.py`), which drops the styles. Links open in a new tab with
`rel="noopener noreferrer"`. Every address is made absolute against the platform, since the app
would otherwise resolve a relative one against itself. A platform link the provider recognizes
also carries `data-lms-kind` / `data-lms-ref` so the Canvas tab (M16) can open it in the app. An
image of a course file is marked the same way: its own address needs a platform session, so the
Canvas tab loads it through the file proxy instead.
"""

import html as htmllib
import re
from collections.abc import Callable
from urllib.parse import urljoin

import nh3

from semestra.modules.lms.schemas.dto import InternalRef

TAGS = {
    "a", "abbr", "b", "blockquote", "br", "caption", "code", "col", "colgroup", "dd", "del",
    "details", "div", "dl", "dt", "em", "figcaption", "figure", "h1", "h2", "h3", "h4", "h5",
    "h6", "hr", "i", "img", "ins", "kbd", "li", "mark", "ol", "p", "pre", "s", "small", "span",
    "strong", "sub", "summary", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr",
    "u", "ul",
}  # fmt: skip
ATTRIBUTES = {
    "a": {"href", "title", "target"},
    "img": {"src", "alt", "title", "width", "height"},
    # The editor's own table grid (`border="1"`) and spacing, drawn by the "Canvas style" display.
    "table": {"border", "cellpadding", "cellspacing"},
    "td": {"colspan", "rowspan"},
    "th": {"colspan", "rowspan", "scope"},
    "col": {"span"},
    "colgroup": {"span"},
    "ol": {"start"},
}
# Every tag may keep `style`, filtered to these properties. `apps/web/src/components/SafeHtml.tsx`
# filters with the same list again in the browser.
GENERIC_ATTRIBUTES = {"style"}
STYLE_PROPERTIES = {
    "color", "background-color", "font-family", "font-size", "font-style", "font-weight",
    "font-variant", "line-height", "letter-spacing", "text-align", "text-decoration",
    "text-decoration-line", "text-decoration-color", "text-decoration-style", "text-indent",
    "text-transform", "vertical-align", "white-space", "word-break", "overflow-wrap",
    "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
    "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
    "border", "border-top", "border-right", "border-bottom", "border-left", "border-color",
    "border-style", "border-width", "border-radius", "border-collapse", "border-spacing",
    "width", "min-width", "max-width", "height", "min-height", "max-height",
    "float", "clear", "list-style-type", "list-style-position", "caption-side",
}  # fmt: skip
URL_SCHEMES = {"http", "https", "mailto"}

Rewriter = Callable[[str], InternalRef | None]

# A link or image in the cleaned output, which always double-quotes attribute values (so a `>`
# can only appear inside quotes).
_LINK = re.compile(r'<(a|img)((?:\s+[^\s=>"]+(?:="[^"]*")?)*?)\s+(href|src)="([^"]*)"', re.I)


def _resolve_links(cleaned: str, base: str, rewrite: Rewriter | None) -> str:
    """Makes every link and image address absolute against the platform (`base`), and marks the
    ones the provider recognizes. The HTML is shown inside the app, where a relative address
    (`cover.html`, `/courses/1/discussion_topics/2`) would point at the app instead."""

    def repl(match: re.Match[str]) -> str:
        tag, before, attr, value = match.group(1, 2, 3, 4)
        url = urljoin(base, htmllib.unescape(value).strip())
        ref = rewrite(url) if rewrite is not None else None
        extra = ""
        if ref is not None and (tag.lower() == "a" or ref.kind == "file"):
            kind, target = htmllib.escape(ref.kind), htmllib.escape(ref.ref)
            extra = f' data-lms-kind="{kind}" data-lms-ref="{target}"'
        return f'<{tag}{before}{extra} {attr}="{htmllib.escape(url)}"'

    return _LINK.sub(repl, cleaned)


def clean(raw: str | None, *, base: str, rewrite: Rewriter | None = None) -> str | None:
    """Sanitized HTML with absolute addresses; `base` is the item's own address on the platform
    (or the platform's root), the address relative links in it were written against."""
    if raw is None:
        return None
    cleaned = nh3.clean(
        raw,
        tags=TAGS,
        attributes={"*": GENERIC_ATTRIBUTES, **ATTRIBUTES},
        filter_style_properties=STYLE_PROPERTIES,
        url_schemes=URL_SCHEMES,
        link_rel="noopener noreferrer",
        set_tag_attribute_values={"a": {"target": "_blank"}},
        strip_comments=True,
    ).strip()
    return _resolve_links(cleaned, base, rewrite) if cleaned else None


def to_text(raw: str | None) -> str | None:
    """Plain text of an HTML fragment (calendar descriptions shown as text)."""
    if raw is None:
        return None
    text = nh3.clean(re.sub(r"<(br|/p|/div|/li|/h\d)\b[^>]*>", "\n", raw, flags=re.I), tags=set())
    text = htmllib.unescape(text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n\n", text)
    return text.strip() or None
