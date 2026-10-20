"""What the model is given for an attachment of a user message (M12 实现说明, Sem 重构 PR 2b).

Every attachment starts with a manifest line, `<attachment id name type pages chars>`, then:
- a small document: its whole text, page by page;
- a large one: the first pages and its outline, and how to read on (`attachments.read`);
- scanned pages (no text layer): page images when the model can see images, else a note;
- an image: the image itself when the model can see images, else a note;
- a calendar: a summary of what it holds, not its text (the importer reads it);
- a file the parser could not read: why, and what to do instead.

This runs on every request of a conversation, so the result depends only on the stored rows
and the model's abilities: the same attachment renders the same way each time (prompt cache).
"""

import re
from collections import OrderedDict
from datetime import date
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import anyio.to_thread
from pydantic_ai.messages import BinaryContent, UserContent
from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules.academics.models import AcademicsProgram
from semestra.modules.agent import attachments, service
from semestra.modules.agent.models import AgentAttachment, AgentAttachmentPage, AgentSession
from semestra.modules.ai import wrap_untrusted
from semestra.modules.files.parse import PageRenderer

# About 6k tokens: documents up to this size are given whole.
FULL_TEXT_CHARS = 24_000
PREVIEW_PAGES = 2
OUTLINE_MAX = 60
# Scanned pages sent as images, per attachment; images are costly and slow to send.
SCANNED_IMAGES_MAX = 5
_CACHE_MAX = 32
# Rendered page images by (attachment id, page): every request of a turn sends them again.
_images: OrderedDict[tuple[str, int], bytes] = OrderedDict()

_UNREADABLE = {
    "files.encrypted_pdf": "it is a password-protected PDF",
    "files.too_many_pages": "it has too many pages",
    "files.too_complex": "it is too large or complex to read",
    "files.unsupported_type": "its format is not supported",
    "agent.attachment_not_read": "it was uploaded before attachments were read",
}
NO_VISION = (
    "The current model cannot see images. Tell the user, and suggest a model that accepts "
    "images or describing what it shows."
)


def _attr(value: object) -> str:
    return re.sub(r'["<>\n]', " ", str(value))[:200]


def manifest(att: AgentAttachment, *, chars: int | None = None) -> str:
    parts = [f'id="{att.id}"', f'name="{_attr(att.name)}"', f'type="{att.doc_kind or att.kind}"']
    if att.page_count is not None and att.doc_kind != "ics":
        parts.append(f'pages="{att.page_count}"')
    if chars is not None:
        parts.append(f'chars="{chars}"')
    return f"<attachment {' '.join(parts)}>"


async def render(
    ctx: Ctx, att: AgentAttachment, *, vision: bool, reads_pdf: bool
) -> list[UserContent]:
    # `reads_pdf` is not needed: PDFs are given as text and page images, which every provider
    # takes, rather than as a document block.
    del reads_pdf
    if att.doc_kind == "image" or (att.doc_kind is None and att.kind == "image"):
        if not vision:
            return [f"{manifest(att)}\n{NO_VISION}"]
        data = await service.read_attachment(ctx, att)
        return [manifest(att), BinaryContent(data=data, media_type=att.mime)]
    if att.doc_kind == "ics":
        return [f"{manifest(att)}\n{await _calendar_summary(ctx, att)}"]
    if att.doc_kind is None or att.parse_error:
        return [f"{manifest(att)}\n{_unreadable(att.parse_error or 'agent.attachment_not_read')}"]
    rows = await attachments.pages(ctx, att.id)
    chars = sum(len(r.markdown) for r in rows)
    head = manifest(att, chars=chars)
    if chars <= FULL_TEXT_CHARS:
        shown, rest = rows, []
    else:
        shown, rest = rows[:PREVIEW_PAGES], rows[PREVIEW_PAGES:]
    text = "\n\n".join(_page_text(r) for r in shown)
    content: list[UserContent] = [f"{head}\n{wrap_untrusted(text, att.name)}"]
    if rest:
        content.append(_outline_and_hint(att, rows))
    content += await _scanned(ctx, att, shown, vision=vision)
    return content


def _page_text(row: AgentAttachmentPage) -> str:
    body = row.markdown[: attachments.PAGE_MAX_CHARS].strip()
    if row.needs_ocr and not body:
        body = "[scanned page without a text layer]"
    return f"--- page {row.page_no} ---\n{body}"


def _outline_and_hint(att: AgentAttachment, rows: list[AgentAttachmentPage]) -> str:
    entries = attachments.outline(rows)
    lines = [
        f"{'  ' * (level - 1)}- {_attr(title)[:120]} (p. {page})"
        for level, page, title in entries[:OUTLINE_MAX]
    ]
    if len(entries) > OUTLINE_MAX:
        lines.append(f"- … {len(entries) - OUTLINE_MAX} more headings")
    outline = "Outline:\n" + "\n".join(lines) if lines else "The document has no headings."
    return (
        f"Only pages 1-{PREVIEW_PAGES} of {att.page_count} are shown. {outline}\n"
        f"Read other pages with attachments.read (attachment_id {att.id}, page_from) when the "
        "question needs them."
    )


async def _scanned(
    ctx: Ctx, att: AgentAttachment, shown: list[AgentAttachmentPage], *, vision: bool
) -> list[UserContent]:
    scanned = [r.page_no for r in shown if r.needs_ocr]
    if not scanned:
        return []
    if not vision or att.doc_kind != "pdf":
        return [
            f"Pages {', '.join(map(str, scanned))} of {_attr(att.name)} are scanned images "
            f"without text. {NO_VISION if not vision else ''}".strip()
        ]
    pages = scanned[:SCANNED_IMAGES_MAX]
    out: list[UserContent] = []
    for page_no, png in zip(pages, await _page_images(ctx, att, pages), strict=True):
        out += [
            f"Page {page_no} of {_attr(att.name)} (scanned):",
            BinaryContent(data=png, media_type="image/png"),
        ]
    if len(scanned) > len(pages):
        out.append(
            f"Pages {', '.join(map(str, scanned[len(pages) :]))} are scanned too and not shown."
        )
    return out


async def _page_images(ctx: Ctx, att: AgentAttachment, pages: list[int]) -> list[bytes]:
    missing = [p for p in pages if (att.id, p) not in _images]
    if missing:
        data = await service.read_attachment(ctx, att)

        def _render() -> list[bytes]:
            renderer = PageRenderer(data, pdf=True)
            try:
                return [renderer.ocr_image(p - 1) for p in missing]
            finally:
                renderer.close()

        for page_no, png in zip(missing, await anyio.to_thread.run_sync(_render), strict=True):
            _images[(att.id, page_no)] = png
    out = []
    for p in pages:
        _images.move_to_end((att.id, p))
        out.append(_images[(att.id, p)])
    while len(_images) > _CACHE_MAX:
        _images.popitem(last=False)
    return out


def _unreadable(code: str) -> str:
    why = _UNREADABLE.get(code, "the file could not be read")
    return (
        f"This file could not be read: {why}. Tell the user, and ask them to paste the part "
        "they need as text or send it in another format (a text-based PDF, DOCX or a "
        "screenshot)."
    )


async def _calendar_summary(ctx: Ctx, att: AgentAttachment) -> str:
    from semestra.modules.imports.ics import parse_ics

    data = await service.read_attachment(ctx, att)
    try:
        result = parse_ics(data, await _timezone(ctx, att))
    except AppError:
        return _unreadable("files.parse_failed")
    days: list[date] = []
    meetings = events = 0
    for course in result.courses:
        meetings += len(course.meetings)
        events += len(course.events)
        days += [m.first_date for m in course.meetings]
        days += [m.last_date for m in course.meetings if m.last_date]
        days += [e.day for e in course.events]
    days += [e.day for e in result.events]
    codes = [c.code for c in result.courses if c.code]
    lines = [
        "Calendar file (its text is not shown).",
        f"- Courses: {', '.join(codes[:40]) or 'none recognized'}"
        + (f" and {len(codes) - 40} more" if len(codes) > 40 else ""),
        f"- Weekly meetings: {meetings}; single events: {events + len(result.events)}",
    ]
    if days:
        lines.append(f"- Dates: {min(days)} to {max(days)}")
    lines.append(
        f"To import its classes, pass attachment id {att.id} to imports.session.create with "
        "source_kind ics."
    )
    return "\n".join(lines)


async def _timezone(ctx: Ctx, att: AgentAttachment) -> str:
    """The conversation's Program's time zone: the meetings' weekdays and dates depend on it."""
    tz = await ctx.db.scalar(
        select(AcademicsProgram.timezone)
        .join(AgentSession, AgentSession.program_id == AcademicsProgram.id)
        .where(AgentSession.id == att.session_id, AcademicsProgram.user_id == ctx.user_id)
    )
    try:
        return str(ZoneInfo(tz)) if tz else "UTC"
    except ZoneInfoNotFoundError, ValueError:
        return "UTC"
