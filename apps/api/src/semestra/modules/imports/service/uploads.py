"""Files uploaded for an import (M08)."""

from collections.abc import AsyncIterator, Sequence

import anyio
from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.db import new_id
from semestra.core.errors import AppError, not_found
from semestra.core.storage import get_storage, remaining_quota
from semestra.core.storage import usage as storage_usage
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
    budget = await remaining_quota(ctx)
    if budget is not None and budget <= 0:
        raise await _quota_error(ctx)
    key = f"users/{ctx.user_id}/imports/{new_id()}"
    # The whole upload is kept for the type check: telling DOCX/XLSX/PPTX apart reads the zip's
    # central directory at the end of the file (uploads are capped at the upload size limit).
    seen = bytearray()

    async def kept() -> AsyncIterator[bytes]:
        async for chunk in chunks:
            seen.extend(chunk)
            yield chunk

    storage = get_storage(ctx)
    try:
        stored = await storage.put(
            key, kept(), "application/octet-stream",
            max_bytes=cap if budget is None else min(cap, budget),
        )  # fmt: skip
    except AppError as exc:
        if exc.code != "common.quota_exceeded":
            raise
        if budget is None or cap <= budget:
            raise AppError("files.too_large", 413, max=cap) from None
        raise await _quota_error(ctx) from None
    mime = await anyio.to_thread.run_sync(deps.detect_mime, bytes(seen), filename)
    if allowed is not None and mime not in allowed:
        await storage.delete(stored.key)
        raise AppError("import.file_unsupported", 415, filename=filename)
    upload = ImportsUpload(
        id=new_id(),
        user_id=ctx.user_id,
        storage_key=stored.key,
        filename=filename[:255] or "file",
        mime_type=mime,
        size_bytes=stored.size,
        sha256=stored.sha256,
        created_at=ctx.now,
    )
    ctx.db.add(upload)
    await ctx.db.flush()
    return Upload(id=upload.id, filename=upload.filename, mime_type=mime, size_bytes=stored.size)


async def _quota_error(ctx: Ctx) -> AppError:
    current = await storage_usage(ctx)
    return AppError(
        "common.quota_exceeded", 413, used=current.used_bytes, quota=current.quota_bytes
    )


async def get_upload(ctx: Ctx, upload_id: str) -> ImportsUpload:
    upload = await ctx.db.get(ImportsUpload, upload_id)
    if upload is None or upload.user_id != ctx.user_id:
        raise not_found("upload", upload_id)
    return upload


async def _delete_uploads(ctx: Ctx, uploads: Sequence[ImportsUpload]) -> None:
    keys = [u.storage_key for u in uploads]
    for upload in uploads:
        await ctx.db.delete(upload)
    _after_commit_delete(ctx, keys)


def _after_commit_delete(ctx: Ctx, keys: Sequence[str]) -> None:
    """Stored objects go once the transaction has committed, so a rollback never loses one."""
    storage = get_storage(ctx)

    async def _remove() -> None:
        for key in keys:
            await storage.delete(key)

    ctx.after_commit.append(_remove)


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
