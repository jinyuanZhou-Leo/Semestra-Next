"""What M08 needs from modules that may be absent or merged later: the target capabilities
(M02-M05, called through the registry by name, like the agent would) and the document pipeline
(M07: parsing, page rendering, moving uploads into a course).

Everything here fails with an error code instead of an ImportError, so an import that needs a
missing piece fails its item or file, not the whole app.
"""

import importlib
from collections.abc import AsyncIterator, Sequence
from types import ModuleType
from typing import Any

from pydantic import BaseModel, ValidationError

from semestra.core.capability import registry
from semestra.core.config import Settings
from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules import ai

# Files up to this many pages are read whole (M08 §4.2 step 2).
MAX_READ_PAGES = 60
LOGICAL_PAGE_CHARS = 4000
TEXT_MIMES = ("text/plain", "text/markdown", "text/csv")
IMAGE_MIMES = ("image/png", "image/jpeg", "image/webp", "image/gif")
SEARCH_QUERIES = ("grading assessment weight", "schedule lecture tutorial", "成绩 评分 考核 课表")


class NotReady(Exception):
    """A course file is still being processed (M07); the job retries later."""


def has_capability(name: str) -> bool:
    try:
        registry.get(name)
    except AppError:
        return False
    return True


async def call(ctx: Ctx, name: str, args: dict[str, Any]) -> dict[str, Any]:
    """Runs a capability in the caller's transaction and returns its output as JSON data."""
    try:
        cap = registry.get(name)
    except AppError:
        raise AppError("import.target_unavailable", 422, capability=name) from None
    try:
        inp = cap.input_model.model_validate(args)
    except ValidationError as exc:
        errors = [{"loc": list(e["loc"]), "code": e["type"]} for e in exc.errors()]
        raise AppError("common.validation", 422, errors=errors) from exc
    # The target runs for the import, not for whoever started it: full output, and the
    # import's own source kinds (lms, syllabus) are allowed.
    outer, ctx.surface = ctx.surface, "http"
    try:
        out: BaseModel = await cap.handler(ctx, inp)
    finally:
        ctx.surface = outer
    return out.model_dump(mode="json")


def _files(submodule: str) -> ModuleType | None:
    try:
        return importlib.import_module(f"semestra.modules.files.{submodule}")
    except ImportError:
        return None


def _paginate(text: str) -> list[ai.PageText]:
    pages: list[ai.PageText] = []
    chunk: list[str] = []
    size = 0
    for paragraph in text.split("\n\n"):
        if chunk and size + len(paragraph) > LOGICAL_PAGE_CHARS:
            pages.append(ai.PageText(len(pages) + 1, "\n\n".join(chunk)))
            chunk, size = [], 0
        chunk.append(paragraph)
        size += len(paragraph) + 2
    if chunk:
        pages.append(ai.PageText(len(pages) + 1, "\n\n".join(chunk)))
    return [p for p in pages if p.text.strip()]


def text_pages(text: str) -> list[ai.PageText]:
    return _paginate(text.replace("\r\n", "\n"))


# Parsing and rendering run in M07's child process (time and memory limits), like the file
# pipeline and chat attachments: PyMuPDF holds the GIL, and a hostile PDF must not stall or
# exhaust the API. An import reads a few documents, so a minute each is plenty.
PARSE_TIME_LIMIT = 60.0
SCAN_PAGES = 8
TIMETABLE_PAGES = 4


async def read_upload(
    settings: Settings, data: bytes, filename: str, mime: str
) -> tuple[list[ai.PageText], list[ai.Image]]:
    """Page texts of an uploaded document, plus page images of pages without a text layer
    (scans). Plain text needs nothing else; other formats use M07's parser."""
    if mime in TEXT_MIMES or filename.lower().endswith((".txt", ".md")):
        return text_pages(data.decode("utf-8", errors="replace")), []
    if mime in IMAGE_MIMES:
        return [], [ai.Image(data, mime)]
    parse, isolated = _files("parse"), _files("parse.isolated")
    if parse is None or isolated is None:
        raise AppError("import.file_unsupported", 422, filename=filename)
    limits = _limits(settings)
    try:
        detected = parse.detect(data, filename)
        parsed = None
        async for message in isolated.parse_isolated(
            data, detected, max_pages=MAX_READ_PAGES, thumbnail_pages=0, **limits
        ):
            parsed = message.document
        if parsed is None:
            raise parse.ParseError("files.parse_failed")
        texts = [
            ai.PageText(i + 1, p.markdown) for i, p in enumerate(parsed.pages) if p.markdown.strip()
        ]
        scans = [i for i, p in enumerate(parsed.pages) if p.needs_ocr][:SCAN_PAGES]
        pngs = (
            await isolated.render_isolated(
                data, pdf=detected.mime == "application/pdf", pages=scans, **limits
            )
            if scans
            else []
        )
    except parse.ParseError as exc:
        raise AppError("import.file_unsupported", 422, filename=filename) from exc
    return texts, [ai.Image(png, "image/png") for png in pngs]


async def render_pages(settings: Settings, data: bytes, mime: str, filename: str) -> list[ai.Image]:
    """Images of a timetable: the image itself, or the first pages of a PDF (M07 renderer)."""
    if mime in IMAGE_MIMES:
        return [ai.Image(data, mime)]
    parse, isolated = _files("parse"), _files("parse.isolated")
    if parse is None or isolated is None or mime != "application/pdf":
        raise AppError("import.file_unsupported", 422, filename=filename)
    try:
        pngs = await isolated.render_isolated(
            data, pdf=True, pages=TIMETABLE_PAGES, **_limits(settings)
        )
    except parse.ParseError as exc:
        raise AppError("import.file_unsupported", 422, filename=filename) from exc
    return [ai.Image(png, "image/png") for png in pngs]


def _limits(settings: Settings) -> dict[str, Any]:
    return {
        "time_limit": min(settings.files_parse_timeout_seconds, PARSE_TIME_LIMIT),
        "memory_limit": settings.files_parse_memory_bytes,
    }


async def read_course_file(ctx: Ctx, item_id: str, program_id: str) -> list[ai.PageText]:
    """Text of a course file that M07 has processed; long files only the relevant pages."""
    item = await call(ctx, "files.item.get", {"item_id": item_id})
    status = item.get("doc_status")
    if status in ("pending", "processing", "queued"):
        raise NotReady
    if status != "ready":
        raise AppError("import.file_unsupported", 422, filename=item.get("display_name"))
    count = int(item.get("page_count") or 0)
    wanted: Sequence[tuple[int, int]] = [(1, MAX_READ_PAGES)]
    if count > MAX_READ_PAGES:
        pages: set[int] = set()
        for query in SEARCH_QUERIES:
            found = await call(
                ctx,
                "files.document.search",
                {"program_id": program_id, "query": query, "item_ids": [item_id], "top_k": 8,
                 "mode": "keyword"},
            )  # fmt: skip
            for hit in found.get("results", []):
                for page in range(int(hit["page_from"]) - 1, int(hit["page_to"]) + 2):
                    if 1 <= page <= count:
                        pages.add(page)
        wanted = [(p, p) for p in sorted(pages)[:MAX_READ_PAGES]] or [(1, MAX_READ_PAGES)]
    out: list[ai.PageText] = []
    for start, end in wanted:
        read = await call(
            ctx, "files.document.read", {"item_id": item_id, "page_from": start, "page_to": end}
        )
        out += [ai.PageText(int(p["page_no"]), str(p["markdown"])) for p in read["pages"]]
    return out


async def read_attachment(ctx: Ctx, attachment_id: str) -> tuple[str, str, bytes]:
    """(file name, type, bytes) of a file attached to an assistant conversation (M12)."""
    try:
        attachments = importlib.import_module("semestra.modules.agent.attachments")
    except ImportError:
        raise AppError("import.file_unsupported", 422) from None
    row, data = await attachments.open_original(ctx, attachment_id)
    parse = _files("parse")
    mime = parse.detect(data, row.name).mime if parse is not None else row.mime
    return row.name, mime, data


async def move_to_course(
    ctx: Ctx, *, course_id: str, filename: str, chunks: AsyncIterator[bytes]
) -> str | None:
    """Stores an import upload as a file of the course (M07); None when M07 is not there."""
    service = _files("service")
    if service is None:
        return None
    row = await service.store_file(
        ctx, course_id=course_id, filename=filename, stream=chunks, source_kind="upload"
    )
    return str(row.id)
