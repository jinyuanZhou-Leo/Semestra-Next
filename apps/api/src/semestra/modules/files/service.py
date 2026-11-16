"""Course files: folders, uploads, links, listing and removal (M07 §2, §4, §5)."""

import hashlib
import mimetypes
import re
from collections.abc import AsyncIterable, AsyncIterator, Iterable, Sequence
from dataclasses import dataclass
from datetime import timedelta
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import anyio
from sqlalchemy import delete, func, select

from semestra.core.context import Ctx, run_as_system
from semestra.core.db import new_id
from semestra.core.errors import AppError, not_found
from semestra.core.events import events
from semestra.core.jobs import CoreJob, enqueue
from semestra.core.storage import (
    StoredObject,
    charge,
    delete_after_commit,
    discard_on_error,
    get_storage,
    remaining_quota,
    stage,
    storage_usage_provider,
)
from semestra.core.storage import usage as core_usage
from semestra.modules.academics import rules
from semestra.modules.academics import service as academics
from semestra.modules.files import content, indexing
from semestra.modules.files.models import (
    FilesDocument,
    FilesFolder,
    FilesIndexState,
    FilesItem,
)
from semestra.modules.files.parse import detect
from semestra.modules.files.parse.detect import DOCX, PPTX, XLSX
from semestra.modules.files.schemas import (
    MAX_FOLDER_DEPTH,
    CourseUsage,
    EntriesDeleteInput,
    FileMatch,
    FileSearchInput,
    FilesItemList,
    FilesItemListInput,
    FilesUsageBreakdown,
    FilesUsageGet,
    FileType,
    FolderDeleteInput,
    FolderOut,
    ItemOut,
    ItemRef,
    ItemUpdateInput,
    SourceKind,
    TypeUsage,
)
from semestra.modules.files.settings import auto_index
from semestra.modules.files.vectors import get_vector_store

PARSEABLE = frozenset({"pdf", "docx", "pptx", "xlsx", "csv", "text", "markdown", "html", "image"})
_UNSAFE_NAME = re.compile(r"[\x00-\x1f\x7f]")


def storage_key(user_id: str, item_id: str) -> str:
    return f"users/{user_id}/files/{item_id}/original"


def page_image_key(user_id: str, item_id: str, document_id: str, page_no: int) -> str:
    return f"users/{user_id}/files/{item_id}/pages/{document_id}/{page_no}.png"


# --- lookups --------------------------------------------------------------------------------


async def get_item(ctx: Ctx, item_id: str) -> FilesItem:
    row = await ctx.db.scalar(
        select(FilesItem).where(FilesItem.id == item_id, FilesItem.user_id == ctx.user_id)
    )
    if row is None:
        raise not_found("item", item_id)
    return row


async def get_folder(ctx: Ctx, folder_id: str, course_id: str | None = None) -> FilesFolder:
    stmt = select(FilesFolder).where(
        FilesFolder.id == folder_id, FilesFolder.user_id == ctx.user_id
    )
    if course_id is not None:
        stmt = stmt.where(FilesFolder.course_id == course_id)
    row = await ctx.db.scalar(stmt)
    if row is None:
        raise not_found("folder", folder_id)
    return row


# Targets for the assistant's confirmation cards of deletes (M12 §3.5): what goes, by name.


async def preview_item_delete(ctx: Ctx, inp: ItemRef) -> dict[str, Any]:
    row = await get_item(ctx, inp.item_id)
    return {"target": row.display_name, "changes": []}


async def preview_folder_delete(ctx: Ctx, inp: FolderDeleteInput) -> dict[str, Any]:
    """What goes with the folder: its files (by name) and subfolders."""
    row = await get_folder(ctx, inp.folder_id)
    tree, items = await _folder_contents(ctx, row, inp.recursive)
    names = sorted((i.display_name for i in items), key=str.lower)
    changes: list[dict[str, Any]] = []
    if names:
        changes.append({"field": "files", "before": names[:10], "after": None, "count": len(names)})
    if len(tree) > 1:
        changes.append({"field": "subfolders", "before": len(tree) - 1, "after": None})
    return {"target": row.name, "changes": changes}


async def _course_folders(ctx: Ctx, course_id: str) -> list[FilesFolder]:
    return list(
        (
            await ctx.db.scalars(
                select(FilesFolder)
                .where(FilesFolder.user_id == ctx.user_id, FilesFolder.course_id == course_id)
                .order_by(func.lower(FilesFolder.name), FilesFolder.id)
            )
        ).all()
    )


def _depth(folder: FilesFolder, by_id: dict[str, FilesFolder]) -> int:
    depth, seen = 1, {folder.id}
    while folder.parent_id and folder.parent_id in by_id and folder.parent_id not in seen:
        folder = by_id[folder.parent_id]
        seen.add(folder.id)
        depth += 1
    return depth


def _descendants(folder_id: str, folders: Iterable[FilesFolder]) -> set[str]:
    children: dict[str | None, list[str]] = {}
    for f in folders:
        children.setdefault(f.parent_id, []).append(f.id)
    found: set[str] = set()
    stack = [folder_id]
    while stack:
        for child in children.get(stack.pop(), []):
            if child not in found:
                found.add(child)
                stack.append(child)
    return found


def _subtree_height(folder_id: str, folders: Sequence[FilesFolder]) -> int:
    """Levels of the folder's own subtree, counting the folder itself."""
    children: dict[str | None, list[str]] = {}
    for f in folders:
        children.setdefault(f.parent_id, []).append(f.id)

    def height(fid: str) -> int:
        return 1 + max((height(c) for c in children.get(fid, [])), default=0)

    return height(folder_id)


# --- output ---------------------------------------------------------------------------------


async def item_outs(ctx: Ctx, rows: Sequence[FilesItem]) -> list[ItemOut]:
    doc_ids = [r.active_document_id for r in rows if r.active_document_id]
    docs = (
        {
            d.id: d
            for d in (
                await ctx.db.scalars(select(FilesDocument).where(FilesDocument.id.in_(doc_ids)))
            ).all()
        }
        if doc_ids
        else {}
    )
    keys = {
        f"{r.id}:{r.sha256}": r.id
        for r in rows
        if r.doc_status in ("pending", "processing") and r.sha256
    }
    jobs: dict[str, str] = {}
    if keys:
        for key, job_id in (
            await ctx.db.execute(
                select(CoreJob.dedupe_key, CoreJob.id).where(
                    CoreJob.user_id == ctx.user_id,
                    CoreJob.kind.in_(PROCESS_KINDS),
                    CoreJob.status.in_(("pending", "running")),
                    CoreJob.dedupe_key.in_(list(keys)),
                )
            )
        ).all():
            if key is not None:
                jobs[keys[key]] = job_id
    out: list[ItemOut] = []
    for r in rows:
        doc = docs.get(r.active_document_id or "")
        out.append(
            ItemOut(
                id=r.id,
                course_id=r.course_id,
                folder_id=r.folder_id,
                kind=r.kind,  # pyright: ignore[reportArgumentType]
                display_name=r.display_name,
                original_name=r.original_name,
                mime_type=r.mime_type,
                size_bytes=r.size_bytes,
                sha256=r.sha256,
                url=r.url,
                stored=bool(r.storage_key),
                follows_source=content.follows_source(r),
                pinned=r.pinned,
                week=r.week,
                week_source=r.week_source,  # pyright: ignore[reportArgumentType]
                source_kind=r.source_kind,  # pyright: ignore[reportArgumentType]
                source_ref=r.source_ref,
                doc_status=r.doc_status,  # pyright: ignore[reportArgumentType]
                doc_error_code=r.doc_error_code,
                page_count=doc.page_count if doc else None,
                ocr_skipped_pages=doc.ocr_skipped_pages if doc else 0,
                job_id=jobs.get(r.id),
                created_at=r.created_at,
                updated_at=r.updated_at,
            )
        )
    return out


async def item_out(ctx: Ctx, row: FilesItem) -> ItemOut:
    return (await item_outs(ctx, [row]))[0]


def folder_out(row: FilesFolder, counts: dict[str, int]) -> FolderOut:
    return FolderOut(
        id=row.id,
        course_id=row.course_id,
        parent_id=row.parent_id,
        name=row.name,
        item_count=counts.get(row.id, 0),
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def _folder_counts(ctx: Ctx, course_id: str) -> dict[str, int]:
    rows = await ctx.db.execute(
        select(FilesItem.folder_id, func.count())
        .where(
            FilesItem.user_id == ctx.user_id,
            FilesItem.course_id == course_id,
            FilesItem.folder_id.is_not(None),
        )
        .group_by(FilesItem.folder_id)
    )
    return {fid: n for fid, n in rows.all() if fid}


# --- listing --------------------------------------------------------------------------------


async def list_files(ctx: Ctx, inp: FilesItemListInput) -> FilesItemList:
    await academics.get_course_row(ctx, inp.course_id)
    folders = await _course_folders(ctx, inp.course_id)
    if inp.folder_id is not None and inp.folder_id not in {f.id for f in folders}:
        raise not_found()
    stmt = select(FilesItem).where(
        FilesItem.user_id == ctx.user_id, FilesItem.course_id == inp.course_id
    )
    if not inp.recursive and inp.week is None:
        stmt = stmt.where(
            FilesItem.folder_id == inp.folder_id
            if inp.folder_id is not None
            else FilesItem.folder_id.is_(None)
        )
    if inp.search:
        needle = inp.search.strip().lower().replace("\\", "\\\\").replace("%", "\\%")
        stmt = stmt.where(
            func.lower(FilesItem.display_name).like(f"%{needle.replace('_', '\\_')}%", escape="\\")
        )
    if inp.week is not None:
        first = rules.week_start_of(inp.week, await academics.week_start(ctx))
        stmt = stmt.where(FilesItem.week.between(first, first + timedelta(days=6)))
    name = func.lower(FilesItem.display_name)
    key = {
        "name": name,
        "size": FilesItem.size_bytes,
        "updated": FilesItem.updated_at,
        "created": FilesItem.created_at,
        "type": func.coalesce(FilesItem.mime_type, "~"),
    }[inp.sort]
    stmt = stmt.order_by(key.desc() if inp.descending else key, name, FilesItem.id)
    offset = int(inp.cursor) if inp.cursor and inp.cursor.isdigit() else 0
    rows = list((await ctx.db.scalars(stmt.offset(offset).limit(inp.limit + 1))).all())
    more = len(rows) > inp.limit
    counts = await _folder_counts(ctx, inp.course_id)
    return FilesItemList(
        folders=[folder_out(f, counts) for f in folders],
        items=await item_outs(ctx, rows[: inp.limit]),
        next_cursor=str(offset + inp.limit) if more else None,
    )


async def pinned(ctx: Ctx, program_id: str) -> list[ItemOut]:
    await academics.get_program_row(ctx, program_id)
    course_ids = await program_course_ids(ctx, program_id)
    if not course_ids:
        return []
    rows = (
        await ctx.db.scalars(
            select(FilesItem)
            .where(
                FilesItem.user_id == ctx.user_id,
                FilesItem.pinned.is_(True),
                FilesItem.course_id.in_(course_ids),
            )
            .order_by(func.lower(FilesItem.display_name), FilesItem.id)
        )
    ).all()
    return await item_outs(ctx, rows)


async def search_names(ctx: Ctx, inp: FileSearchInput) -> list[FileMatch]:
    await academics.get_program_row(ctx, inp.program_id)
    course_ids = await program_course_ids(ctx, inp.program_id)
    if not course_ids:
        return []
    stmt = select(
        FilesItem.id,
        FilesItem.course_id,
        FilesItem.display_name,
        FilesItem.mime_type,
        FilesItem.updated_at,
    ).where(
        FilesItem.user_id == ctx.user_id,
        FilesItem.kind == "file",
        FilesItem.course_id.in_(course_ids),
    )
    if query := inp.query.strip().lower():
        stmt = stmt.where(func.lower(FilesItem.display_name).contains(query, autoescape=True))
    rows = await ctx.db.execute(
        stmt.order_by(FilesItem.updated_at.desc(), FilesItem.id).limit(inp.limit)
    )
    return [
        FileMatch(
            id=r.id,
            course_id=r.course_id,
            display_name=r.display_name,
            mime_type=r.mime_type,
            updated_at=r.updated_at,
        )
        for r in rows
    ]


async def program_course_ids(ctx: Ctx, program_id: str, term_id: str | None = None) -> list[str]:
    """Ids of the Program's courses (of one term if given), through M02's list."""
    from semestra.modules.academics.schemas import CourseListInput

    ids: list[str] = []
    cursor: str | None = None
    while True:
        page = await academics.list_courses(
            ctx,
            CourseListInput(program_id=program_id, term_id=term_id, cursor=cursor, limit=500),
        )
        ids += [c.id for c in page.items]
        cursor = page.next_cursor
        if cursor is None:
            return ids


# --- folders --------------------------------------------------------------------------------


def _clean_name(name: str) -> str:
    cleaned = _UNSAFE_NAME.sub("", name).strip()
    if not cleaned or "/" in cleaned or "\\" in cleaned:
        raise AppError("common.validation", 422, errors=[{"loc": ["name"], "code": "invalid"}])
    return cleaned


async def _check_free_name(
    ctx: Ctx, course_id: str, parent_id: str | None, name: str, *, except_id: str | None = None
) -> None:
    stmt = select(FilesFolder.id).where(
        FilesFolder.user_id == ctx.user_id,
        FilesFolder.course_id == course_id,
        FilesFolder.parent_id == parent_id
        if parent_id is not None
        else FilesFolder.parent_id.is_(None),
        func.lower(FilesFolder.name) == name.lower(),
    )
    if except_id is not None:
        stmt = stmt.where(FilesFolder.id != except_id)
    if await ctx.db.scalar(stmt) is not None:
        raise AppError("common.conflict", 409, field="name")


async def create_folder(ctx: Ctx, course_id: str, name: str, parent_id: str | None) -> FolderOut:
    await academics.get_course_row(ctx, course_id)
    name = _clean_name(name)
    folders = await _course_folders(ctx, course_id)
    by_id = {f.id: f for f in folders}
    if parent_id is not None:
        parent = by_id.get(parent_id)
        if parent is None:
            raise not_found("folder", parent_id)
        if _depth(parent, by_id) >= MAX_FOLDER_DEPTH:
            raise AppError("files.folder_depth", 422, max=MAX_FOLDER_DEPTH)
    await _check_free_name(ctx, course_id, parent_id, name)
    row = FilesFolder(
        user_id=ctx.user_id,
        course_id=course_id,
        parent_id=parent_id,
        name=name,
        created_at=ctx.now,
        updated_at=ctx.now,
    )
    ctx.db.add(row)
    await ctx.db.flush()
    await events.publish(ctx, "files.folder.created", {"folder_id": row.id, "course_id": course_id})
    return folder_out(row, {})


def _refuse_none(fields: list[str]) -> None:
    """A name or a pin can't be cleared: null is refused rather than ignored, so a write never
    looks like it changed something it left alone."""
    if fields:
        errors = [{"loc": [f], "code": "none_not_allowed"} for f in fields]
        raise AppError("common.validation", 422, errors=errors)


async def check_item_update(ctx: Ctx, inp: ItemUpdateInput) -> None:
    sent = inp.model_fields_set
    _refuse_none([f for f in ("display_name", "pinned") if f in sent and getattr(inp, f) is None])


async def check_folder_delete(ctx: Ctx, inp: FolderDeleteInput) -> None:
    await _folder_contents(ctx, await get_folder(ctx, inp.folder_id), inp.recursive)


async def update_folder(
    ctx: Ctx,
    folder_id: str,
    fields: set[str],
    name: str | None,
    parent_id: str | None,
) -> FolderOut:
    if "name" in fields and name is None:
        _refuse_none(["name"])
    row = await get_folder(ctx, folder_id)
    folders = await _course_folders(ctx, row.course_id)
    by_id = {f.id: f for f in folders}
    new_name = _clean_name(name) if "name" in fields and name is not None else row.name
    new_parent = parent_id if "parent_id" in fields else row.parent_id
    if new_parent != row.parent_id and new_parent is not None:
        target = by_id.get(new_parent)
        if target is None:
            raise not_found()
        if new_parent == row.id or new_parent in _descendants(row.id, folders):
            raise AppError(
                "common.validation", 422, errors=[{"loc": ["parent_id"], "code": "cycle"}]
            )
        if _depth(target, by_id) + _subtree_height(row.id, folders) > MAX_FOLDER_DEPTH:
            raise AppError("files.folder_depth", 422, max=MAX_FOLDER_DEPTH)
    if new_name != row.name or new_parent != row.parent_id:
        await _check_free_name(ctx, row.course_id, new_parent, new_name, except_id=row.id)
    row.name, row.parent_id = new_name, new_parent
    row.updated_at = ctx.now
    await ctx.db.flush()
    await events.publish(
        ctx, "files.folder.updated", {"folder_id": row.id, "course_id": row.course_id}
    )
    return folder_out(row, await _folder_counts(ctx, row.course_id))


async def _folder_contents(
    ctx: Ctx, row: FilesFolder, recursive: bool
) -> tuple[set[str], list[FilesItem]]:
    """(the folder and its subfolders, the files in any of them): what deleting it removes.
    Without `recursive` only an empty folder can go (the assistant's card is refused the same
    way, so it never shows files that a delete would keep)."""
    folders = await _course_folders(ctx, row.course_id)
    tree = {row.id} | _descendants(row.id, folders)
    items = list(
        (
            await ctx.db.scalars(
                select(FilesItem).where(
                    FilesItem.user_id == ctx.user_id, FilesItem.folder_id.in_(tree)
                )
            )
        ).all()
    )
    if (items or len(tree) > 1) and not recursive:
        raise AppError("files.folder_not_empty", 409)
    return tree, items


async def delete_folder(ctx: Ctx, folder_id: str, recursive: bool) -> None:
    row = await get_folder(ctx, folder_id)
    tree, items = await _folder_contents(ctx, row, recursive)
    await purge_items(ctx, items)
    await ctx.db.execute(delete(FilesFolder).where(FilesFolder.id.in_(tree)))
    await events.publish(
        ctx, "files.folder.deleted", {"folder_id": row.id, "course_id": row.course_id}
    )


# --- items ----------------------------------------------------------------------------------


def _safe_name(filename: str | None) -> str:
    name = _UNSAFE_NAME.sub("", (filename or "").replace("\\", "/").rsplit("/", 1)[-1]).strip()
    return name[:255] or "file"


async def _folder_for(ctx: Ctx, course_id: str, folder_id: str | None) -> None:
    if folder_id is not None:
        await get_folder(ctx, folder_id, course_id)


async def check_upload_target(ctx: Ctx, course_id: str, folder_id: str | None) -> None:
    await academics.get_course_row(ctx, course_id)
    await _folder_for(ctx, course_id, folder_id)


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
        storage_key(ctx.user_id, item_id),
        stream,
        cap=cap,
        too_large=AppError("files.too_large", 413, max=cap),
        reserved=reserved,
        keep=True,
    )
    name = _safe_name(filename)
    async with discard_on_error(ctx, [staged.key]):
        detected = await anyio.to_thread.run_sync(detect, staged.data, name)
    return StagedFile(item_id, name, staged.stored, detected.mime, detected.kind in PARSEABLE)


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
            await enqueue_processing(ctx, row)
        await events.publish(ctx, "files.item.created", {"item_id": row.id, "course_id": course_id})
    return rows


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


PROCESS_KINDS = ("files.process", "files.process_synced")
# A file read from its source that has not been read yet (restored from a backup).
SOURCE_UNREAD = "files.source_unread"


async def enqueue_processing(ctx: Ctx, row: FilesItem, *, synced: bool = False) -> None:
    """Queues reading the file's text; `synced`: kept in step with its source by another
    module, not something the user is waiting on (`files.process_synced`)."""
    from semestra.modules.files.jobs import ProcessPayload

    kind = PROCESS_KINDS[1] if synced else PROCESS_KINDS[0]
    await enqueue(ctx, kind, ProcessPayload(item_id=row.id), dedupe_key=f"{row.id}:{row.sha256}")


async def save_bytes_as_file(
    ctx: Ctx,
    course_id: str,
    name: str,
    stream: AsyncIterable[bytes],
    source_kind: SourceKind,
    source_ref: str | None = None,
    folder_id: str | None = None,
    *,
    kept_offline: bool = False,
) -> ItemOut:
    """For other modules (M09 saves Canvas files, M12 files the agent generates).
    `kept_offline`: the user's own copy of a file `source_ref` names (see `FilesItem`)."""
    row = await store_file(
        ctx,
        course_id=course_id,
        filename=name,
        stream=stream,
        folder_id=folder_id,
        source_kind=source_kind,
        source_ref=source_ref,
    )
    if kept_offline:
        row.kept_offline = True
        await ctx.db.flush()
    return await item_out(ctx, row)


# Extensions whose files the pipeline may read, for files known only by name until processed.
_PARSEABLE_EXTENSIONS = frozenset({
    "pdf", "docx", "pptx", "xlsx", "csv", "tsv", "txt", "md", "markdown", "html", "htm", "png",
    "jpg", "jpeg", "webp", "heic",
})  # fmt: skip


def _readable(name: str, mime: str | None) -> bool:
    """Whether processing an unstored file is worth reading it from its source: by its name and
    the source's type (a video or an archive is never read)."""
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext in _PARSEABLE_EXTENSIONS:
        return True
    return bool(mime) and (
        mime in ("application/pdf", DOCX, PPTX, XLSX, "text/html", "text/plain", "text/csv")
        or mime.startswith("text/")
    )


def _version_hash(version: str) -> str:
    return hashlib.sha256(version.encode()).hexdigest()


def _remote_status(ctx: Ctx, name: str, mime: str | None, size: int) -> tuple[str, str | None]:
    if not _readable(name, mime):
        return "unsupported", "files.unsupported_type"
    if size > ctx.settings.files_max_upload_bytes:
        # Not the user's file to make smaller: it opens, its text is just not read.
        return "unsupported", "files.too_large"
    return "pending", None


async def add_remote_file(
    ctx: Ctx,
    course_id: str,
    folder_id: str | None,
    *,
    name: str,
    mime: str | None,
    size: int,
    source_ref: str,
    version: str,
    url: str | None,
    source_kind: SourceKind = "lms",
) -> FilesItem:
    """An item for a file kept by another module (`content.py`): stored nowhere, so it takes
    no quota. `version` names the source's version of the bytes (it changes when they do) and
    `url` where the source shows the file. Processed like an upload."""
    status, error = _remote_status(ctx, name, mime, size)
    clean = _safe_name(name)
    row = FilesItem(
        user_id=ctx.user_id,
        course_id=course_id,
        folder_id=folder_id,
        kind="file",
        display_name=clean,
        original_name=clean,
        mime_type=mime,
        size_bytes=size,
        sha256=_version_hash(version),
        url=url,
        source_kind=source_kind,
        source_ref=source_ref,
        doc_status=status,
        doc_error_code=error,
        created_at=ctx.now,
        updated_at=ctx.now,
    )
    if row.doc_status == "pending" and not await auto_index(ctx, course_id):
        row.doc_status = "none"
    ctx.db.add(row)
    await ctx.db.flush()
    if row.doc_status == "pending":
        await enqueue_processing(ctx, row, synced=True)
    await events.publish(ctx, "files.item.created", {"item_id": row.id, "course_id": course_id})
    return row


async def update_remote_file(
    ctx: Ctx,
    row: FilesItem,
    *,
    name: str | None,
    mime: str | None,
    size: int,
    version: str,
    url: str | None,
) -> None:
    """The source's file changed: its new metadata, and its text read again. `name` replaces
    the shown name (None: the user renamed it, keep theirs); its place is never changed. A copy
    stored for the source (not one the user keeps) is let go: the item is read from the source
    again, until the source stores the new bytes."""
    assert not row.kept_offline
    if row.storage_key:
        delete_after_commit(ctx, [row.storage_key])
        row.storage_key = None
    if name is not None:
        row.display_name = row.original_name = _safe_name(name)
    row.mime_type, row.size_bytes, row.url = mime, size, url
    row.sha256 = _version_hash(version)
    status, error = _remote_status(ctx, row.original_name or row.display_name, mime, size)
    if status == "pending" and not await auto_index(ctx, row.course_id):
        status = "none"
    row.doc_status, row.doc_error_code = status, error
    row.updated_at = ctx.now
    await ctx.db.flush()
    if status == "pending":
        await enqueue_processing(ctx, row, synced=True)
    await events.publish(ctx, "files.item.updated", {"item_id": row.id, "course_id": row.course_id})


async def keep_offline(ctx: Ctx, row: FilesItem) -> None:
    """The user asks for an offline copy of a file read from its source (`content.py`): it is
    stored here in place, in a listed job, so it still opens once the source is gone (a course
    closed on the LMS), and the source no longer updates or removes it (`kept_offline`). What
    can be told now (too large, no quota left) is refused here."""
    if not content.follows_source(row):
        return
    if row.storage_key:  # stored for its source already: now the user's
        row.kept_offline = True
        await ctx.db.flush()
        return
    cap = ctx.settings.files_max_upload_bytes
    if row.size_bytes > cap:
        raise AppError("files.too_large", 413, max=cap)
    left = await remaining_quota(ctx)
    if left is not None and row.size_bytes > left:
        current = await core_usage(ctx)
        raise AppError(
            "common.quota_exceeded", 413, used=current.used_bytes, quota=current.quota_bytes
        )
    from semestra.modules.files.jobs import KeepPayload

    # Marked the user's only once the bytes are here (`store_from_source`): until then, and
    # after a failure, it is still the source's, and can be asked for again.
    await enqueue(
        ctx,
        "files.keep_offline",
        KeepPayload(item_ids=[row.id]),
        dedupe_key=f"files.keep_offline:{row.id}",
    )


async def keep_synced_offline(ctx: Ctx, items: Sequence[FilesItem], *, dedupe: str) -> None:
    """Stores files read from their source here for the source, quietly in the background, as
    far as the quota goes (M09's per-course "store here"); the rest stay read from the source.
    The source still updates and removes them. Only what fits (by the source's sizes) is queued,
    so a full quota downloads nothing."""
    cap = ctx.settings.files_max_upload_bytes
    left = await remaining_quota(ctx)
    ids: list[str] = []
    for row in items:
        if not content.remote(row) or row.size_bytes > cap:
            continue
        if left is not None:
            if row.size_bytes > left:
                continue
            left -= row.size_bytes
        ids.append(row.id)
    if ids:
        from semestra.modules.files.jobs import KeepPayload

        await enqueue(
            ctx, "files.keep_offline_synced", KeepPayload(item_ids=ids), dedupe_key=dedupe
        )


async def store_from_source(ctx: Ctx, item_id: str, *, quiet: bool) -> bool:
    """Stores one file read from its source (the keep-offline jobs). The source is opened in a
    short transaction, the bytes are written to storage holding no database lock, and the item
    takes them in another short transaction. Each run stages under a key of its own, so two runs
    for one item never touch each other's bytes. Not `quiet` (the user asked), the item becomes
    the user's own copy (`kept_offline`) only in the transaction that has its bytes stored, so a
    failure leaves it the source's. False (`quiet` only): the quota is full and nothing
    changed; otherwise that and every other failure raise."""
    opened: list[AsyncIterator[bytes]] = []

    async def open_(sys_ctx: Ctx) -> None:
        row = await sys_ctx.db.get(FilesItem, item_id)
        if row is not None and content.remote(row):
            opened.append(await content.open_content(sys_ctx, row))
        elif row is not None and not quiet and row.storage_key and content.follows_source(row):
            row.kept_offline = True  # stored for its source meanwhile: now the user's

    await run_as_system(ctx.state, ctx.user_id, open_)
    if not opened:
        return True
    cap = ctx.settings.files_max_upload_bytes
    try:
        staged = await stage(
            ctx,
            f"{storage_key(ctx.user_id or '', item_id)}-{new_id()}",
            opened[0],
            cap=cap,
            too_large=AppError("files.too_large", 413, max=cap),
        )
    except AppError as exc:
        if quiet and exc.code == "common.quota_exceeded":
            return False
        raise

    taken: list[bool] = []

    async def take(sys_ctx: Ctx) -> None:
        row = await sys_ctx.db.get(FilesItem, item_id)
        if row is None:
            return
        if not quiet:
            row.kept_offline = True  # the user's copy, now that its bytes are here
        if not row.storage_key:  # else stored meanwhile: these bytes are not needed
            row.storage_key = staged.stored.key
            row.size_bytes = staged.stored.size
            taken.append(True)
        row.updated_at = sys_ctx.now
        await charge(sys_ctx)
        await events.publish(
            sys_ctx, "files.item.updated", {"item_id": row.id, "course_id": row.course_id}
        )

    try:
        await run_as_system(ctx.state, ctx.user_id, take)
    except AppError as exc:
        await get_storage(ctx).delete(staged.stored.key)
        if quiet and exc.code == "common.quota_exceeded":
            return False
        raise
    if not taken:
        await get_storage(ctx).delete(staged.stored.key)
    return True


async def retry_synced(ctx: Ctx, row: FilesItem) -> None:
    """Reads a file from its source again after the source failed (or was never read); the
    source's sync decides when (M09 retries once its platform answers again)."""
    row.doc_status, row.doc_error_code, row.updated_at = "pending", None, ctx.now
    if not await auto_index(ctx, row.course_id):
        row.doc_status = "none"
    await ctx.db.flush()
    if row.doc_status == "pending":
        await enqueue_processing(ctx, row, synced=True)
    await events.publish(ctx, "files.item.updated", {"item_id": row.id, "course_id": row.course_id})


async def rename_synced(ctx: Ctx, row: FilesItem, name: str) -> None:
    """The source renamed its file (the bytes are the same)."""
    row.display_name = row.original_name = _safe_name(name)
    row.updated_at = ctx.now
    await ctx.db.flush()
    await events.publish(ctx, "files.item.updated", {"item_id": row.id, "course_id": row.course_id})


async def detach_from_source(ctx: Ctx, rows: Sequence[FilesItem]) -> None:
    """The source no longer keeps these copies the user kept (an LMS course unlinked): they are
    plain files of the user's from now on (`source_ref` cleared), with nothing to read again."""
    for row in rows:
        row.source_ref, row.kept_offline, row.updated_at = None, False, ctx.now
    await ctx.db.flush()


async def find_folder(ctx: Ctx, course_id: str, folder_id: str) -> FilesFolder | None:
    return await ctx.db.scalar(
        select(FilesFolder).where(
            FilesFolder.id == folder_id,
            FilesFolder.user_id == ctx.user_id,
            FilesFolder.course_id == course_id,
        )
    )


async def find_items(ctx: Ctx, item_ids: Sequence[str]) -> list[FilesItem]:
    """The ctx user's items with these ids (gone ones left out)."""
    if not item_ids:
        return []
    return list(
        (
            await ctx.db.scalars(
                select(FilesItem).where(
                    FilesItem.user_id == ctx.user_id, FilesItem.id.in_(list(item_ids))
                )
            )
        ).all()
    )


async def root_folder_named(ctx: Ctx, course_id: str, name: str) -> FilesFolder | None:
    return await ctx.db.scalar(
        select(FilesFolder).where(
            FilesFolder.user_id == ctx.user_id,
            FilesFolder.course_id == course_id,
            FilesFolder.parent_id.is_(None),
            func.lower(FilesFolder.name) == name.lower(),
        )
    )


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
) -> ItemOut:
    await academics.get_course_row(ctx, course_id)
    await _folder_for(ctx, course_id, folder_id)
    clean = normalize_url(url)
    host = urlsplit(clean).hostname or clean
    row = FilesItem(
        user_id=ctx.user_id,
        course_id=course_id,
        folder_id=folder_id,
        kind="link",
        display_name=_clean_name(display_name) if display_name else host,
        url=clean,
        source_kind=source_kind,
        source_ref=source_ref,
        doc_status="none",
        created_at=ctx.now,
        updated_at=ctx.now,
    )
    ctx.db.add(row)
    await ctx.db.flush()
    await events.publish(ctx, "files.item.created", {"item_id": row.id, "course_id": course_id})
    return await item_out(ctx, row)


async def update_link(ctx: Ctx, row: FilesItem, *, url: str, name: str | None) -> None:
    """Another module's link moved (and, unless None, was renamed); its place stays."""
    row.url = normalize_url(url)
    if name is not None:
        row.display_name = _clean_name(name)
    row.updated_at = ctx.now
    await ctx.db.flush()
    await events.publish(ctx, "files.item.updated", {"item_id": row.id, "course_id": row.course_id})


async def update_item(ctx: Ctx, inp: ItemUpdateInput) -> ItemOut:
    await check_item_update(ctx, inp)
    sent = inp.model_fields_set
    row = await get_item(ctx, inp.item_id)
    if "display_name" in sent and inp.display_name is not None:
        row.display_name = _clean_name(inp.display_name)
    if "folder_id" in sent:
        await _folder_for(ctx, row.course_id, inp.folder_id)
        row.folder_id = inp.folder_id
    if "pinned" in sent and inp.pinned is not None:
        row.pinned = inp.pinned
    row.updated_at = ctx.now
    await ctx.db.flush()
    await events.publish(ctx, "files.item.updated", {"item_id": row.id, "course_id": row.course_id})
    return await item_out(ctx, row)


async def delete_item(ctx: Ctx, item_id: str) -> None:
    row = await get_item(ctx, item_id)
    await purge_items(ctx, [row])


async def reprocess(ctx: Ctx, item_id: str) -> ItemOut:
    row = await get_item(ctx, item_id)
    if not content.has_content(row):
        raise AppError("files.unsupported_type", 422)
    if not row.storage_key:
        # Read from its source when the job runs, which also tells what it is.
        row.doc_status, row.doc_error_code = "pending", None
        await enqueue_processing(ctx, row)
        row.updated_at = ctx.now
        await ctx.db.flush()
        await events.publish(
            ctx, "files.item.updated", {"item_id": row.id, "course_id": row.course_id}
        )
        return await item_out(ctx, row)
    data = b"".join([chunk async for chunk in get_storage(ctx).open(row.storage_key)])
    detected = await anyio.to_thread.run_sync(detect, data, row.original_name)
    row.mime_type = detected.mime
    if detected.kind not in PARSEABLE:
        row.doc_status, row.doc_error_code = "unsupported", "files.unsupported_type"
    else:
        row.doc_status, row.doc_error_code = "pending", None
        await enqueue_processing(ctx, row)
    row.updated_at = ctx.now
    await ctx.db.flush()
    await events.publish(ctx, "files.item.updated", {"item_id": row.id, "course_id": row.course_id})
    return await item_out(ctx, row)


# --- several at once (the file page's selection) -------------------------------------------


async def course_items(ctx: Ctx, course_id: str, item_ids: Sequence[str]) -> list[FilesItem]:
    """The course's items with these ids; any id that is not one of them is not found."""
    ids = list(dict.fromkeys(item_ids))
    if not ids:
        return []
    rows = list(
        (
            await ctx.db.scalars(
                select(FilesItem).where(
                    FilesItem.user_id == ctx.user_id,
                    FilesItem.course_id == course_id,
                    FilesItem.id.in_(ids),
                )
            )
        ).all()
    )
    found = {r.id for r in rows}
    for item_id in ids:
        if item_id not in found:
            raise not_found("item", item_id)
    return rows


async def move_entries(
    ctx: Ctx,
    course_id: str,
    item_ids: Sequence[str],
    folder_ids: Sequence[str],
    to_folder_id: str | None,
) -> int:
    """Moves files and folders of one course into `to_folder_id` (None = its top level). All in
    the request's transaction: if one cannot move (a name taken, too deep), none do."""
    await academics.get_course_row(ctx, course_id)
    await _folder_for(ctx, course_id, to_folder_id)
    items = await course_items(ctx, course_id, item_ids)
    folder_ids = list(dict.fromkeys(folder_ids))
    for folder_id in folder_ids:
        await get_folder(ctx, folder_id, course_id)
        await update_folder(ctx, folder_id, {"parent_id"}, None, to_folder_id)
    for row in items:
        row.folder_id = to_folder_id
        row.updated_at = ctx.now
    await ctx.db.flush()
    for row in items:
        await events.publish(
            ctx, "files.item.updated", {"item_id": row.id, "course_id": row.course_id}
        )
    return len(items) + len(folder_ids)


async def _entries_to_delete(
    ctx: Ctx, course_id: str, item_ids: Sequence[str], folder_ids: Sequence[str]
) -> tuple[list[FilesFolder], set[str], list[FilesItem]]:
    """(the chosen folders, every folder that goes, every item that goes): a chosen folder takes
    its subfolders and files with it, even ones that were chosen as well."""
    await academics.get_course_row(ctx, course_id)
    folders = await _course_folders(ctx, course_id)
    by_id = {f.id: f for f in folders}
    chosen: list[FilesFolder] = []
    for folder_id in dict.fromkeys(folder_ids):
        if folder_id not in by_id:
            raise not_found("folder", folder_id)
        chosen.append(by_id[folder_id])
    tree: set[str] = set()
    for folder in chosen:
        tree |= {folder.id} | _descendants(folder.id, folders)
    items = await course_items(ctx, course_id, item_ids)
    if tree:
        items += list(
            (
                await ctx.db.scalars(
                    select(FilesItem).where(
                        FilesItem.user_id == ctx.user_id, FilesItem.folder_id.in_(tree)
                    )
                )
            ).all()
        )
    unique = list({row.id: row for row in items}.values())
    return chosen, tree, unique


async def preview_entries_delete(ctx: Ctx, inp: EntriesDeleteInput) -> dict[str, Any]:
    chosen, tree, items = await _entries_to_delete(ctx, inp.course_id, inp.item_ids, inp.folder_ids)
    names = sorted((i.display_name for i in items), key=str.lower)
    changes: list[dict[str, Any]] = []
    if names:
        changes.append({"field": "files", "before": names[:10], "after": None, "count": len(names)})
    if tree:
        changes.append({"field": "folders", "before": len(tree), "after": None})
    picked = set(inp.item_ids)
    targets = [f.name for f in chosen] + [i.display_name for i in items if i.id in picked]
    target = ", ".join(targets[:3]) + (" …" if len(targets) > 3 else "")
    return {"target": target, "changes": changes}


async def delete_entries(
    ctx: Ctx, course_id: str, item_ids: Sequence[str], folder_ids: Sequence[str]
) -> None:
    """Deletes files and folders (with everything in them) of one course, all or none."""
    chosen, tree, items = await _entries_to_delete(ctx, course_id, item_ids, folder_ids)
    await purge_items(ctx, items)
    if tree:
        await ctx.db.execute(delete(FilesFolder).where(FilesFolder.id.in_(tree)))
    for folder in chosen:
        await events.publish(
            ctx, "files.folder.deleted", {"folder_id": folder.id, "course_id": course_id}
        )


async def download_entries(
    ctx: Ctx, course_id: str, item_ids: Sequence[str], folder_ids: Sequence[str]
) -> list[tuple[str, FilesItem]]:
    """The files to put in one download, each with its path in it: a chosen file at the top, a
    chosen folder's files under its name (and their subfolders'). Links have no bytes and are
    left out; names that repeat get a number."""
    await academics.get_course_row(ctx, course_id)
    folders = await _course_folders(ctx, course_id)
    by_id = {f.id: f for f in folders}
    picked: list[tuple[str, FilesItem]] = [
        ("", row) for row in await course_items(ctx, course_id, item_ids)
    ]
    for folder_id in dict.fromkeys(folder_ids):
        top = by_id.get(folder_id)
        if top is None:
            raise not_found("folder", folder_id)
        tree = {top.id} | _descendants(top.id, folders)

        def path(fid: str, top: FilesFolder = top) -> str:
            parts: list[str] = []
            step: FilesFolder | None = by_id[fid]
            while step is not None:
                parts.append(step.name)
                step = by_id.get(step.parent_id or "") if step.id != top.id else None
            return "/".join(reversed(parts)) + "/"

        rows = await ctx.db.scalars(
            select(FilesItem).where(FilesItem.user_id == ctx.user_id, FilesItem.folder_id.in_(tree))
        )
        picked += [(path(r.folder_id or top.id), r) for r in rows]
    out: list[tuple[str, FilesItem]] = []
    taken: set[str] = set()
    seen: set[str] = set()
    for folder, row in picked:
        if row.id in seen or not content.has_content(row):
            continue
        seen.add(row.id)
        name = download_name(row.display_name, row.mime_type)
        stem, dot, ext = name.rpartition(".") if "." in name else (name, "", "")
        candidate, n = folder + name, 1
        while candidate.lower() in taken:
            n += 1
            candidate = f"{folder}{stem} ({n}){dot}{ext}"
        taken.add(candidate.lower())
        out.append((candidate, row))
    return out


def download_name(name: str, mime: str | None) -> str:
    """The shown name, with the extension of its type when it has none (an LMS page is named by
    its title), so the downloaded file opens."""
    if "." in name or not mime or mime == "application/octet-stream":
        return name
    return name + (mimetypes.guess_extension(mime) or "")


# --- removal --------------------------------------------------------------------------------


async def purge_items(ctx: Ctx, rows: Sequence[FilesItem]) -> None:
    """Deletes items with their documents, index entries and stored objects.

    The objects are removed after the transaction commits, so a rollback never loses a file.
    """
    if not rows:
        return
    ids = [r.id for r in rows]
    doc_ids = list(
        (await ctx.db.scalars(select(FilesDocument.id).where(FilesDocument.item_id.in_(ids)))).all()
    )
    keys = await indexing.delete_documents(ctx.db, get_vector_store(), doc_ids)
    keys += [r.storage_key for r in rows if r.storage_key]
    await ctx.db.execute(delete(FilesIndexState).where(FilesIndexState.item_id.in_(ids)))
    await ctx.db.execute(delete(FilesItem).where(FilesItem.id.in_(ids)))
    delete_after_commit(ctx, keys)
    for row in rows:
        await events.publish(
            ctx, "files.item.deleted", {"item_id": row.id, "course_id": row.course_id}
        )


async def purge_course(ctx: Ctx, course_id: str) -> None:
    rows = list(
        (
            await ctx.db.scalars(
                select(FilesItem).where(
                    FilesItem.user_id == ctx.user_id, FilesItem.course_id == course_id
                )
            )
        ).all()
    )
    await purge_items(ctx, rows)
    await ctx.db.execute(
        delete(FilesFolder).where(
            FilesFolder.user_id == ctx.user_id, FilesFolder.course_id == course_id
        )
    )


# --- quota ----------------------------------------------------------------------------------


@storage_usage_provider("files")
async def files_usage_bytes(ctx: Ctx) -> int:
    total = await ctx.db.scalar(
        select(func.coalesce(func.sum(FilesItem.size_bytes), 0)).where(
            FilesItem.user_id == ctx.user_id,
            FilesItem.kind == "file",
            FilesItem.storage_key.is_not(None),
        )
    )
    return int(total or 0)


async def usage(ctx: Ctx) -> FilesUsageGet:

    total = await core_usage(ctx)
    return FilesUsageGet(
        used_bytes=total.used_bytes,
        files_bytes=total.by_module.get("files", 0),
        quota_bytes=total.quota_bytes,
        max_upload_bytes=ctx.settings.files_max_upload_bytes,
        vector_files=await ctx.db.scalar(
            select(func.count())
            .select_from(FilesIndexState)
            .where(
                FilesIndexState.user_id == ctx.user_id,
                FilesIndexState.vector_document_id.is_not(None),
            )
        )
        or 0,
    )


_OFFICE_MIMES = frozenset({DOCX, PPTX, XLSX, "application/x-ole-storage"})


def file_type(mime: str | None) -> FileType:
    if mime == "application/pdf":
        return "pdf"
    if mime in _OFFICE_MIMES:
        return "office"
    if mime and mime.startswith("image/"):
        return "image"
    if mime and mime.startswith("text/"):
        return "text"
    return "other"


async def usage_breakdown(ctx: Ctx) -> FilesUsageBreakdown:
    rows = (
        await ctx.db.execute(
            select(
                FilesItem.course_id,
                FilesItem.mime_type,
                func.count(),
                func.coalesce(func.sum(FilesItem.size_bytes), 0),
            )
            .where(
                FilesItem.user_id == ctx.user_id,
                FilesItem.kind == "file",
                FilesItem.storage_key.is_not(None),
            )
            .group_by(FilesItem.course_id, FilesItem.mime_type)
        )
    ).all()
    per_course: dict[str, list[int]] = {}
    per_type: dict[FileType, list[int]] = {}
    for course_id, mime, files, size in rows:
        for totals in (
            per_course.setdefault(course_id, [0, 0]),
            per_type.setdefault(file_type(mime), [0, 0]),
        ):
            totals[0] += files
            totals[1] += size
    by_course: list[CourseUsage] = []
    courses = await academics.courses_by_id(ctx, list(per_course))
    for program_id in sorted({c.program_id for c in courses}):
        program = await academics.get_program_row(ctx, program_id)
        own = [c for c in courses if c.program_id == program_id]
        for course in await academics.courses_out(ctx, program, own):
            files, size = per_course[course.id]
            by_course.append(
                CourseUsage(
                    course_id=course.id,
                    program_id=program_id,
                    program_name=program.name,
                    name=course.alias or course.code or course.title,
                    color=course.resolved_color,
                    files=files,
                    bytes=size,
                )
            )
    return FilesUsageBreakdown(
        by_course=sorted(by_course, key=lambda c: (-c.bytes, c.name)),
        by_type=sorted(
            (TypeUsage(type=t, files=f, bytes=b) for t, (f, b) in per_type.items()),
            key=lambda t: -t.bytes,
        ),
    )
