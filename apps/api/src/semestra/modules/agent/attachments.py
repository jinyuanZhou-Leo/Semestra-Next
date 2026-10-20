"""Chat attachments as documents (M12 实现说明): read once on upload with M07's parser into
per-page markdown (`agent_attachment_pages`), then referred to by id. The model reads further
pages with `attachments.read`; imports take the original file by id (`open_original`).

Pages are not chunked or indexed; saving the attachment to a course's files does that (M07).
"""

import re
from dataclasses import dataclass, field

import anyio.to_thread
from pydantic import BaseModel, Field
from sqlalchemy import select

from semestra.core.capability import capability
from semestra.core.context import Ctx
from semestra.core.errors import not_found
from semestra.core.storage import get_storage
from semestra.modules.agent.models import AgentAttachment, AgentAttachmentPage
from semestra.modules.files.parse import ParsedDocument, ParsedPage, ParseError, detect, parse
from semestra.modules.files.parse.detect import Detected
from semestra.modules.files.parse.isolated import Parsed, parse_isolated
from semestra.modules.files.parse.readers import MAX_PAGES

# Formats whose readers run third-party C code or inflate archives: parsed in a child process
# with time and memory limits (M07 `parse/isolated.py`). Text formats are read in-process.
ISOLATED_KINDS = ("pdf", "docx", "pptx", "xlsx")
PARSE_TIME_LIMIT = 60.0
READ_MAX_PAGES = 10
READ_MAX_CHARS = 40_000
_HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")


@dataclass
class Reading:
    """What the parser made of an upload: stored on the attachment row and its pages."""

    kind: str
    mime: str
    pages: list[ParsedPage] = field(default_factory=lambda: [])
    error: str | None = None


async def read_upload(ctx: Ctx, data: bytes, filename: str) -> Reading:
    """Detects the type by content and parses the file into pages. Never raises: a file the
    parser cannot read is kept with `error` set, so the model can be told why."""
    detected = detect(data, filename)
    if detected.kind == "image":
        return Reading("image", detected.mime)
    if detected.kind == "ics":
        # The importer reads calendars; the text pages only serve `attachments.read`.
        document = parse(data, Detected("text", "text/plain"), max_pages=MAX_PAGES)
        return Reading("ics", detected.mime, document.pages)
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
    row.page_count = None if reading.kind == "image" else len(reading.pages)
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
        raise not_found()
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
    data = b"".join([chunk async for chunk in get_storage(ctx).open(row.storage_key)])
    return row, data


# --- capability -----------------------------------------------------------------------------


class AttachmentReadInput(BaseModel):
    attachment_id: str = Field(description="Attachment id from the <attachment> block")
    page_from: int = Field(default=1, ge=1, description="First page to read")
    page_to: int | None = Field(
        default=None, ge=1, description=f"Last page (inclusive); at most {READ_MAX_PAGES} pages"
    )


class AttachmentPageOut(BaseModel):
    page_no: int
    markdown: str
    needs_ocr: bool = Field(description="Scanned page without a text layer")


class AttachmentRead(BaseModel):
    attachment_id: str
    name: str
    type: str | None
    page_count: int
    pages: list[AttachmentPageOut]
    next_page: int | None = Field(description="Call again from this page for the rest")
    error_code: str | None = Field(description="Why the file could not be read, if it could not")


@capability(
    name="attachments.read",
    summary="Read pages of a file the user attached to the conversation.",
    description=f"""Returns the text of up to {READ_MAX_PAGES} pages as markdown, starting at
page_from; when next_page is set, call again from there for more. Use the attachment id from the
<attachment> block. To import courses, grades or a timetable from an attachment, pass its id to
imports.session.create instead of copying its text.""",
    effect="read",
    expose=("agent",),
    tags=("agent",),
    agent_core=True,
)
async def read(ctx: Ctx, inp: AttachmentReadInput) -> AttachmentRead:
    row = await get_owned(ctx, inp.attachment_id)
    total = row.page_count or 0
    last = min(inp.page_to or total, inp.page_from + READ_MAX_PAGES - 1, total)
    out: list[AttachmentPageOut] = []
    size = 0
    for page in await pages(ctx, row.id, inp.page_from, last):
        # Long pages: stop early rather than flood the context; next_page picks up from here.
        if out and size + len(page.markdown) > READ_MAX_CHARS:
            last = page.page_no - 1
            break
        out.append(
            AttachmentPageOut(
                page_no=page.page_no, markdown=page.markdown, needs_ocr=page.needs_ocr
            )
        )
        size += len(page.markdown)
    return AttachmentRead(
        attachment_id=row.id,
        name=row.name,
        type=row.doc_kind,
        page_count=total,
        pages=out,
        next_page=last + 1 if last < total else None,
        error_code=row.parse_error,
    )
