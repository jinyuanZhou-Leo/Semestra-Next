"""Adding and changing course files (M07 §2): uploads (staged before any database write),
files other modules save, links, renaming and moving one item, reading it again."""

import re
from collections.abc import AsyncIterable, Sequence
from dataclasses import dataclass
from datetime import datetime
from urllib.parse import urlsplit, urlunsplit

import anyio
from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.db import new_id
from semestra.core.errors import AppError
from semestra.core.events import events
from semestra.core.storage import StoredObject, charge, discard_on_error, get_storage, stage
from semestra.modules.academics import service as academics
from semestra.modules.files import content, folders, service
from semestra.modules.files.models import FilesItem
from semestra.modules.files.parse import detect
from semestra.modules.files.schemas import ItemOut, ItemUpdateInput, SourceKind
from semestra.modules.files.settings import auto_index


async def check_upload_target(ctx: Ctx, course_id: str, folder_id: str | None) -> None:
    await academics.get_course_row(ctx, course_id)
    await folders.check_in_course(ctx, course_id, folder_id)


@dataclass(frozen=True)
class StagedFile:
    """Bytes already in storage, not yet in the database (see `stage_file`)."""

    item_id: str
    name: str
    stored: StoredObject
    mime: str
    supported: bool


async def stage_file(
    ctx: Ctx, *, filename: str | None, stream: AsyncIterable[bytes], reserved: int = 0
) -> StagedFile:
    """Writes one upload to storage, cut off above the per-file limit or the quota left after
    `reserved` bytes this request already staged. No database write happens here, so no write
    lock is held while the bytes arrive; `add_staged_files` makes the rows."""
    cap = ctx.settings.files_max_upload_bytes
    item_id = new_id()
    staged = await stage(
        ctx,
        service.storage_key(ctx.user_id, item_id),
        stream,
        cap=cap,
        too_large=AppError("files.too_large", 413, max=cap),
        reserved=reserved,
        keep=True,
    )
    name = service.safe_name(filename)
    async with discard_on_error(ctx, [staged.key]):
        detected = await anyio.to_thread.run_sync(detect, staged.data, name)
    return StagedFile(
        item_id, name, staged.stored, detected.mime, detected.kind in service.PARSEABLE
    )


async def add_staged_files(
    ctx: Ctx,
    course_id: str,
    folder_id: str | None,
    staged: Sequence[StagedFile],
    source_kind: SourceKind = "upload",
    source_ref: str | None = None,
) -> list[FilesItem]:
    """Creates the rows for staged files and checks the quota again with them counted
    (`charge`). Nothing is committed here; on error the staged bytes are deleted."""
    async with discard_on_error(ctx, [file.stored.key for file in staged]):
        rows = [
            FilesItem(
                id=file.item_id,
                user_id=ctx.user_id,
                course_id=course_id,
                folder_id=folder_id,
                kind="file",
                display_name=file.name,
                original_name=file.name,
                mime_type=file.mime,
                size_bytes=file.stored.size,
                sha256=file.stored.sha256,
                storage_key=file.stored.key,
                source_kind=source_kind,
                source_ref=source_ref,
                doc_status="pending" if file.supported else "unsupported",
                doc_error_code=None if file.supported else "files.unsupported_type",
                created_at=ctx.now,
                updated_at=ctx.now,
            )
            for file in staged
        ]
        ctx.db.add_all(rows)
        await charge(ctx)
    # With auto-indexing off, supported files wait as "none" until the user (or an import that
    # needs the text) asks for them to be read.
    if any(row.doc_status == "pending" for row in rows) and not await auto_index(ctx, course_id):
        for row in rows:
            if row.doc_status == "pending":
                row.doc_status = "none"
    for row in rows:
        if row.doc_status == "pending":
            await service.enqueue_processing(ctx, row)
        await events.publish(ctx, "files.item.created", {"item_id": row.id, "course_id": course_id})
    return rows


async def find_same_bytes(ctx: Ctx, course_id: str, sha256: str) -> FilesItem | None:
    """A file of the course with exactly these bytes kept here. A file that follows its source
    carries the source's version instead of a hash of its bytes, so it never matches."""
    return await ctx.db.scalar(
        select(FilesItem)
        .where(
            FilesItem.user_id == ctx.user_id,
            FilesItem.course_id == course_id,
            FilesItem.kind == "file",
            FilesItem.storage_key.is_not(None),
            FilesItem.sha256 == sha256,
        )
        .limit(1)
    )


async def store_file(
    ctx: Ctx,
    *,
    course_id: str,
    filename: str | None,
    stream: AsyncIterable[bytes],
    folder_id: str | None = None,
    source_kind: SourceKind = "upload",
    source_ref: str | None = None,
) -> FilesItem:
    """Saves one file into a course and queues its processing. A file above the per-file limit
    or the user's remaining quota is refused, and nothing is left behind. Nothing is committed
    here."""
    await check_upload_target(ctx, course_id, folder_id)
    staged = await stage_file(ctx, filename=filename, stream=stream)
    [row] = await add_staged_files(ctx, course_id, folder_id, [staged], source_kind, source_ref)
    return row


async def save_bytes_as_file(
    ctx: Ctx,
    course_id: str,
    name: str,
    stream: AsyncIterable[bytes],
    source_kind: SourceKind,
    source_ref: str | None = None,
    folder_id: str | None = None,
    *,
    source_name: str | None = None,
    keep_copy: bool | None = None,
    modified_at: datetime | None = None,
) -> ItemOut:
    """For other modules (M09 saves Canvas files, M12 files the agent generates). With a
    `source_ref` its source keeps (`content.py`) the file follows that source with this local
    copy (`keep_copy`: the user asked for one); without, it is a plain file."""
    row = await store_file(
        ctx,
        course_id=course_id,
        filename=name,
        stream=stream,
        folder_id=folder_id,
        source_kind=source_kind,
        source_ref=source_ref,
    )
    if source_ref is not None:
        row.source_name, row.keep_copy = source_name, keep_copy
        row.copy_version = row.sha256
        row.source_modified_at = modified_at
        await ctx.db.flush()
    return await service.item_out(ctx, row)


def normalize_url(url: str) -> str:
    candidate = url.strip()
    if re.search(r"[\s\\]", candidate):  # browsers rewrite these, so what is shown != opened
        raise AppError("files.invalid_url", 422)
    if "://" not in candidate and not re.match(r"^[a-z][a-z0-9+.-]*:(?!\d)", candidate, re.I):
        candidate = f"https://{candidate}"
    parts = urlsplit(candidate)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise AppError("files.invalid_url", 422)
    return urlunsplit(parts)


async def create_link(
    ctx: Ctx,
    course_id: str,
    url: str,
    display_name: str | None,
    folder_id: str | None,
    *,
    source_kind: SourceKind | None = None,
    source_ref: str | None = None,
    source_name: str | None = None,
) -> ItemOut:
    await academics.get_course_row(ctx, course_id)
    await folders.check_in_course(ctx, course_id, folder_id)
    clean = normalize_url(url)
    host = urlsplit(clean).hostname or clean
    row = FilesItem(
        user_id=ctx.user_id,
        course_id=course_id,
        folder_id=folder_id,
        kind="link",
        display_name=service.clean_name(display_name) if display_name else host,
        url=clean,
        source_kind=source_kind,
        source_ref=source_ref,
        source_name=source_name if source_ref else None,
        doc_status="none",
        created_at=ctx.now,
        updated_at=ctx.now,
    )
    ctx.db.add(row)
    await ctx.db.flush()
    await events.publish(ctx, "files.item.created", {"item_id": row.id, "course_id": course_id})
    return await service.item_out(ctx, row)


async def check_item_update(ctx: Ctx, inp: ItemUpdateInput) -> None:
    sent = inp.model_fields_set
    service.refuse_none(
        [f for f in ("display_name", "pinned") if f in sent and getattr(inp, f) is None]
    )


async def update_item(ctx: Ctx, inp: ItemUpdateInput) -> ItemOut:
    await check_item_update(ctx, inp)
    sent = inp.model_fields_set
    row = await service.get_item(ctx, inp.item_id)
    if "display_name" in sent and inp.display_name is not None:
        row.display_name = service.clean_name(inp.display_name)
    if "folder_id" in sent:
        await folders.check_in_course(ctx, row.course_id, inp.folder_id)
        row.folder_id = inp.folder_id
    if "pinned" in sent and inp.pinned is not None:
        row.pinned = inp.pinned
    row.updated_at = ctx.now
    await ctx.db.flush()
    await events.publish(ctx, "files.item.updated", {"item_id": row.id, "course_id": row.course_id})
    return await service.item_out(ctx, row)


async def reprocess(ctx: Ctx, item_id: str) -> ItemOut:
    row = await service.get_item(ctx, item_id)
    if not content.has_content(row):
        raise AppError("files.unsupported_type", 422)
    if not row.storage_key:
        # Read from its source when the job runs, which also tells what it is.
        row.doc_status, row.doc_error_code = "pending", None
        await service.enqueue_processing(ctx, row)
        row.updated_at = ctx.now
        await ctx.db.flush()
        await events.publish(
            ctx, "files.item.updated", {"item_id": row.id, "course_id": row.course_id}
        )
        return await service.item_out(ctx, row)
    data = b"".join([chunk async for chunk in get_storage(ctx).open(row.storage_key)])
    detected = await anyio.to_thread.run_sync(detect, data, row.original_name)
    row.mime_type = detected.mime
    if detected.kind not in service.PARSEABLE:
        row.doc_status, row.doc_error_code = "unsupported", "files.unsupported_type"
    else:
        row.doc_status, row.doc_error_code = "pending", None
        await service.enqueue_processing(ctx, row)
    row.updated_at = ctx.now
    await ctx.db.flush()
    await events.publish(ctx, "files.item.updated", {"item_id": row.id, "course_id": row.course_id})
    return await service.item_out(ctx, row)
