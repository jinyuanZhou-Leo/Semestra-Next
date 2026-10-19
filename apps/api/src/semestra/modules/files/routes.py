"""Upload, download and page images (M07 §5): routes that are not capabilities."""

import re
from collections.abc import AsyncIterator
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, Path, Query, Request, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import select

from semestra.core.context import Ctx, get_ctx, run_after_commit
from semestra.core.errors import AppError, ErrorResponse, not_found
from semestra.core.storage import CHUNK_SIZE, get_storage, remaining_quota
from semestra.modules.files import service
from semestra.modules.files.models import FilesDocumentPage
from semestra.modules.files.parse.detect import INLINE_SAFE
from semestra.modules.files.schemas import UploadResult
from semestra.modules.files.upload import MAX_FILES_PER_REQUEST

router = APIRouter(tags=["files"])
CurrentCtx = Annotated[Ctx, Depends(get_ctx)]
_RANGE = re.compile(r"bytes=(\d*)-(\d*)")


async def _read(file: UploadFile) -> AsyncIterator[bytes]:
    while chunk := await file.read(CHUNK_SIZE):
        yield chunk


@router.post(
    "/courses/{course_id}/files",
    operation_id="filesUpload",
    response_model=UploadResult,
    responses={"default": {"model": ErrorResponse}},
    summary="Upload one or more files into a course.",
)
async def upload(
    course_id: Annotated[str, Path(description="Course id")],
    files: Annotated[list[UploadFile], File(description="The files to upload")],
    ctx: CurrentCtx,
    folder_id: Annotated[str | None, Form(description="Folder to put them in")] = None,
) -> UploadResult:
    """All or nothing: if one file is refused (too large, over quota) none is kept."""
    if not files or len(files) > MAX_FILES_PER_REQUEST:
        raise AppError("common.validation", 422, errors=[{"loc": ["files"], "code": "count"}])
    folder = folder_id or None
    await service.check_upload_target(ctx, course_id, folder)
    storage = get_storage(ctx)
    staged: list[service.StagedFile] = []
    try:
        # Every file is in storage before the first row is written, so the database's write
        # lock is held only for the inserts, not while the bytes arrive.
        budget = await remaining_quota(ctx)
        for file in files:
            staged.append(
                await service.stage_file(
                    ctx, filename=file.filename, stream=_read(file), budget=budget
                )
            )
            if budget is not None:
                budget -= staged[-1].stored.size
        rows = await service.add_staged_files(ctx, course_id, folder, staged)
        result = UploadResult(items=await service.item_outs(ctx, rows))
        await ctx.db.commit()
    except BaseException:
        await ctx.db.rollback()
        for file in staged:
            await storage.delete(file.stored.key)
        raise
    await run_after_commit(ctx)
    return result


def _content_disposition(disposition: str, name: str) -> str:
    ascii_name = re.sub(r'[^\x20-\x7e]|["\\]', "_", name) or "file"
    return f"{disposition}; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(name, safe='')}"


def _byte_range(header: str | None, size: int) -> tuple[int, int] | None:
    """`(start, end)` inclusive for a single `bytes=` range; None means the whole file."""
    if not header:
        return None
    match = _RANGE.fullmatch(header.strip())
    if match is None or (not match[1] and not match[2]):
        return None
    if not match[1]:  # the last N bytes
        length = int(match[2])
        if length == 0 or size == 0:
            raise AppError("common.validation", 416, errors=[{"loc": ["range"], "code": "range"}])
        return max(0, size - length), size - 1
    start = int(match[1])
    end = min(int(match[2]), size - 1) if match[2] else size - 1
    if start >= size or end < start:
        raise AppError("common.validation", 416, errors=[{"loc": ["range"], "code": "range"}])
    return start, end


@router.get(
    "/files/{item_id}/content",
    operation_id="filesContent",
    response_class=StreamingResponse,
    responses={200: {"content": {"application/octet-stream": {}}}, 206: {}},
    summary="Download or preview a file; supports Range requests.",
)
async def content(
    item_id: Annotated[str, Path(description="File id")],
    request: Request,
    ctx: CurrentCtx,
    disposition: Annotated[
        str,
        Query(pattern="^(inline|attachment)$", description="inline previews, attachment downloads"),
    ] = "attachment",
) -> StreamingResponse:
    item = await service.get_item(ctx, item_id)
    if item.kind != "file" or not item.storage_key:
        raise not_found()
    mime = item.mime_type or "application/octet-stream"
    # Anything a browser could run (HTML, SVG, ...) is only ever offered as a download.
    shown = "inline" if disposition == "inline" and mime in INLINE_SAFE else "attachment"
    span = _byte_range(request.headers.get("range"), item.size_bytes)
    headers = {
        "Content-Disposition": _content_disposition(shown, item.display_name),
        "Accept-Ranges": "bytes",
        "ETag": f'"{item.sha256}"',
        "Cache-Control": "private, no-cache",
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "same-site",
    }
    # Text is shown sandboxed. Browsers refuse to run their PDF viewer in a sandboxed document,
    # and a PDF or image cannot run script of its own, so those only lose the sandbox.
    if mime == "application/pdf":
        pass
    elif mime.startswith("image/"):
        headers["Content-Security-Policy"] = "default-src 'none'"
    else:
        headers["Content-Security-Policy"] = "sandbox; default-src 'none'"
    start, end = span if span else (0, max(item.size_bytes - 1, 0))
    length = end - start + 1 if item.size_bytes else 0
    headers["Content-Length"] = str(length)
    if span:
        headers["Content-Range"] = f"bytes {start}-{end}/{item.size_bytes}"
    stream = get_storage(ctx).open(item.storage_key, start=start, length=length)
    return StreamingResponse(
        stream, status_code=206 if span else 200, media_type=mime, headers=headers
    )


@router.get(
    "/files/{item_id}/pages/{page}.png",
    operation_id="filesPageImage",
    response_class=StreamingResponse,
    responses={200: {"content": {"image/png": {}}}},
    summary="A small image of one page of a processed file.",
)
async def page_image(
    item_id: Annotated[str, Path(description="File id")],
    page: Annotated[int, Path(ge=1, description="Page number, starting at 1")],
    ctx: CurrentCtx,
) -> StreamingResponse:
    item = await service.get_item(ctx, item_id)
    if item.active_document_id is None:
        raise not_found()
    key = await ctx.db.scalar(
        select(FilesDocumentPage.image_storage_key).where(
            FilesDocumentPage.document_id == item.active_document_id,
            FilesDocumentPage.page_no == page,
        )
    )
    if not key:
        raise not_found()
    return StreamingResponse(
        get_storage(ctx).open(key),
        media_type="image/png",
        headers={
            "Cache-Control": "private, max-age=3600",
            "X-Content-Type-Options": "nosniff",
            "Cross-Origin-Resource-Policy": "same-site",
        },
    )
