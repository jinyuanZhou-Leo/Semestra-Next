"""What the model is given for a course file picked with `@` in a user message.

Like an attachment (`attachment_context`): a small document whole, a large one by its first
pages and outline, with how to read on (`files.document.read`, revealed with the message). A file
whose text is not ready, or that went away, says so. The file's current text is given on every
request, so it follows the file when it is processed again.
"""

from pydantic_ai.messages import UserContent

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules.agent import tools
from semestra.modules.agent.attachment_context import FULL_TEXT_CHARS, OUTLINE_MAX, PREVIEW_PAGES
from semestra.modules.ai import wrap_untrusted
from semestra.modules.files import documents
from semestra.modules.files.schemas import MAX_READ_PAGES

READ = "files.document.read"
_STATUS = {
    "files.not_indexed": "It is stored but not indexed, so its text cannot be read. Tell the user "
    'they can index it with "Index" in the file list.',
    "files.not_ready": "Its text is not ready yet (still being processed, or that failed).",
    "files.unsupported_type": "It is a saved link, not a file.",
}


def _attr(value: object) -> str:
    return str(value).replace('"', " ").replace("<", " ").replace(">", " ").replace("\n", " ")[:200]


async def render(ctx: Ctx, item_id: str, label: str) -> list[UserContent]:
    head = f'[@"{_attr(label)}" in the message is the course file with id {item_id}]'
    try:
        outline = await documents.outline(ctx, item_id)
    except AppError as exc:
        reason = _STATUS.get(exc.code, "It is no longer available.")
        return [f"{head} {reason}"]
    pages = []
    page_from = 1
    chars = 0
    while page_from <= outline.page_count:
        read = await documents.read_document(ctx, item_id, page_from, None)
        pages += read.pages
        chars = sum(len(p.markdown) for p in pages)
        if read.next_page is None or chars > FULL_TEXT_CHARS:
            break
        page_from = read.next_page
    name = outline.display_name
    manifest = f'<file id="{item_id}" name="{_attr(name)}" pages="{outline.page_count}">'
    whole = chars <= FULL_TEXT_CHARS and len(pages) == outline.page_count
    shown = pages if whole else pages[:PREVIEW_PAGES]
    text = "\n\n".join(f"--- page {p.page_no} ---\n{p.markdown.strip()}" for p in shown)
    content: list[UserContent] = [f"{head}\n{manifest}\n{wrap_untrusted(text, name)}"]
    if whole:
        return content
    lines = [
        f"{'  ' * (e.level - 1)}- {e.title[:120]} (p. {e.page})"
        for e in outline.entries[:OUTLINE_MAX]
    ]
    if len(outline.entries) > OUTLINE_MAX:
        lines.append(f"- … {len(outline.entries) - OUTLINE_MAX} more headings")
    note = (
        f"Only pages 1-{len(shown)} of {outline.page_count} are shown. Read other pages with "
        f"{tools.tool_name(READ)} (item_id {item_id}, page_from; up to {MAX_READ_PAGES} pages a "
        f"call) when the question needs them."
    )
    if lines:
        note += "\nIts outline:\n" + wrap_untrusted("\n".join(lines), f"{name} (outline)")
    content.append(note)
    return content
