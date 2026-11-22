"""The file content proxy (M09 §5): streams an LMS file for preview and download."""

from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response, StreamingResponse

from semestra.core.context import Ctx, get_ctx, run_after_commit
from semestra.modules.files import sources
from semestra.modules.lms import announcements, assignment, files, reads, refs, service
from semestra.modules.lms.schemas.dto import FileMeta

router = APIRouter(tags=["lms"])

# Types a browser may render inline; anything else is a download (no HTML from the LMS origin).
INLINE = ("application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp", "text/plain")


def _headers(name: str, mime: str, size: int | None, download: bool) -> tuple[str, dict[str, str]]:
    inline = not download and mime in INLINE
    disposition = "inline" if inline else "attachment"
    headers = {
        "Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(name)}",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
        "Cache-Control": "private, max-age=300",
    }
    if size is not None:
        headers["Content-Length"] = str(size)
    return (mime if inline else "application/octet-stream"), headers


async def _stream(
    ctx: Ctx, course_id: str, meta: FileMeta | None, file_id: str, download: bool, check: bool
) -> Response:
    meta, chunks = await reads.open_file(ctx, course_id, file_id, meta=meta)
    if check:
        # The first chunk is already read; closing the stream stops the transfer from the LMS.
        await anext(chunks, None)
        await chunks.aclose()  # pyright: ignore[reportAttributeAccessIssue]
    # End the transaction before streaming (the connection is not held while the file flows);
    # what the read cached is stored after it.
    await ctx.db.commit()
    await run_after_commit(ctx)
    if check:
        return Response(status_code=204)
    media, headers = _headers(
        meta.name, meta.mime_type or "application/octet-stream", meta.size_bytes, download
    )
    return StreamingResponse(chunks, media_type=media, headers=headers)


async def _kept_copy(
    ctx: Ctx, course_id: str, file_id: str, download: bool, check: bool
) -> Response | None:
    """A file the course files keep a current local copy of opens from that copy, without
    asking the platform."""
    link, _ = await service.require_link(ctx, course_id)
    item = await files.course_item(ctx, link, refs.make("file", file_id))
    chunks = sources.current_copy(ctx, item) if item is not None else None
    if item is None or chunks is None:
        return None
    if check:
        return Response(status_code=204)
    media, headers = _headers(
        item.display_name, item.mime_type or "application/octet-stream", item.size_bytes, download
    )
    await ctx.db.commit()
    return StreamingResponse(chunks, media_type=media, headers=headers)


Download = Annotated[bool, Query(description="Send as an attachment")]
Check = Annotated[
    bool, Query(description="Only check that the file opens (204, or the same errors)")
]


@router.get(
    "/courses/{course_id}/lms/files/{file_id}/content",
    operation_id="lmsFileContent",
    response_class=StreamingResponse,
)
async def file_content(
    course_id: str,
    file_id: str,
    ctx: Annotated[Ctx, Depends(get_ctx)],
    download: Download = False,
    check: Check = False,
) -> Response:
    if (kept := await _kept_copy(ctx, course_id, file_id, download, check)) is not None:
        return kept
    # An announcement's attachment opens from the address the announcement gave.
    known = await announcements.attachment_meta(ctx, course_id, file_id)
    return await _stream(ctx, course_id, known, file_id, download, check)


@router.get(
    "/courses/{course_id}/lms/assignments/{assignment_id}/submission/files/{file_id}/content",
    operation_id="lmsSubmittedFileContent",
    response_class=StreamingResponse,
)
async def submitted_file_content(
    course_id: str,
    assignment_id: str,
    file_id: str,
    ctx: Annotated[Ctx, Depends(get_ctx)],
    download: Download = False,
) -> Response:
    """A file the user handed in for an assignment (M09 §5)."""
    meta = await assignment.submitted_file(ctx, course_id, assignment_id, file_id)
    return await _stream(ctx, course_id, meta, file_id, download, False)
