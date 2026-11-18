"""HTML layout shared by every email (M00 §3.11).

A card on a neutral background: logo, title, paragraphs, an optional code box or button, and
small print under a divider. Styles are inline for clients that drop `<style>`; the `<style>`
block only adds the dark palette for clients that honour `prefers-color-scheme`.
"""

import html
from dataclasses import dataclass

_BRAND = "#0069a8"
_FONT = (
    "-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB',"
    "'Microsoft YaHei',Helvetica,Arial,sans-serif"
)
_MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"
_DARK = """
:root{color-scheme:light dark;supported-color-schemes:light dark}
@media (prefers-color-scheme:dark){
.bg{background:#0b0b0c!important}
.card{background:#18181b!important;border-color:#27272a!important}
.title,.brand{color:#fafafa!important}
.text{color:#d4d4d8!important}
.muted{color:#a1a1aa!important}
.code{background:#27272a!important;color:#fafafa!important}
.rule{border-color:#27272a!important}
.button{background:#3b9ede!important}
.text a,.muted a{color:#7cc0ec!important}
}
"""


@dataclass(frozen=True)
class Link:
    url: str


# A paragraph is plain text with links only where the template put a `$..._url` placeholder:
# other values (a device name from the User-Agent, say) never become links.
type Paragraph = tuple[str | Link, ...]


@dataclass(frozen=True)
class Code:
    value: str


@dataclass(frozen=True)
class Button:
    label: str
    url: str


type Block = Paragraph | Code | Button


def _inline(paragraph: Paragraph) -> str:
    parts: list[str] = []
    for part in paragraph:
        if isinstance(part, Link):
            url = html.escape(part.url)
            parts.append(f'<a href="{url}" style="color:{_BRAND};word-break:break-all">{url}</a>')
        else:
            parts.append(html.escape(part).replace("\n", "<br>"))
    return "".join(parts)


def _paragraph(paragraph: Paragraph, cls: str, color: str, size: int, margin: int) -> str:
    return (
        f'<p class="{cls}" style="margin:0 0 {margin}px;font-size:{size}px;'
        f'line-height:1.6;color:{color}">{_inline(paragraph)}</p>'
    )


def _block(block: Block) -> str:
    match block:
        case Code(value):
            return (
                '<div class="code" style="margin:8px 0 16px;padding:20px 0;border-radius:12px;'
                f"background:#f4f4f5;text-align:center;font-family:{_MONO};font-size:32px;"
                f'font-weight:600;letter-spacing:8px;color:#18181b">{html.escape(value)}</div>'
            )
        case Button(label, url):
            # A table cell carries the background: classic Outlook ignores it on links.
            return (
                '<table role="presentation" cellpadding="0" cellspacing="0" '
                'style="margin:8px 0 24px"><tr>'
                f'<td class="button" bgcolor="{_BRAND}" style="border-radius:10px;'
                f'background:{_BRAND}"><a href="{html.escape(url)}" style="display:inline-block;'
                "padding:11px 20px;color:#ffffff;font-size:15px;font-weight:600;"
                f'text-decoration:none">{html.escape(label)}</a></td></tr></table>'
            )
        case _:
            return _paragraph(block, "text", "#3f3f46", 15, 16)


def render_html(
    *,
    lang: str,
    title: str,
    body: list[Block],
    notes: list[Paragraph],
    footer: str,
    logo_url: str | None,
) -> str:
    content = "".join(_block(b) for b in body)
    if notes:
        content += (
            '<hr class="rule" style="margin:8px 0 20px;border:0;border-top:1px solid #e4e4e7">'
        )
        content += "".join(_paragraph(n, "muted", "#71717a", 13, 8) for n in notes)
    table = 'role="presentation" cellpadding="0" cellspacing="0"'
    logo = (
        f'<td style="padding-right:10px"><img src="{html.escape(logo_url)}" width="32" '
        'height="32" alt="" style="display:block;border:0;border-radius:8px"></td>'
        if logo_url
        else ""
    )
    return (
        f'<!doctype html><html lang="{lang}"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<meta name="color-scheme" content="light dark">'
        '<meta name="supported-color-schemes" content="light dark">'
        f"<title>{html.escape(title)}</title><style>{_DARK}</style></head>"
        '<body class="bg" style="margin:0;padding:0;background:#f4f4f5">'
        f'<table {table} width="100%" class="bg" style="background:#f4f4f5;font-family:{_FONT}">'
        '<tr><td align="center" style="padding:40px 16px">'
        # Classic Outlook ignores max-width: a fixed-width ghost table holds the card there.
        f'<!--[if mso]><table {table} width="480"><tr><td><![endif]-->'
        f'<table {table} width="100%" style="max-width:480px">'
        '<tr><td class="card" style="background:#ffffff;border:1px solid #e4e4e7;'
        'border-radius:16px;padding:36px 36px 28px">'
        f'<table {table} style="margin-bottom:28px"><tr>'
        f"{logo}"
        '<td class="brand" style="font-size:17px;font-weight:600;'
        'color:#18181b">Semestra</td></tr></table>'
        '<h1 class="title" style="margin:0 0 12px;font-size:22px;line-height:1.35;'
        f'font-weight:600;color:#18181b">{html.escape(title)}</h1>'
        f"{content}</td></tr>"
        '<tr><td class="muted" style="padding:20px 8px 0;text-align:center;font-size:12px;'
        f'line-height:1.6;color:#a1a1aa">{html.escape(footer)}</td></tr>'
        "</table><!--[if mso]></td></tr></table><![endif]-->"
        "</td></tr></table></body></html>"
    )
