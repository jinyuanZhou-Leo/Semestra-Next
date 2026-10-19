"""Reading parsed documents (M07 §3.3), for M08's extraction and the agent."""

import re

from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules.files import service
from semestra.modules.files.models import FilesDocument, FilesDocumentPage, FilesItem
from semestra.modules.files.schemas import (
    MAX_READ_PAGES,
    DocumentOutline,
    DocumentPage,
    DocumentRead,
    OutlineEntry,
)

_HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")


async def _active_document(ctx: Ctx, item_id: str) -> tuple[FilesItem, FilesDocument]:
    item = await service.get_item(ctx, item_id)
    if item.kind != "file":
        raise AppError("files.unsupported_type", 422)
    if item.doc_status != "ready" or item.active_document_id is None:
        raise AppError("files.not_ready", 409, doc_status=item.doc_status)
    document = await ctx.db.get(FilesDocument, item.active_document_id)
    if document is None:
        raise AppError("files.not_ready", 409, doc_status=item.doc_status)
    return item, document


async def read_document(
    ctx: Ctx, item_id: str, page_from: int, page_to: int | None
) -> DocumentRead:
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
    return DocumentRead(
        item_id=item.id,
        display_name=item.display_name,
        page_count=document.page_count,
        pages=[
            DocumentPage(page_no=r.page_no, markdown=r.markdown, ocr_used=r.ocr_used) for r in rows
        ],
        next_page=last + 1 if last < document.page_count else None,
    )


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
            elif not fenced and (match := _HEADING.match(line)):
                entries.append(OutlineEntry(level=len(match[1]), title=match[2], page=page_no))
    return DocumentOutline(
        item_id=item.id,
        display_name=item.display_name,
        page_count=document.page_count,
        entries=entries,
    )
