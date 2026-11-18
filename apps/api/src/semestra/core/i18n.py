"""Email rendering (M00 §3.11). The backend renders no UI text, emails are the one exception.

Templates live in `modules/<module>/templates/<locale>/<name>.txt`:

    Subject: ...
    Title: ...
    Button: ...          (optional, the label for a block that is only a `$..._url`)

    Paragraphs separated by blank lines. A block that is only `$code` becomes the code box,
    one that is only a `$..._url` placeholder becomes the button. Elsewhere a `$..._url`
    placeholder becomes a link; no other value is ever linked.
    ---
    Small print under the divider (optional).

`$name` placeholders are substituted (`string.Template`). The plain-text part keeps the same
words; the HTML part uses the shared layout in `email_layout.py`.
"""

import re
from dataclasses import dataclass
from pathlib import Path
from string import Template
from typing import Any

from semestra.core.context import DEFAULT_LOCALE, SUPPORTED_LOCALES
from semestra.core.email_layout import Block, Button, Code, Link, Paragraph, render_html

_MODULES_DIR = Path(__file__).resolve().parent.parent / "modules"
_URL_PLACEHOLDER = re.compile(r"(\$\w+_url)")
_FOOTER = {
    "en": "This is an automated message from Semestra.",
    "zh-CN": "此邮件由 Semestra 自动发送。",
}


@dataclass(frozen=True)
class RenderedEmail:
    subject: str
    text: str
    html: str


def _find_template(name: str, locale: str) -> tuple[Path, str]:
    for loc in (locale, DEFAULT_LOCALE):
        if loc not in SUPPORTED_LOCALES:
            continue
        for path in sorted(_MODULES_DIR.glob(f"*/templates/{loc}/{name}.txt")):
            return path, loc
    raise FileNotFoundError(f"email template {name!r} not found")


def _blocks(text: str) -> list[str]:
    return [b.strip() for b in text.strip().split("\n\n") if b.strip()]


def render_email(
    template: str, locale: str, params: dict[str, Any], *, web_origin: str
) -> RenderedEmail:
    path, loc = _find_template(template, locale)
    header, _, body = path.read_text(encoding="utf-8").partition("\n\n")
    meta = dict(line.split(":", 1) for line in header.splitlines())
    values = {k: str(v) for k, v in params.items()}

    def fill(s: str) -> str:
        return Template(s).safe_substitute(values)

    def paragraph(raw: str) -> Paragraph:
        # Only `$..._url` placeholders become links; every other value stays plain text.
        return tuple(
            Link(fill(part)) if _URL_PLACEHOLDER.fullmatch(part) else fill(part)
            for part in _URL_PLACEHOLDER.split(raw)
            if part
        )

    def plain(p: Paragraph) -> str:
        return "".join(part.url if isinstance(part, Link) else part for part in p)

    title = fill(meta["Title"].strip())
    main, _, small_print = body.partition("\n---\n")
    blocks: list[Block] = []
    texts = [title]
    for raw in _blocks(main):
        if raw == "$code":
            blocks.append(Code(fill(raw)))
            texts.append(fill(raw))
        elif _URL_PLACEHOLDER.fullmatch(raw):
            blocks.append(Button(fill(meta["Button"].strip()), fill(raw)))
            texts.append(fill(raw))
        else:
            p = paragraph(raw)
            blocks.append(p)
            texts.append(plain(p))
    notes = [paragraph(n) for n in _blocks(small_print)]
    texts += [plain(n) for n in notes]
    html = render_html(
        lang=loc,
        title=title,
        body=blocks,
        notes=notes,
        footer=_FOOTER.get(loc, _FOOTER[DEFAULT_LOCALE]),
        # Mail clients block images over plain http, and a local origin is unreachable anyway.
        logo_url=f"{web_origin}/icons/icon-192.png" if web_origin.startswith("https://") else None,
    )
    return RenderedEmail(fill(meta["Subject"].strip()), "\n\n".join(texts), html)
