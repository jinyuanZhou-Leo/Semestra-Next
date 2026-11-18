"""Email rendering (M00 §3.11). The backend renders no UI text, emails are the one exception.

Templates live in `modules/<module>/templates/<locale>/<name>.txt`:

    Subject: ...
    Title: ...
    Button: ...          (optional, the label for a block that is only a `$..._url`)

    Paragraphs separated by blank lines. A block that is only `$code` becomes the code box,
    one that is only a `$..._url` placeholder becomes the button.
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
from semestra.core.email_layout import Block, Button, Code, render_html

_MODULES_DIR = Path(__file__).resolve().parent.parent / "modules"
_URL_PLACEHOLDER = re.compile(r"\$\w+_url")
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
        return Template(s.strip()).safe_substitute(values)

    title = fill(meta["Title"])
    main, _, small_print = body.partition("\n---\n")
    blocks: list[Block] = []
    for raw in _blocks(main):
        if raw == "$code":
            blocks.append(Code(fill(raw)))
        elif _URL_PLACEHOLDER.fullmatch(raw):
            blocks.append(Button(fill(meta["Button"]), fill(raw)))
        else:
            blocks.append(fill(raw))
    notes = [fill(n) for n in _blocks(small_print)]
    texts = [
        title,
        *(
            b.value if isinstance(b, Code) else b.url if isinstance(b, Button) else b
            for b in blocks
        ),
        *notes,
    ]
    html = render_html(
        lang=loc,
        title=title,
        body=blocks,
        notes=notes,
        footer=_FOOTER.get(loc, _FOOTER[DEFAULT_LOCALE]),
        logo_url=f"{web_origin}/icons/icon-192.png",
    )
    return RenderedEmail(fill(meta["Subject"]), "\n\n".join(texts), html)
