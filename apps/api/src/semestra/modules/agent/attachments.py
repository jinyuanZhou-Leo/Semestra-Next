"""Chat attachments as documents (M12 实现说明): read once on upload with M07's parser into
per-page markdown (`agent_attachment_pages`), then referred to by id. The model reads further
pages with `agent.attachment.read`; imports take the original file by id (`open_original`).

Pages are not chunked or indexed; saving the attachment to a course's files does that (M07).
"""

import re
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Self

import anyio.to_thread
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import exists, func, select

from semestra.core.capability import Http, capability
from semestra.core.context import Ctx
from semestra.core.errors import AppError, not_found
from semestra.core.jobs import periodic
from semestra.core.storage import get_storage
from semestra.modules.agent import service
from semestra.modules.agent.models import AgentAttachment, AgentAttachmentPage, AgentMessage
from semestra.modules.files import service as files
from semestra.modules.files.parse import ParsedDocument, ParsedPage, ParseError, parse
from semestra.modules.files.parse.detect import Detected
from semestra.modules.files.parse.isolated import Parsed, parse_isolated
from semestra.modules.files.parse.readers import MAX_PAGES
from semestra.modules.files.schemas import ItemOut

# Formats whose readers run third-party C code or inflate archives: parsed in a child process
# with time and memory limits (M07 `parse/isolated.py`). Text formats are read in-process.
ISOLATED_KINDS = ("pdf", "docx", "pptx", "xlsx")
# What the composer takes besides images (M07's readers; ICS goes to the importer).
DOCUMENT_KINDS = ("pdf", "docx", "pptx", "xlsx", "csv", "html", "text", "markdown", "ics")
PARSE_TIME_LIMIT = 60.0
READ_MAX_PAGES = 10
READ_MAX_CHARS = 40_000
# Pages are cut to M07's logical page size on upload; a PDF or slide page can still be long, so
# a single page is cut here too.
PAGE_MAX_CHARS = 20_000
ICS_NOTE = (
    "Calendar file, as Semestra's calendar reader understands it: one page per course, in the "
    "Program's local time. To import its classes, pass this attachment id to "
    "imports__session__create with source_kind ics."
)
SCANNED_NOTE = (
    "Scanned pages without text: {pages}. They cannot be read with this tool (the "
    "first scanned pages are shown as pictures with the message, to models that see images). "
    "Ask the user for the text of the part they need, or a screenshot of it."
)
# Uploads no message refers to (removed from the composer, the page closed before sending) are
# deleted after this long, with their file, so they stop counting against the storage quota.
UNSENT_RETENTION = timedelta(hours=24)
_HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")


@dataclass
class Reading:
    """What the parser made of an upload: stored on the attachment row and its pages."""

    kind: str
    mime: str
    pages: list[ParsedPage] = field(default_factory=lambda: [])
    error: str | None = None


async def read_upload(ctx: Ctx, data: bytes, detected: Detected) -> Reading:
    """Parses the file into pages. Never raises: a file the parser cannot read is kept with
    `error` set, so the model can be told why. Calendars keep no pages: the importer reads
    them (M08), and their raw text is no use to the model."""
    if detected.mime.startswith("image/"):
        return Reading("image", detected.mime)  # GIF is kind "other" to M07, but a picture here
    if detected.kind == "ics":
        return Reading("ics", detected.mime)
    try:
        if detected.kind in ISOLATED_KINDS:
            document = await _parse_isolated(ctx, data, detected)
        else:
            document = await anyio.to_thread.run_sync(
                lambda: parse(data, detected, max_pages=MAX_PAGES)
            )
    except ParseError as exc:
        code = "files.unsupported_type" if detected.kind == "other" else exc.code
        return Reading(detected.kind, detected.mime, error=code)
    return Reading(detected.kind, detected.mime, document.pages)


async def _parse_isolated(ctx: Ctx, data: bytes, detected: Detected) -> ParsedDocument:
    async for message in parse_isolated(
        data,
        detected,
        max_pages=MAX_PAGES,
        thumbnail_pages=0,
        time_limit=min(ctx.settings.files_parse_timeout_seconds, PARSE_TIME_LIMIT),
        memory_limit=ctx.settings.files_parse_memory_bytes,
    ):
        if isinstance(message, Parsed):
            return message.document
    raise ParseError("files.parse_failed")


def store_reading(ctx: Ctx, row: AgentAttachment, reading: Reading) -> None:
    """Fills in the attachment's reading and adds its pages (the caller flushes/commits)."""
    row.doc_kind = reading.kind
    row.parse_error = reading.error
    row.page_count = None if reading.kind in ("image", "ics") else len(reading.pages)
    for index, page in enumerate(reading.pages):
        ctx.db.add(
            AgentAttachmentPage(
                attachment_id=row.id,
                user_id=row.user_id,
                page_no=index + 1,
                markdown=page.markdown,
                needs_ocr=page.needs_ocr,
            )
        )


async def get_owned(ctx: Ctx, attachment_id: str) -> AgentAttachment:
    row = await ctx.db.get(AgentAttachment, attachment_id)
    if row is None or row.user_id != ctx.user_id:
        raise not_found("attachment", attachment_id)
    return row


async def pages(
    ctx: Ctx, attachment_id: str, page_from: int = 1, page_to: int | None = None
) -> list[AgentAttachmentPage]:
    stmt = (
        select(AgentAttachmentPage)
        .where(
            AgentAttachmentPage.attachment_id == attachment_id,
            AgentAttachmentPage.user_id == ctx.user_id,
            AgentAttachmentPage.page_no >= page_from,
        )
        .order_by(AgentAttachmentPage.page_no)
    )
    if page_to is not None:
        stmt = stmt.where(AgentAttachmentPage.page_no <= page_to)
    return list((await ctx.db.scalars(stmt)).all())


def outline(rows: list[AgentAttachmentPage]) -> list[tuple[int, int, str]]:
    """(level, title, page) of the markdown headings, like `files.document.outline`."""
    entries: list[tuple[int, int, str]] = []
    for row in rows:
        fenced = False
        for line in row.markdown.split("\n"):
            if line.lstrip().startswith("```"):
                fenced = not fenced
            elif not fenced and (match := _HEADING.match(line)):
                entries.append((len(match[1]), row.page_no, match[2]))
    return entries


async def open_original(ctx: Ctx, attachment_id: str) -> tuple[AgentAttachment, bytes]:
    """The uploaded file itself, for importers that read the original (M08 `attachment_ids`)."""
    row = await get_owned(ctx, attachment_id)
    return row, await service.read_attachment(ctx, row)


@periodic("agent.attachments.cleanup", every=timedelta(hours=1))
async def cleanup_unsent(ctx: Ctx) -> None:
    blocks = func.json_each(AgentMessage.content).table_valued("value")
    referenced = (
        select(1)
        .select_from(AgentMessage)
        .join(blocks, func.json_extract(blocks.c.value, "$.attachment_id") == AgentAttachment.id)
        .where(AgentMessage.session_id == AgentAttachment.session_id)
    )
    rows = (
        await ctx.db.scalars(
            select(AgentAttachment).where(
                AgentAttachment.created_at < ctx.now - UNSENT_RETENTION, ~exists(referenced)
            )
        )
    ).all()
    keys = [row.storage_key for row in rows]
    for row in rows:
        await ctx.db.delete(row)
    storage = get_storage(ctx)

    async def _remove_files() -> None:
        for key in keys:
            await storage.delete(key)

    ctx.after_commit.append(_remove_files)


# --- capability -----------------------------------------------------------------------------


@dataclass
class _Page:
    """A page made when it is read (a calendar's), shaped like a stored one."""

    page_no: int
    markdown: str
    needs_ocr: bool = False


class AttachmentReadInput(BaseModel):
    attachment_id: str = Field(description="Attachment id from the <attachment> block")
    page_from: int = Field(default=1, ge=1, description="First page to read")
    page_to: int | None = Field(
        default=None, ge=1, description=f"Last page (inclusive); at most {READ_MAX_PAGES} pages"
    )

    @model_validator(mode="after")
    def _range(self) -> Self:
        if self.page_to is not None and self.page_to < self.page_from:
            raise ValueError("page_to must not be before page_from")
        return self


class AttachmentPageOut(BaseModel):
    page_no: int
    markdown: str
    needs_ocr: bool = Field(description="Scanned page without a text layer")
    truncated: bool = Field(default=False, description="The page was cut; the rest is not shown")


class AttachmentRead(BaseModel):
    attachment_id: str
    name: str
    type: str | None
    page_count: int
    pages: list[AttachmentPageOut]
    next_page: int | None = Field(description="Call again from this page for the rest")
    error_code: str | None = Field(description="Why the file could not be read, if it could not")
    note: str | None = Field(
        default=None, description="How to use a file or pages that have no text"
    )


@capability(
    name="agent.attachment.read",
    summary="Read pages of a file the user attached to the conversation.",
    description=f"""Returns the text of up to {READ_MAX_PAGES} pages as markdown, starting at
page_from; when next_page is set, call again from there for more. Use the attachment id from the
<attachment> block. A calendar (ICS) file reads as one page per course: its sections, times,
rooms and dates without class. To import courses, grades or a timetable from an attachment, pass
its id to imports.session.create instead of copying its text.""",
    effect="read",
    expose=("agent",),
    tags=("agent",),
    agent_core=True,
)
async def read(ctx: Ctx, inp: AttachmentReadInput) -> AttachmentRead:
    row = await get_owned(ctx, inp.attachment_id)
    error = row.parse_error
    if row.doc_kind == "ics":
        from semestra.modules.agent import attachment_context

        parsed = await attachment_context.calendar(ctx, row)
        if parsed is None:
            error = "files.parse_failed"
        texts = parsed.pages if parsed is not None else []
        made = [_Page(n, t) for n, t in enumerate(texts, start=1)]
        total = len(made)
    else:
        made = None
        total = row.page_count or 0
    last = min(inp.page_to or total, inp.page_from + READ_MAX_PAGES - 1, total)
    if made is not None:
        chosen = made[inp.page_from - 1 : last]
    else:
        chosen = await pages(ctx, row.id, inp.page_from, last)
    out: list[AttachmentPageOut] = []
    size = 0
    for page in chosen:
        # Stop early rather than flood the context; next_page picks up from here.
        if out and size + len(page.markdown) > READ_MAX_CHARS:
            last = page.page_no - 1
            break
        text = page.markdown[:PAGE_MAX_CHARS]
        out.append(
            AttachmentPageOut(
                page_no=page.page_no,
                markdown=text,
                needs_ocr=page.needs_ocr,
                truncated=len(text) < len(page.markdown),
            )
        )
        size += len(text)
    note = ICS_NOTE if row.doc_kind == "ics" else None
    if scanned := [p.page_no for p in out if p.needs_ocr and not p.markdown.strip()]:
        note = SCANNED_NOTE.format(pages=", ".join(map(str, scanned)))
    if row.doc_kind is None:
        error = "agent.attachment_not_read"  # uploaded before attachments were parsed
    return AttachmentRead(
        attachment_id=row.id,
        name=row.name,
        type=row.doc_kind,
        page_count=total,
        pages=out,
        next_page=last + 1 if last < total else None,
        error_code=error,
        note=note,
    )


class SaveToCourseInput(BaseModel):
    id: str = Field(description="Attachment id")
    course_id: str = Field(description="Course to save the file to")


@capability(
    name="agent.attachment.save",
    summary="Save a file attached to the conversation to a course's files.",
    description="""Use when the user wants to keep an attached document (a syllabus, notes) with
the course. The file is then processed like any course file (searchable, citable). Saving it to
the same course again returns the saved file.""",
    effect="write",
    http=Http("POST", "/agent/attachments/{id}:save"),
    expose=("http", "agent"),
    tags=("agent",),
)
async def save_to_course(ctx: Ctx, inp: SaveToCourseInput) -> ItemOut:
    row, data = await open_original(ctx, inp.id)
    if row.file_item_id is not None:
        try:
            saved = await files.get_item(ctx, row.file_item_id)
        except AppError:
            saved = None  # deleted from the course since
        if saved is not None and saved.course_id == inp.course_id:
            return await files.item_out(ctx, saved)

    async def chunks() -> AsyncIterator[bytes]:
        yield data

    item = await files.save_bytes_as_file(
        ctx, inp.course_id, row.name, chunks(), source_kind="agent", source_ref=row.id
    )
    row.file_item_id = item.id
    return item
