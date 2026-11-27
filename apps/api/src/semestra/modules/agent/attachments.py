"""Chat attachments as documents (M12 实现说明): read once on upload with M07's parser into
per-page markdown (`agent_attachment_pages`), then referred to by id. The images a model is shown
with the message (the first scanned pages, an image or the first parts of a long one) are
rendered then too, and stored next to the upload: sending reads only what is stored. The model
reads further pages with `agent.attachment.read`; imports take the original file by id
(`open_original`).

Pages are not chunked or indexed; saving the attachment to a course's files does that (M07).
"""

from collections.abc import AsyncIterator
from contextlib import aclosing
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Self

import anyio.to_thread
import structlog
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select

from semestra.core.capability import Http, capability
from semestra.core.context import Ctx
from semestra.core.errors import AppError, not_found
from semestra.core.jobs import periodic
from semestra.core.storage import charge, delete_after_commit, get_storage, user_key
from semestra.modules.agent import service, tools
from semestra.modules.agent.models import AgentAttachment, AgentAttachmentPage
from semestra.modules.files import items as files_items
from semestra.modules.files import service as files
from semestra.modules.files.chunking import heading
from semestra.modules.files.parse import ParsedDocument, ParsedPage, ParseError, parse
from semestra.modules.files.parse.detect import Detected
from semestra.modules.files.parse.isolated import Parsed, Rendering, parse_isolated, render_isolated
from semestra.modules.files.parse.readers import MAX_PAGES
from semestra.modules.files.parse.render import PageImage
from semestra.modules.files.schemas import ItemOut

log = structlog.get_logger()

# Formats whose readers run third-party C code or inflate archives: parsed in a child process
# with time and memory limits (M07 `parse/isolated.py`). Text formats are read in-process.
ISOLATED_KINDS = ("pdf", "docx", "pptx", "xlsx")
# What the composer takes besides images (M07's readers; ICS goes to the importer).
DOCUMENT_KINDS = ("pdf", "docx", "pptx", "xlsx", "csv", "html", "text", "markdown", "ics")
PARSE_TIME_LIMIT = 60.0
# Images shown with a message, per attachment (images are costly and slow to send); the model
# looks at the rest with `view_pages`.
SHOWN_IMAGES = 5
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
IMAGE_NOTE = (
    "An image: no text to read. Models that see images get it with the message; a long one comes "
    f"in parts (page_count), and {tools.VIEW_PAGES} shows the parts not shown."
)
# Uploads no message refers to (removed from the composer, the page closed before sending) are
# deleted after this long, with their file, so they stop counting against the storage quota.
UNSENT_RETENTION = timedelta(hours=24)


@dataclass
class Reading:
    """What the parser made of an upload: stored on the attachment row and its pages."""

    kind: str
    mime: str
    pages: list[ParsedPage] = field(default_factory=lambda: [])
    error: str | None = None
    # The images shown with the message, by page number.
    images: dict[int, PageImage] = field(default_factory=lambda: {})


async def read_upload(ctx: Ctx, data: bytes, detected: Detected) -> Reading:
    """Parses the file into pages. Never raises: a file the parser cannot read is kept with
    `error` set, so the model can be told why. Calendars keep no pages: the importer reads
    them (M08), and their raw text is no use to the model."""
    if detected.mime.startswith("image/"):
        return await _read_image(ctx, data, detected.mime)  # GIF is "other" to M07
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
    reading = Reading(detected.kind, detected.mime, document.pages)
    scanned = [i for i, p in enumerate(document.pages) if p.needs_ocr][:SHOWN_IMAGES]
    if scanned and detected.kind == "pdf":
        try:
            rendering = await _render(ctx, data, pdf=True, pages=scanned)
            reading.images = {i + 1: parts[0] for i, parts in rendering.images.items()}
        except ParseError as exc:  # the pages stay readable as text; they are just not shown
            log.info("agent.attachment.render_failed", code=exc.code)
    return reading


async def _read_image(ctx: Ctx, data: bytes, mime: str) -> Reading:
    """An image is one page with no text, or a long one several (its parts, top to bottom)."""
    try:
        rendering = await _render(ctx, data, pdf=False, pages=SHOWN_IMAGES)
    except ParseError as exc:
        return Reading("image", mime, error=exc.code)
    images = {i + 1: shown[0] for i, shown in rendering.images.items()}
    parts = [ParsedPage("") for _ in range(rendering.page_count)]
    return Reading("image", mime, parts, images=images)


async def _render(ctx: Ctx, data: bytes, *, pdf: bool, pages: list[int] | int) -> Rendering:
    return await render_isolated(
        data,
        pdf=pdf,
        pages=pages,
        split_tall=True,
        time_limit=min(ctx.settings.files_parse_timeout_seconds, PARSE_TIME_LIMIT),
        memory_limit=ctx.settings.files_parse_memory_bytes,
    )


async def _parse_isolated(ctx: Ctx, data: bytes, detected: Detected) -> ParsedDocument:
    messages = parse_isolated(
        data,
        detected,
        max_pages=MAX_PAGES,
        thumbnail_pages=0,
        time_limit=min(ctx.settings.files_parse_timeout_seconds, PARSE_TIME_LIMIT),
        memory_limit=ctx.settings.files_parse_memory_bytes,
    )
    # Closed here: left to the garbage collector, it would end the child from another task.
    async with aclosing(messages):
        async for message in messages:
            if isinstance(message, Parsed):
                return message.document
    raise ParseError("files.parse_failed")


async def store_reading(
    ctx: Ctx, row: AgentAttachment, reading: Reading, stored: list[str]
) -> None:
    """Fills in the attachment's reading and adds its pages (the caller flushes/commits). Page
    images go to storage; their keys are added to `stored`, for the caller to remove if the
    upload fails."""
    row.doc_kind = reading.kind
    row.parse_error = reading.error
    row.page_count = None if reading.kind == "ics" else len(reading.pages)
    for page_no, page in enumerate(reading.pages, start=1):
        image = reading.images.get(page_no)
        key = None
        if image is not None:
            key = f"{user_key(row.user_id, 'agent')}/{row.id}/{page_no}"
            stored.append(key)
            await get_storage(ctx).put(key, _once(image.data), image.media_type)
        ctx.db.add(
            AgentAttachmentPage(
                attachment_id=row.id,
                user_id=row.user_id,
                page_no=page_no,
                markdown=page.markdown,
                needs_ocr=page.needs_ocr,
                image_key=key,
                image_type=image.media_type if image is not None else None,
            )
        )


async def _once(data: bytes) -> AsyncIterator[bytes]:
    yield data


async def page_image(ctx: Ctx, page: AgentAttachmentPage) -> PageImage | None:
    """The page's stored image, if it has one."""
    if not page.image_key or not page.image_type:
        return None
    chunks = [chunk async for chunk in get_storage(ctx).open(page.image_key)]
    return PageImage(b"".join(chunks), page.image_type)


async def snapshot_file(ctx: Ctx, session_id: str, item_id: str) -> AgentAttachment | None:
    """A course file picked with `@`, kept as an attachment of the conversation: its text as it
    was when the message was sent, so the conversation reads the same on every request. Picked
    again in the same conversation, the same version of the file is the same attachment. It has
    no stored original (`storage_key` is empty; the course file is the original), but the copied
    text counts in `size`, so it is held to the storage quota. None when the file is not the
    user's (any more). A file without readable text yet is kept with the reason in
    `parse_error`."""
    from semestra.modules.files import documents

    try:
        item = await files.get_item(ctx, item_id)
    except AppError:
        return None
    row = AgentAttachment(
        user_id=ctx.user_id,
        session_id=session_id,
        kind="file",
        name=item.display_name,
        storage_key="",
        mime=item.mime_type or "application/octet-stream",
        size=0,
        file_item_id=item.id,
        created_at=ctx.now,
        sent_at=ctx.now,
        doc_kind=files.file_type(item.mime_type),
    )
    try:
        document_id = await documents.active_document_id(ctx, item.id)
    except AppError as exc:
        row.parse_error = exc.code
        ctx.db.add(row)
        await ctx.db.flush()
        return row
    kept = await ctx.db.scalar(
        select(AgentAttachment).where(
            AgentAttachment.user_id == ctx.user_id,
            AgentAttachment.session_id == session_id,
            AgentAttachment.storage_key == "",
            AgentAttachment.file_document_id == document_id,
        )
    )
    if kept is not None:
        return kept
    _, page_rows = await documents.snapshot(ctx, item.id)
    row.file_document_id = document_id
    row.page_count = len(page_rows)
    row.size = sum(len(page.markdown.encode()) for page in page_rows)
    ctx.db.add(row)
    await ctx.db.flush()
    for page in page_rows:
        ctx.db.add(
            AgentAttachmentPage(
                attachment_id=row.id,
                user_id=row.user_id,
                page_no=page.page_no,
                markdown=page.markdown,
                # Handwriting, figures or a scan: the text may not have all of it.
                needs_ocr=page.visual or (not page.markdown.strip() and not page.ocr_used),
            )
        )
    await charge(ctx)
    return row


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
            elif not fenced and (found := heading(line)):
                entries.append((found[0], row.page_no, found[1]))
    return entries


async def open_original(ctx: Ctx, attachment_id: str) -> tuple[AgentAttachment, bytes]:
    """The uploaded file itself, for importers that read the original (M08 `attachment_ids`). A
    course file picked with `@` has none here: it is read as the course file."""
    row = await get_owned(ctx, attachment_id)
    if not row.storage_key:
        raise not_found("attachment", attachment_id)
    return row, await service.read_attachment(ctx, row)


@periodic("agent.attachments.cleanup", every=timedelta(hours=1))
async def cleanup_unsent(ctx: Ctx) -> None:
    rows = (
        await ctx.db.scalars(
            select(AgentAttachment).where(
                AgentAttachment.sent_at.is_(None),
                AgentAttachment.created_at < ctx.now - UNSENT_RETENTION,
            )
        )
    ).all()
    keys = await service.stored_keys(ctx, rows)
    for row in rows:
        await ctx.db.delete(row)
    delete_after_commit(ctx, keys)


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
    needs_ocr: bool = Field(
        description="The page has handwriting, figures or a scan: its text may not have all of it"
    )
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
    untrusted=True,
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
    if row.doc_kind == "image":
        return AttachmentRead(
            attachment_id=row.id,
            name=row.name,
            type=row.doc_kind,
            page_count=row.page_count or 0,
            pages=[],
            next_page=None,
            error_code=error,
            note=IMAGE_NOTE,
        )
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
    agent_output_fields=("id", "display_name", "course_id", "folder_id", "doc_status"),
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

    item = await files_items.save_bytes_as_file(ctx, inp.course_id, row.name, chunks())
    row.file_item_id = item.id
    return item
