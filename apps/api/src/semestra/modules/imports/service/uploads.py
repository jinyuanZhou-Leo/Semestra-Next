"""Files uploaded for an import (M08)."""

from collections.abc import AsyncIterator, Sequence

import anyio
from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.db import new_id
from semestra.core.errors import AppError, not_found
from semestra.core.storage import charge, delete_after_commit, discard_on_error, stage
from semestra.modules.imports import deps
from semestra.modules.imports.models import ImportsUpload
from semestra.modules.imports.schemas import (
    Upload,
)


async def store_upload(
    ctx: Ctx,
    *,
    filename: str,
    chunks: AsyncIterator[bytes],
    allowed: Sequence[str] | None = None,
) -> Upload:
    """Stores an import upload, cut off above the per-file limit or the quota left (imports
    count against the user's storage quota like course files). The type comes from the content;
    a type outside `allowed` is refused."""
    cap = ctx.settings.files_max_upload_bytes
    # The whole upload is kept for the type check: telling DOCX/XLSX/PPTX apart reads the zip's
    # central directory at the end of the file (uploads are capped at the upload size limit).
    staged = await stage(
        ctx,
        f"users/{ctx.user_id}/imports/{new_id()}",
        chunks,
        cap=cap,
        too_large=AppError("files.too_large", 413, max=cap),
        keep=True,
    )
    async with discard_on_error(ctx, [staged.key]):
        mime = await anyio.to_thread.run_sync(deps.detect_mime, staged.data, filename)
        if allowed is not None and mime not in allowed:
            raise AppError("import.file_unsupported", 415, filename=filename)
        upload = ImportsUpload(
            id=new_id(),
            user_id=ctx.user_id,
            storage_key=staged.key,
            filename=filename[:255] or "file",
            mime_type=mime,
            size_bytes=staged.stored.size,
            sha256=staged.stored.sha256,
            created_at=ctx.now,
        )
        ctx.db.add(upload)
        await charge(ctx)
    return Upload(
        id=upload.id, filename=upload.filename, mime_type=mime, size_bytes=staged.stored.size
    )


async def get_upload(ctx: Ctx, upload_id: str) -> ImportsUpload:
    upload = await ctx.db.get(ImportsUpload, upload_id)
    if upload is None or upload.user_id != ctx.user_id:
        raise not_found("upload", upload_id)
    return upload


async def delete_uploads(ctx: Ctx, uploads: Sequence[ImportsUpload]) -> None:
    keys = [u.storage_key for u in uploads]
    for upload in uploads:
        await ctx.db.delete(upload)
    delete_after_commit(ctx, keys)


async def session_uploads(ctx: Ctx, session_id: str) -> list[ImportsUpload]:
    return list(
        (
            await ctx.db.scalars(
                select(ImportsUpload).where(
                    ImportsUpload.user_id == ctx.user_id, ImportsUpload.session_id == session_id
                )
            )
        ).all()
    )
