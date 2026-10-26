"""What the model is given for an attachment of a user message (M12 实现说明, Sem 重构 PR 2b).

Every attachment starts with a manifest line, `<attachment id name type pages chars>`, then:
- a small document: its whole text, page by page;
- a large one: the first pages and its outline, and how to read on (`agent.attachment.read`);
- scanned pages (no text layer): page images when the model can see images, else a note;
- an image: the image itself when the model can see images, else a note;
- a calendar: what each course in it holds, in short; `agent.attachment.read` gives all of it, as
  Semestra's calendar reader (the importer's) understands it;
- a file the parser could not read: why, and what to do instead.

This runs on every request of a conversation, so the result depends only on the stored rows
and the model's abilities: the same attachment renders the same way each time (prompt cache).
"""

import re
from collections import OrderedDict
from dataclasses import dataclass
from datetime import date
from typing import TYPE_CHECKING
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import anyio.to_thread
import structlog
from pydantic_ai.messages import BinaryContent, UserContent
from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules.academics.models import AcademicsProgram
from semestra.modules.agent import attachments, service
from semestra.modules.agent.models import AgentAttachment, AgentAttachmentPage, AgentSession
from semestra.modules.ai import wrap_untrusted
from semestra.modules.files.parse import ParseError
from semestra.modules.files.parse.isolated import render_isolated

if TYPE_CHECKING:
    from semestra.modules.imports.ics import IcsCourse, IcsEvent, IcsResult

log = structlog.get_logger()

# About 6k tokens: documents up to this size are given whole.
FULL_TEXT_CHARS = 24_000
PREVIEW_PAGES = 2
OUTLINE_MAX = 60
# Scanned pages sent as images, per attachment; images are costly and slow to send.
SCANNED_IMAGES_MAX = 5
_CACHE_MAX = 32
# Rendered page images by (attachment id, page): every request of a turn sends them again.
_images: OrderedDict[tuple[str, int], bytes] = OrderedDict()
# Rendered calendars by (attachment id, time zone); None when the file could not be read. The
# text is kept, not the parsed events: it is all the assistant reads, and much smaller.
_calendars: OrderedDict[tuple[str, str], Calendar | None] = OrderedDict()
SUMMARY_COURSES = 40
EVENTS_PER_PAGE = 100
_DAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")

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


async def render(ctx: Ctx, att: AgentAttachment, *, vision: bool) -> list[UserContent]:
    """PDFs are given as text and page images, which every provider takes, rather than as a
    document block, so whether the model reads PDFs does not matter here."""
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
        content += _outline_and_hint(att, rows)
    content += await _scanned(ctx, att, shown, vision=vision)
    return content


def _page_text(row: AgentAttachmentPage) -> str:
    body = row.markdown[: attachments.PAGE_MAX_CHARS].strip()
    if len(row.markdown) > attachments.PAGE_MAX_CHARS:
        body += f"\n[page cut at {attachments.PAGE_MAX_CHARS} characters]"
    if row.needs_ocr and not body:
        body = "[scanned page without a text layer]"
    return f"--- page {row.page_no} ---\n{body}"


def _outline_and_hint(att: AgentAttachment, rows: list[AgentAttachmentPage]) -> list[str]:
    """The outline's headings are the document's own words: wrapped as untrusted, apart from
    the instructions around them."""
    entries = attachments.outline(rows)
    lines = [
        f"{'  ' * (level - 1)}- {title[:120]} (p. {page})"
        for level, page, title in entries[:OUTLINE_MAX]
    ]
    if len(entries) > OUTLINE_MAX:
        lines.append(f"- … {len(entries) - OUTLINE_MAX} more headings")
    shown = f"Only pages 1-{PREVIEW_PAGES} of {att.page_count} are shown."
    hint = (
        f"Read other pages with agent__attachment__read (attachment_id {att.id}, page_from) when "
        "the question needs them."
    )
    if not lines:
        return [f"{shown} The document has no headings. {hint}"]
    outline = wrap_untrusted("\n".join(lines), f"{att.name} (outline)")
    return [f"{shown} Its outline:\n{outline}\n{hint}"]


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
    images = await _page_images(ctx, att, pages)
    out: list[UserContent] = []
    for page_no in pages:
        if images[page_no]:
            out += [
                f"Page {page_no} of {_attr(att.name)} (scanned):",
                BinaryContent(data=images[page_no], media_type="image/png"),
            ]
    failed = [p for p in pages if not images[p]]
    if failed:
        out.append(
            f"Pages {', '.join(map(str, failed))} of {_attr(att.name)} are scanned images that "
            "could not be shown."
        )
    if len(scanned) > len(pages):
        out.append(
            f"Pages {', '.join(map(str, scanned[len(pages) :]))} are scanned too and not shown."
        )
    return out


async def _page_images(ctx: Ctx, att: AgentAttachment, pages: list[int]) -> dict[int, bytes]:
    """The pages' images, rendered in a child process (like the files pipeline: a hostile PDF
    must not take the server down) and kept, so later requests show the same; empty for a page
    that cannot be rendered. Cached pages are taken before any await: another turn trimming the
    cache meanwhile cannot drop them."""
    out = {p: _images[(att.id, p)] for p in pages if (att.id, p) in _images}
    for p in out:
        _images.move_to_end((att.id, p))
    missing = [p for p in pages if p not in out]
    if missing:
        data = await service.read_attachment(ctx, att)
        try:
            pngs = await render_isolated(
                data,
                pdf=True,
                pages=[p - 1 for p in missing],
                time_limit=ctx.settings.files_parse_timeout_seconds,
                memory_limit=ctx.settings.files_parse_memory_bytes,
            )
        except ParseError as exc:
            log.info("agent.attachment.render_failed", attachment_id=att.id, code=exc.code)
            pngs = []
        for i, page_no in enumerate(missing):
            out[page_no] = _images[(att.id, page_no)] = pngs[i] if i < len(pngs) else b""
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


@dataclass(frozen=True)
class Calendar:
    summary: str
    pages: list[str]


async def calendar(ctx: Ctx, att: AgentAttachment) -> Calendar | None:
    """The calendar as the importer reads it, in the conversation's Program's time zone, as the
    summary and the pages `agent.attachment.read` serves. Parsed once per (attachment, time zone)
    in a worker thread, then kept: a turn sends the summary on every request, and a calendar can
    hold thousands of events."""
    from semestra.modules.imports.ics import parse_ics

    tz = await _timezone(ctx, att)
    key = (att.id, tz)
    if key not in _calendars:
        data = await service.read_attachment(ctx, att)
        try:
            result = await anyio.to_thread.run_sync(lambda: parse_ics(data, tz))
            _calendars[key] = Calendar(_summary_text(att, result), calendar_pages(result))
        except AppError:
            _calendars[key] = None
        while len(_calendars) > _CACHE_MAX:
            _calendars.popitem(last=False)
    _calendars.move_to_end(key)
    return _calendars[key]


async def _calendar_summary(ctx: Ctx, att: AgentAttachment) -> str:
    rendered = await calendar(ctx, att)
    if rendered is None:
        return _unreadable("files.parse_failed")
    return rendered.summary


def _course_days(course: IcsCourse) -> list[date]:
    days = [m.first_date for m in course.meetings]
    days += [m.last_date for m in course.meetings if m.last_date]
    days += [e.day for e in course.events]
    return days


def _summary_text(att: AgentAttachment, result: IcsResult) -> str:
    """Course codes, counts and dates only: what a course is called and where it meets come from
    the file (other people's text) and are read with `agent.attachment.read`, which wraps them."""
    lines = ["Calendar file, read exactly by Semestra's calendar reader (no AI)."]
    for course in result.courses[:SUMMARY_COURSES]:
        days = _course_days(course)
        span = f"{min(days)} to {max(days)}, " if days else ""
        meetings = _count(len(course.meetings), "weekly meeting")
        events = _count(len(course.events), "single event")
        lines.append(f"- {course.code or 'A course without a code'}: {span}{meetings}, {events}")
    if len(result.courses) > SUMMARY_COURSES:
        lines.append(f"- … and {len(result.courses) - SUMMARY_COURSES} more courses")
    if not result.courses:
        lines.append("- No courses recognized.")
    if result.events:
        lines.append(f"- {len(result.events)} events without a course")
    lines.append(
        f"Read all of it (sections, times, rooms, instructors, dates without class) with "
        f"agent__attachment__read, attachment_id {att.id}: a page per course (many single events "
        "go on over more pages). To import its classes, pass the attachment id to "
        "imports__session__create with source_kind ics."
    )
    return "\n".join(lines)


def _time_span(start: object, end: object) -> str:
    return f"{start:%H:%M}-{end:%H:%M}" if start is not None and end is not None else "all day"


def _event_line(e: IcsEvent) -> str:
    when = str(e.day) if e.end_day == e.day else f"{e.day} to {e.end_day}"
    parts = [when, "all day" if e.all_day else _time_span(e.start_time, e.end_time), e.title]
    parts += [x for x in (e.type_code, e.location) if x]
    return "- " + " · ".join(parts)


def _count(n: int, noun: str) -> str:
    return f"{n} {noun}" + ("" if n == 1 else "s")


def _course_pages(course: IcsCourse) -> list[str]:
    """The course's meetings and its first `EVENTS_PER_PAGE` single events, then the rest of its
    events on pages of their own, so that no page outgrows what `agent.attachment.read` returns."""
    head = course.code or course.title
    title = f"## {head}" + (f" ({course.title})" if course.title != head else "")
    lines = [title]
    if course.meetings:
        lines.append("Weekly meetings:")
    for m in course.meetings:
        until = f"{m.first_date} to {m.last_date}" if m.last_date else f"from {m.first_date}"
        parts = [
            m.section_code or m.type_code,
            f"{_DAYS[m.weekday - 1]} {_time_span(m.start_time, m.end_time)}",
            m.recurrence,
            until,
        ]
        parts += [x for x in (m.location, m.instructor) if x]
        if m.exceptions:
            parts.append("no class on " + ", ".join(map(str, m.exceptions)))
        lines.append("- " + " · ".join(parts))
    chunks = [
        course.events[i : i + EVENTS_PER_PAGE]
        for i in range(0, len(course.events), EVENTS_PER_PAGE)
    ]
    if chunks:
        lines += ["Single events:", *map(_event_line, chunks[0])]
    pages = ["\n".join(lines)]
    pages += [
        "\n".join([f"{title}, continued", "Single events:", *map(_event_line, chunk)])
        for chunk in chunks[1:]
    ]
    return pages


def calendar_pages(result: IcsResult) -> list[str]:
    """The calendar as pages for `agent.attachment.read`: one per course (more for a course with
    many single events), then the events without a course, `EVENTS_PER_PAGE` at a time. Times are
    the Program's local wall-clock time."""
    pages = [page for c in result.courses for page in _course_pages(c)]
    for i in range(0, len(result.events), EVENTS_PER_PAGE):
        chunk = result.events[i : i + EVENTS_PER_PAGE]
        pages.append("\n".join(["## Events without a course", *map(_event_line, chunk)]))
    return pages


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
