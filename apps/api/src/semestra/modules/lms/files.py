"""Saving LMS files into the course's files (M09 §5 → M07 `save_bytes_as_file`), and reading
their text with M07's parser for previews."""

from datetime import timedelta

import anyio.to_thread
from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules.files import service as files
from semestra.modules.files.parse import ParseError, detect, parse
from semestra.modules.files.parse.isolated import Parsed, parse_isolated
from semestra.modules.lms import cache, reads, service
from semestra.modules.lms.errors import lms_error
from semestra.modules.lms.models import LmsImportedRef
from semestra.modules.lms.schemas.io import FilePreview, FileSaveInput, SavedFile
from semestra.modules.lms.sync_files import ITEM, file_version, source_ref


async def save_to_course(ctx: Ctx, inp: FileSaveInput) -> SavedFile:
    """A copy of the file in the course's files, stored here. Once per file: a file the course's
    files have already is that item, and one the sync brought in (read from the platform when
    opened) is stored in place, in the background."""
    link, _ = linked = await service.require_link(ctx, inp.course_id)
    ref = await ctx.db.scalar(
        select(LmsImportedRef).where(
            LmsImportedRef.link_id == link.id,
            LmsImportedRef.external_kind == "file",
            LmsImportedRef.external_id == inp.file_id,
        )
    )
    found = await files.find_items(ctx, [ref.target_id]) if ref and ref.target_id else []
    if found:
        await files.keep_offline(ctx, found)
        return SavedFile(file_item_id=found[0].id, name=found[0].display_name)
    meta, stream = await reads.open_file(ctx, inp.course_id, inp.file_id, linked=linked)
    item = await files.save_bytes_as_file(
        ctx,
        inp.course_id,
        meta.name,
        stream,
        source_kind="lms",
        source_ref=source_ref("file", inp.file_id),
        folder_id=inp.folder_id,
    )
    if ref is None:
        ref = LmsImportedRef(
            user_id=ctx.user_id, link_id=link.id, external_kind="file", external_id=inp.file_id
        )
        ctx.db.add(ref)
    # The sync leaves a saved copy as it is (and does not bring the file in again).
    ref.target_kind, ref.target_id, ref.imported_at, ref.dismissed_at = ITEM, item.id, ctx.now, None
    ref.snapshot = {"version": file_version(meta), "name": item.display_name}
    await ctx.db.flush()
    return SavedFile(file_item_id=str(item.id), name=str(item.display_name))


# Formats whose readers run third-party C code or inflate archives: parsed in a child process
# with time and memory limits, like M07 and chat attachments do.
ISOLATED_KINDS = ("pdf", "docx", "pptx", "xlsx")
PREVIEW_KINDS = ("pdf", "docx", "pptx", "xlsx", "csv", "html", "text", "markdown")
PREVIEW_MAX_PAGES = 200
PREVIEW_TIME_LIMIT = 60.0
# The key names the file's version, so a preview stays right until the file changes.
PREVIEW_TTL = timedelta(days=7)


async def preview(ctx: Ctx, course_id: str, file_id: str, refresh: bool) -> FilePreview:
    """The text of an LMS file, page by page, as M07's parser reads it: Word, PowerPoint and
    Excel files are previewed this way (the app has no Office renderer), and the assistant can
    read a file without saving it into the course first. Cached per file version."""
    link, b = linked = await service.require_link(ctx, course_id)
    meta = await reads.file(ctx, course_id, file_id, refresh, linked=linked)
    params = {
        "course": link.external_course_id,
        "file": file_id,
        "updated": meta.updated_at.isoformat() if meta.updated_at else None,
    }
    key = cache.cache_key(ctx.user_id, b.row.id, "file_preview", params)
    if not refresh and (hit := await cache.get(ctx, key)) is not None:
        return FilePreview.model_validate(hit["data"])

    limit = ctx.settings.files_max_upload_bytes
    if meta.size_bytes is not None and meta.size_bytes > limit:
        raise lms_error("lms.file_too_large", limit=limit)
    _, stream = await reads.open_file(ctx, course_id, file_id, meta=meta, linked=linked)
    data = bytearray()
    async for chunk in stream:
        data += chunk
        if len(data) > limit:
            await stream.aclose()  # pyright: ignore[reportAttributeAccessIssue]
            raise lms_error("lms.file_too_large", limit=limit)
    detected = detect(bytes(data), meta.name)
    if detected.kind not in PREVIEW_KINDS:
        raise AppError("files.unsupported_type", 422)
    try:
        if detected.kind in ISOLATED_KINDS:
            document = None
            async for message in parse_isolated(
                bytes(data),
                detected,
                max_pages=PREVIEW_MAX_PAGES + 1,
                thumbnail_pages=0,
                time_limit=min(ctx.settings.files_parse_timeout_seconds, PREVIEW_TIME_LIMIT),
                memory_limit=ctx.settings.files_parse_memory_bytes,
            ):
                if isinstance(message, Parsed):
                    document = message.document
            if document is None:
                raise ParseError("files.parse_failed")
        else:
            raw = bytes(data)
            document = await anyio.to_thread.run_sync(
                lambda: parse(raw, detected, max_pages=PREVIEW_MAX_PAGES + 1)
            )
    except ParseError as exc:
        raise AppError(exc.code, 422) from None
    out = FilePreview(
        name=meta.name,
        mime_type=detected.mime,
        kind=detected.kind,
        # One page more than shown is read, so a file of exactly the limit is not "truncated".
        pages=[p.markdown for p in document.pages[:PREVIEW_MAX_PAGES]],
        truncated=len(document.pages) > PREVIEW_MAX_PAGES,
    )
    await cache.put(
        ctx,
        key,
        b.row.id,
        {"data": out.model_dump(mode="json"), "truncated": False},
        # The key names the file's version, so "Refresh" has nothing to renew here.
        ttl=PREVIEW_TTL,
    )
    return out
