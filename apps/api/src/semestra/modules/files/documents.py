"""Reading parsed documents (M07 §3.3), for M08's extraction and the agent."""

import json
import re

from pydantic import BaseModel
from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules.files import service
from semestra.modules.files.chunking import HEADING
from semestra.modules.files.models import FilesDocument, FilesDocumentPage, FilesItem
from semestra.modules.files.schemas import (
    MAX_READ_PAGES,
    READ_RESULT_BUDGET,
    Citation,
    DocumentOutline,
    DocumentPage,
    DocumentRead,
    OutlineEntry,
)


async def _active_document(ctx: Ctx, item_id: str) -> tuple[FilesItem, FilesDocument]:
    item = await service.get_item(ctx, item_id)
    if item.kind != "file":
        raise AppError("files.unsupported_type", 422)
    # While a file is processed again, or after that failed, the previous version is still the
    # active one: search returns it, so it must stay readable too.
    if item.active_document_id is None:
        if item.doc_status == "none":  # auto-indexing was off when it was added
            raise AppError("files.not_indexed", 409)
        raise AppError("files.not_ready", 409, doc_status=item.doc_status)
    document = await ctx.db.get(FilesDocument, item.active_document_id)
    if document is None:
        raise AppError("files.not_ready", 409, doc_status=item.doc_status)
    return item, document


async def read_document(
    ctx: Ctx, item_id: str, page_from: int, page_to: int | None
) -> DocumentRead:
    if page_to is not None and page_to < page_from:
        raise AppError(
            "common.validation", 422, errors=[{"loc": ["page_to"], "code": "before_page_from"}]
        )
    item, document = await _active_document(ctx, item_id)
    last = min(page_to or page_from + MAX_READ_PAGES - 1, page_from + MAX_READ_PAGES - 1)
    last = min(last, document.page_count)
    rows = (
        await ctx.db.scalars(
            select(FilesDocumentPage)
            .where(
                FilesDocumentPage.document_id == document.id,
                FilesDocumentPage.page_no >= page_from,
                FilesDocumentPage.page_no <= last,
            )
            .order_by(FilesDocumentPage.page_no)
        )
    ).all()
    pages = [
        DocumentPage(
            page_no=r.page_no,
            markdown=r.markdown,
            ocr_used=r.ocr_used,
            citation_id=f"{item.id}:p{r.page_no}-{r.page_no}",
        )
        for r in rows
    ]
    citations = [
        Citation(
            id=p.citation_id,
            title=item.display_name,
            item_id=item.id,
            page_from=p.page_no,
            page_to=p.page_no,
            snippet=_snippet(p.markdown),
        )
        for p in pages
    ]
    result = DocumentRead(
        item_id=item.id,
        display_name=item.display_name,
        page_count=document.page_count,
        pages=pages,
        next_page=last + 1 if last < document.page_count else None,
        citations=citations,
    )
    if ctx.surface != "http":
        # The assistant's results are cut at a fixed size: stop at a page boundary before that,
        # so next_page is the only paging it needs. The first page always comes back.
        used = _size(result.model_copy(update={"pages": [], "citations": []}))
        kept = 0
        for page, cited in zip(pages, citations, strict=True):
            used += _size(page) + _size(cited) + 2  # the two list separators
            if kept and used > READ_RESULT_BUDGET:
                break
            kept += 1
        if kept < len(pages):
            result.pages, result.citations = pages[:kept], citations[:kept]
            result.next_page = pages[kept].page_no
    return result


def _size(model: BaseModel) -> int:
    """Characters of a result as the assistant gets it (`agent/tools.py` serialize)."""
    return len(json.dumps(model.model_dump(mode="json"), ensure_ascii=False, separators=(",", ":")))


def _snippet(markdown: str) -> str:
    """The start of a page as plain text, for the citation's hover card."""
    plain = re.sub(r"\s+", " ", re.sub(r"[#*_`>|]", " ", markdown)).strip()
    return plain[:200] + ("…" if len(plain) > 200 else "")


async def outline(ctx: Ctx, item_id: str) -> DocumentOutline:
    item, document = await _active_document(ctx, item_id)
    rows = (
        await ctx.db.execute(
            select(FilesDocumentPage.page_no, FilesDocumentPage.markdown)
            .where(FilesDocumentPage.document_id == document.id)
            .order_by(FilesDocumentPage.page_no)
        )
    ).all()
    entries: list[OutlineEntry] = []
    for page_no, markdown in rows:
        fenced = False
        for line in markdown.split("\n"):
            if line.lstrip().startswith("```"):
                fenced = not fenced
            elif not fenced and (match := HEADING.match(line)):
                entries.append(OutlineEntry(level=len(match[1]), title=match[2], page=page_no))
    return DocumentOutline(
        item_id=item.id,
        display_name=item.display_name,
        page_count=document.page_count,
        entries=entries,
    )
