"""HTML from the LMS (pages, announcements, syllabi, descriptions), cleaned by the module so
every provider gets the same treatment (M09 §2.1).

Allowed: basic formatting, lists, tables, images and links. Links open in a new tab with
`rel="noopener noreferrer"`; a platform link the provider recognizes also carries
`data-lms-kind` / `data-lms-ref` so the Canvas tab (M16) can open it in the app.
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
    "img": {"src", "alt", "title", "width", "height"},
    "td": {"colspan", "rowspan"},
    "th": {"colspan", "rowspan", "scope"},
    "col": {"span"},
    "colgroup": {"span"},
    "ol": {"start"},
}
URL_SCHEMES = {"http", "https", "mailto"}

Rewriter = Callable[[str], InternalRef | None]

_HREF = re.compile(r"""<a\b([^>]*?)\bhref\s*=\s*("([^"]*)"|'([^']*)')""", re.I)


def _mark_internal(raw: str, rewrite: Rewriter) -> str:
    def repl(match: re.Match[str]) -> str:
        href = htmllib.unescape(match.group(3) if match.group(3) is not None else match.group(4))
        ref = rewrite(href)
        if ref is None:
            return match.group(0)
        extra = f' data-lms-kind="{ref.kind}" data-lms-ref="{htmllib.escape(ref.ref)}"'
        return f"<a{match.group(1)}{extra} href={match.group(2)}"

    return _HREF.sub(repl, raw)


def clean(raw: str | None, rewrite: Rewriter | None = None) -> str | None:
    if raw is None:
        return None
    if rewrite is not None:
        raw = _mark_internal(raw, rewrite)
    cleaned = nh3.clean(
        raw,
        tags=TAGS,
        attributes=ATTRIBUTES,
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
