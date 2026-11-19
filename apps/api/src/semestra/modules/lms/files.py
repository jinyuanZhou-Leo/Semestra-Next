"""Saving LMS files into the course's files (M09 §5 → M07 `sources`), and reading
their text with M07's parser for previews."""

from datetime import timedelta

import anyio.to_thread
from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules.files import sources
from semestra.modules.files.parse import ParseError, detect, parse
from semestra.modules.files.parse.isolated import Parsed, parse_isolated
from semestra.modules.lms import cache, reads, service
from semestra.modules.lms.errors import lms_error
from semestra.modules.lms.models import LmsCourseLink, LmsMaterial
from semestra.modules.lms.schemas.dto import FileMeta
from semestra.modules.lms.schemas.io import FilePreview, FileSaveInput, SavedFile
from semestra.modules.lms.service import Bound
from semestra.modules.lms.sync_files import enter, file_version, source_ref


async def save_to_course(ctx: Ctx, inp: FileSaveInput) -> SavedFile:
    """The file in the course's files with a local copy, following the platform like the
    materials the sync brings in (`sync_files.py`). Once per file: one the course's files have
    already keeps a local copy (stored by a job: `stored` false until it has run)."""
    link, b = linked = await service.require_link(ctx, inp.course_id)
    mat = await ctx.db.scalar(
        select(LmsMaterial).where(
            LmsMaterial.link_id == link.id,
            LmsMaterial.kind == "file",
            LmsMaterial.external_id == inp.file_id,
        )
    )
    synced = mat is not None and mat.state == "synced" and mat.item_id
    found = await sources.find_items(ctx, [mat.item_id]) if synced and mat and mat.item_id else []
    if found:
        await sources.keep_copy(ctx, found[0])
        return SavedFile(
            file_item_id=found[0].id,
            name=found[0].display_name,
            stored=bool(found[0].storage_key),
        )
    meta, stream = await reads.open_file(ctx, inp.course_id, inp.file_id, linked=linked)
    item = await sources.save_bytes_as_file(
        ctx,
        inp.course_id,
        meta.name,
        stream,
        source_kind="lms",
        source_ref=source_ref("file", inp.file_id),
        folder_id=inp.folder_id,
        source_name=b.provider.display_name,
        keep_copy=True,
        modified_at=meta.content_at or meta.updated_at,
    )
    if mat is None:
        mat = LmsMaterial(
            user_id=ctx.user_id, link_id=link.id, kind="file", external_id=inp.file_id
        )
        ctx.db.add(mat)
    # The sync follows it from now on, and does not bring the file in again.
    enter(mat, "synced", ctx.now, item_id=item.id)
    mat.title, mat.version, mat.name = meta.name, file_version(meta), item.display_name
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

    data = await download(ctx, course_id, file_id, meta=meta, linked=linked)
    detected = detect(data, meta.name)
    if detected.kind not in PREVIEW_KINDS:
        raise AppError("files.unsupported_type", 422)
    try:
        if detected.kind in ISOLATED_KINDS:
            document = None
            async for message in parse_isolated(
                data,
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
            document = await anyio.to_thread.run_sync(
                lambda: parse(data, detected, max_pages=PREVIEW_MAX_PAGES + 1)
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


async def download(
    ctx: Ctx,
    course_id: str,
    file_id: str,
    *,
    meta: FileMeta | None = None,
    linked: tuple[LmsCourseLink, Bound] | None = None,
) -> bytes:
    """The whole file, at most the upload limit (`lms.file_too_large` beyond it): for previews
    and for the assistant to look at its pages."""
    linked = linked or await service.require_link(ctx, course_id)
    meta = meta or await reads.file(ctx, course_id, file_id, False, linked=linked)
    limit = ctx.settings.files_max_upload_bytes
    if meta.size_bytes is not None and meta.size_bytes > limit:
        raise lms_error("lms.file_too_large", limit=limit)
    _, stream = await reads.open_file(ctx, course_id, file_id, meta=meta, linked=linked)
    data = bytearray()
    try:
        async for chunk in stream:
            data += chunk
            if len(data) > limit:
                raise lms_error("lms.file_too_large", limit=limit)
    finally:
        await stream.aclose()  # pyright: ignore[reportAttributeAccessIssue]
    return bytes(data)
