"""Adding and changing course files (M07 §2): uploads (staged before any database write),
files other modules save, links, renaming and moving one item, reading it again."""

import re
from collections.abc import AsyncIterable, Sequence
from dataclasses import dataclass
from datetime import datetime
from urllib.parse import urlsplit, urlunsplit

import anyio
from sqlalchemy import ColumnElement, func, select

from semestra.core.context import Ctx
from semestra.core.db import new_id
from semestra.core.errors import AppError
from semestra.core.events import events
from semestra.core.storage import StoredObject, charge, discard_on_error, get_storage, stage
from semestra.modules.academics import service as academics
from semestra.modules.files import content, folders, service
from semestra.modules.files.models import FilesItem
from semestra.modules.files.parse import detect
from semestra.modules.files.schemas import (
    DuplicateFile,
    ItemOut,
    ItemRef,
    ItemUpdateInput,
    SourceKind,
)


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
                doc_status="none" if file.supported else "unsupported",
                doc_error_code=None if file.supported else "files.unsupported_type",
                created_at=ctx.now,
                updated_at=ctx.now,
            )
            for file in staged
        ]
        ctx.db.add_all(rows)
        await charge(ctx)
    for row in rows:
        if row.doc_status != "unsupported":
            await service.request_read(ctx, row, "upload")
        await events.publish(ctx, "files.item.created", {"item_id": row.id, "course_id": course_id})
    return rows


async def find_duplicate(
    ctx: Ctx,
    course_id: str,
    *,
    name: str,
    size: int,
    sha256: str | None = None,
    own_only: bool = False,
) -> FilesItem | None:
    """A file of the course that is most likely the same file (`same_file`). `own_only`: only
    files that follow no source (what the user put there)."""
    stmt = select(FilesItem).where(
        FilesItem.user_id == ctx.user_id,
        FilesItem.course_id == course_id,
        FilesItem.kind == "file",
        _same_as(name, size, sha256),
    )
    if own_only:
        stmt = stmt.where(FilesItem.source_ref.is_(None))
    return await ctx.db.scalar(stmt.limit(1))


async def own_files(ctx: Ctx, course_id: str) -> list[tuple[str, int, str | None]]:
    """The course's files that follow no source (what the user put there), as `same_file`
    compares them: for checking a batch of incoming files with one query."""
    rows = await ctx.db.execute(
        select(FilesItem.display_name, FilesItem.size_bytes, FilesItem.sha256).where(
            FilesItem.user_id == ctx.user_id,
            FilesItem.course_id == course_id,
            FilesItem.kind == "file",
            FilesItem.source_ref.is_(None),
        )
    )
    return [(name, size or 0, sha) for name, size, sha in rows]


def same_file(a: tuple[str, int, str | None], b: tuple[str, int, str | None]) -> bool:
    """The one rule for “the same file” (name, size, sha256): the same bytes, or the same name
    (any case) and size. A file read from its source has no hash of its bytes here, so it
    matches by name and size only. `_same_as` is the same rule as a query."""
    return bool(a[2] and a[2] == b[2]) or (a[0].lower() == b[0].lower() and a[1] == b[1])


def _same_as(name: str, size: int, sha256: str | None) -> ColumnElement[bool]:
    same = (func.lower(FilesItem.display_name) == name.lower()) & (FilesItem.size_bytes == size)
    return same | (FilesItem.sha256 == sha256) if sha256 else same


async def check_duplicates(
    ctx: Ctx, course_id: str, files: Sequence[DuplicateFile], pending: Sequence[DuplicateFile]
) -> list[int]:
    """Which of the files about to be uploaded look already there (`same_file`), in the course
    or among `pending` (picked before, still on their way); an upload also counts a file of the
    same name (any case) in the folder it goes into."""
    out: list[int] = []
    for i, f in enumerate(files):
        key = (f.name, f.size, f.sha256)
        named = func.lower(FilesItem.display_name) == f.name.lower()
        in_folder = (
            FilesItem.folder_id.is_(None)
            if f.folder_id is None
            else FilesItem.folder_id == f.folder_id
        )
        there = await ctx.db.scalar(
            select(FilesItem.id)
            .where(
                FilesItem.user_id == ctx.user_id,
                FilesItem.course_id == course_id,
                FilesItem.kind == "file",
                _same_as(*key) | (named & in_folder),
            )
            .limit(1)
        )
        if there is not None or any(
            same_file(key, (p.name, p.size, p.sha256))
            or (p.folder_id == f.folder_id and p.name.lower() == f.name.lower())
            for p in pending
        ):
            out.append(i)
    return out


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
    version: str | None = None,
) -> ItemOut:
    """For other modules (M09 saves Canvas files, M12 files the agent generates). With a
    `source_ref` its source keeps (`content.py`) the file follows that source with this local
    copy of its `version` (`keep_copy`: the user asked for one); without, it is a plain file."""
    row = await store_file(
        ctx,
        course_id=course_id,
        filename=name,
        stream=stream,
        folder_id=folder_id,
        source_kind=source_kind,
        source_ref=source_ref,
    )
    if content.follows_source(row):
        row.source_name, row.keep_copy = source_name, keep_copy
        row.source_version = content.version_hash(version) if version else row.sha256
        row.source_mime, row.source_size = row.mime_type, row.size_bytes
        row.copy_version = row.source_version
        row.source_modified_at = row.copy_modified_at = modified_at
        if row.doc_status == "pending":  # queued under its own hash: again under this version
            await service.request_read(ctx, row, "upload")
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
        display_name=(
            service.name_from_source(display_name, host)
            if source_ref
            else service.clean_name(display_name)
        )
        if display_name
        else host,
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


async def check_follows_source(ctx: Ctx, inp: ItemRef) -> None:
    """Saving in Semestra is a choice about a file its source keeps in step: the user's own
    files (also those handed over by their source) are stored here already."""
    row = await service.get_item(ctx, inp.item_id)
    if not content.follows_source(row):
        raise AppError("files.not_from_source", 409)


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
        await service.request_read(ctx, row, "user")
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
        await service.request_read(ctx, row, "user")
    row.updated_at = ctx.now
    await ctx.db.flush()
    await events.publish(ctx, "files.item.updated", {"item_id": row.id, "course_id": row.course_id})
    return await service.item_out(ctx, row)
