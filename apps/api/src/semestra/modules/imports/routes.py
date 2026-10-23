"""File routes of imports: upload before a course exists, and read it back for "show source"."""

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, Path, UploadFile
from fastapi.responses import StreamingResponse

from semestra.core.config import Settings
from semestra.core.context import Ctx, get_ctx, run_after_commit
from semestra.core.errors import AppError, ErrorResponse
from semestra.core.storage import CHUNK_SIZE, get_storage
from semestra.core.uploads import limit_upload
from semestra.modules.imports import service
from semestra.modules.imports.schemas import Upload

router = APIRouter(tags=["imports"])


def _upload_limit(settings: Settings) -> tuple[int, AppError]:
    """One file per upload, at most the per-file limit (checked before the body is parsed)."""
    cap = settings.files_max_upload_bytes
    return cap, AppError("files.too_large", 413, max=cap)


limit_upload("/imports/uploads", _upload_limit)


ALLOWED = (
    "text/calendar",
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
    "text/markdown",
    "text/html",
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "image/heic",
)


INLINE_UNSANDBOXED = ("application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif")


async def _chunks(file: UploadFile) -> AsyncIterator[bytes]:
    while chunk := await file.read(CHUNK_SIZE):
        yield chunk


@router.post(
    "/imports/uploads",
    operation_id="importsUploadCreate",
    response_model=Upload,
    responses={"default": {"model": ErrorResponse}},
    summary="Upload a file for an import (ICS, syllabus, timetable screenshot), up to 25 MB.",
)
async def upload_create(file: UploadFile, ctx: Annotated[Ctx, Depends(get_ctx)]) -> Upload:
    upload = await service.store_upload(
        ctx, filename=file.filename or "file", chunks=_chunks(file), allowed=ALLOWED
    )
    await ctx.db.commit()
    await run_after_commit(ctx)
    return upload


@router.get(
    "/imports/uploads/{upload_id}/content",
    operation_id="importsUploadContent",
    response_class=StreamingResponse,
    responses={200: {"content": {"application/octet-stream": {}}}},
    summary="The uploaded file, shown inline (evidence preview).",
)
async def upload_content(
    upload_id: Annotated[str, Path(min_length=1, max_length=64)],
    ctx: Annotated[Ctx, Depends(get_ctx)],
) -> StreamingResponse:
    upload = await service.get_upload(ctx, upload_id)
    headers = {
        "Content-Disposition": "inline",
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
    }
    # Uploaded HTML and text must not run as our origin. PDFs and images are left out: browsers'
    # PDF viewers don't render under a sandbox CSP, and neither format runs page scripts.
    if upload.mime_type not in INLINE_UNSANDBOXED:
        headers["Content-Security-Policy"] = "sandbox"
    return StreamingResponse(
        get_storage(ctx).open(upload.storage_key), media_type=upload.mime_type, headers=headers
    )
