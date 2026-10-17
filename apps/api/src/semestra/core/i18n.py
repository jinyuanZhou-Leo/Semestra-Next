"""Email rendering (M00 §3.11). The backend renders no UI text, emails are the one exception.

Templates live in `modules/<module>/templates/<locale>/<name>.txt`. The first line is
`Subject: ...`, a blank line follows, then the plain-text body. `$name` placeholders are
substituted (`string.Template`); an HTML alternative is derived from the text.
"""

import html
import re
from dataclasses import dataclass
from pathlib import Path
from string import Template
from typing import Any

from semestra.core.context import DEFAULT_LOCALE, SUPPORTED_LOCALES

_MODULES_DIR = Path(__file__).resolve().parent.parent / "modules"
_URL = re.compile(r"(https?://\S+)")


@dataclass(frozen=True)
class RenderedEmail:
    subject: str
    text: str
    html: str


def _find_template(name: str, locale: str) -> Path:
    for loc in (locale, DEFAULT_LOCALE):
        if loc not in SUPPORTED_LOCALES:
            continue
        for path in sorted(_MODULES_DIR.glob(f"*/templates/{loc}/{name}.txt")):
            return path
    raise FileNotFoundError(f"email template {name!r} not found")


def _to_html(text: str) -> str:
    paragraphs: list[str] = []
    for block in text.strip().split("\n\n"):
        safe = html.escape(block).replace("\n", "<br>")
        safe = _URL.sub(r'<a href="\1">\1</a>', safe)
        paragraphs.append(f'<p style="margin:0 0 16px">{safe}</p>')
    body = "".join(paragraphs)
    return (
        '<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;'
        f'font-size:15px;line-height:1.6;color:#222">{body}</div>'
    )


def render_email(template: str, locale: str, params: dict[str, Any]) -> RenderedEmail:
    raw = _find_template(template, locale).read_text(encoding="utf-8")
    header, _, body = raw.partition("\n\n")
    subject = header.removeprefix("Subject:").strip()
    values = {k: str(v) for k, v in params.items()}
    text = Template(body).safe_substitute(values).strip()
    return RenderedEmail(Template(subject).safe_substitute(values), text, _to_html(text))
