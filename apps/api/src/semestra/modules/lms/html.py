"""HTML from the LMS (pages, announcements, syllabi, descriptions), cleaned by the module so
every provider gets the same treatment (M09 §2.1).

Allowed: basic formatting, lists, tables, images and links, and inline styles limited to
`STYLE_PROPERTIES` (colors, type, spacing, borders, sizes; nothing that positions, layers, hides or
loads anything) so the Canvas tab can show content as it looks on the platform. Agents get the
text as Markdown (`markdown.py`), which drops the styles. Links open in a new tab with
`rel="noopener noreferrer"`; a platform link the provider recognizes also carries
`data-lms-kind` / `data-lms-ref` so the Canvas tab (M16) can open it in the app. An image of a
course file is marked the same way: its own address needs a platform session, so the Canvas tab
loads it through the file proxy instead.
"""

import html as htmllib
import re
from collections.abc import Callable

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
    "a": {"href", "title", "target", "data-lms-kind", "data-lms-ref"},
    "img": {"src", "alt", "title", "width", "height", "data-lms-kind", "data-lms-ref"},
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

_HREF = re.compile(r"""<(a)\b([^>]*?)\b(href)\s*=\s*("([^"]*)"|'([^']*)')""", re.I)
_SRC = re.compile(r"""<(img)\b([^>]*?)\b(src)\s*=\s*("([^"]*)"|'([^']*)')""", re.I)


def _mark_internal(raw: str, rewrite: Rewriter) -> str:
    def repl(match: re.Match[str]) -> str:
        tag, before, attr, quoted = match.group(1, 2, 3, 4)
        url = htmllib.unescape(match.group(5) if match.group(5) is not None else match.group(6))
        ref = rewrite(url)
        if ref is None or (tag.lower() == "img" and ref.kind != "file"):
            return match.group(0)
        extra = f' data-lms-kind="{ref.kind}" data-lms-ref="{htmllib.escape(ref.ref)}"'
        return f"<{tag}{before}{extra} {attr}={quoted}"

    return _SRC.sub(repl, _HREF.sub(repl, raw))


def clean(raw: str | None, rewrite: Rewriter | None = None) -> str | None:
    if raw is None:
        return None
    if rewrite is not None:
        raw = _mark_internal(raw, rewrite)
    cleaned = nh3.clean(
        raw,
        tags=TAGS,
        attributes={"*": GENERIC_ATTRIBUTES, **ATTRIBUTES},
        filter_style_properties=STYLE_PROPERTIES,
        url_schemes=URL_SCHEMES,
        link_rel="noopener noreferrer",
        set_tag_attribute_values={"a": {"target": "_blank"}},
        strip_comments=True,
    )
    return cleaned.strip() or None


def to_text(raw: str | None) -> str | None:
    """Plain text of an HTML fragment (calendar descriptions shown as text)."""
    if raw is None:
        return None
    text = nh3.clean(re.sub(r"<(br|/p|/div|/li|/h\d)\b[^>]*>", "\n", raw, flags=re.I), tags=set())
    text = htmllib.unescape(text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n\n", text)
    return text.strip() or None
