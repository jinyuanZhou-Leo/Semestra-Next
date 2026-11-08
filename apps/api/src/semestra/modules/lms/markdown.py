"""LMS HTML as Markdown for agents and MCP clients (`core.agent_output.ForAgents`): markup costs
the model tokens and buries the text. HTTP callers keep the cleaned HTML.

A platform link the provider recognized (`data-lms-kind` / `data-lms-ref`, see `html.py`) becomes
`[text](lms:<kind>:<ref>)`: `<kind>:<ref>` is the item's ref, which `lms.content.read` opens.
"""

from typing import Any

from markdownify import MarkdownConverter

# The kinds `lms.content.read` opens (`refs.KINDS`); a module link stays an ordinary address.
READABLE = frozenset(("page", "announcement", "assignment", "quiz", "discussion", "file"))


class _Converter(MarkdownConverter):
    def convert_a(self, el: Any, text: str, parent_tags: set[str]) -> str:
        kind, ref = el.get("data-lms-kind"), el.get("data-lms-ref")
        if kind in READABLE and ref:
            return f"[{text.strip() or ref}](lms:{kind}:{ref})"
        return super().convert_a(el, text, parent_tags)  # pyright: ignore[reportAttributeAccessIssue]


# No escaping: the model reads this text, it is not rendered, and `lab\_3.pdf` would be copied
# into searches and titles as is.
_converter = _Converter(
    heading_style="ATX",
    bullets="-",
    escape_asterisks=False,
    escape_underscores=False,
    escape_misc=False,
)


def to_markdown(html: str) -> str | None:
    return _converter.convert(html).strip() or None
