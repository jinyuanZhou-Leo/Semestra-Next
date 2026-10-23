"""The file content proxy (M09 §5): streams an LMS file for preview and download."""

from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse

from semestra.core.context import Ctx, get_ctx, run_after_commit
from semestra.modules.lms import reads

router = APIRouter(tags=["lms"])

# Types a browser may render inline; anything else is a download (no HTML from the LMS origin).
INLINE = ("application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp", "text/plain")


@router.get(
    "/courses/{course_id}/lms/files/{file_id}/content",
    operation_id="lmsFileContent",
    response_class=StreamingResponse,
)
async def file_content(
    course_id: str,
    file_id: str,
    ctx: Annotated[Ctx, Depends(get_ctx)],
    download: Annotated[bool, Query(description="Send as an attachment")] = False,
) -> StreamingResponse:
    meta, chunks = await reads.open_file(ctx, course_id, file_id)
    # End the transaction before streaming (the connection is not held while the file flows);
    # what the read cached is stored after it.
    await ctx.db.commit()
    await run_after_commit(ctx)
    mime = meta.mime_type or "application/octet-stream"
    inline = not download and mime in INLINE
    disposition = "inline" if inline else "attachment"
    headers = {
        "Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(meta.name)}",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
        "Cache-Control": "private, max-age=300",
    }
    if meta.size_bytes is not None:
        headers["Content-Length"] = str(meta.size_bytes)
    return StreamingResponse(
        chunks, media_type=mime if inline else "application/octet-stream", headers=headers
    )
