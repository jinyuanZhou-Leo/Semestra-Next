"""Course files: folders, uploads, links, listing and removal (M07 §2, §4, §5)."""

import re
from collections.abc import AsyncIterable, Iterable, Sequence
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from sqlalchemy import delete, func, select

from semestra.core.context import Ctx
from semestra.core.db import new_id
from semestra.core.errors import AppError, not_found
from semestra.core.events import events
from semestra.core.jobs import CoreJob, enqueue
from semestra.core.storage import StoredObject, get_storage, remaining_quota, storage_usage_provider
from semestra.core.storage import usage as core_usage
from semestra.modules.academics import service as academics
from semestra.modules.files import indexing
from semestra.modules.files.models import (
    FilesDocument,
    FilesFolder,
    FilesIndexState,
    FilesItem,
)
from semestra.modules.files.parse import detect
from semestra.modules.files.schemas import (
    MAX_FOLDER_DEPTH,
    FilesItemList,
    FilesItemListInput,
    FilesUsageGet,
    FolderDeleteInput,
    FolderOut,
    ItemOut,
    ItemRef,
    ItemUpdateInput,
    SourceKind,
)
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
        raise not_found()
    return row


async def get_folder(ctx: Ctx, folder_id: str, course_id: str | None = None) -> FilesFolder:
    stmt = select(FilesFolder).where(
        FilesFolder.id == folder_id, FilesFolder.user_id == ctx.user_id
    )
    if course_id is not None:
        stmt = stmt.where(FilesFolder.course_id == course_id)
    row = await ctx.db.scalar(stmt)
    if row is None:
        raise not_found()
    return row


# Targets for the assistant's confirmation cards of deletes (M12 §3.5): what goes, by name.


async def preview_item_delete(ctx: Ctx, inp: ItemRef) -> dict[str, Any]:
    row = await get_item(ctx, inp.item_id)
    return {"target": row.display_name, "changes": []}


async def preview_folder_delete(ctx: Ctx, inp: FolderDeleteInput) -> dict[str, Any]:
    """What goes with the folder: its files (by name) and subfolders."""
    row = await get_folder(ctx, inp.folder_id)
    tree, items = await _folder_contents(ctx, row)
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
                .order_by(FilesFolder.position, func.lower(FilesFolder.name))
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
                    CoreJob.kind == "files.process",
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
                pinned=r.pinned,
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
        position=row.position,
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
    if not inp.recursive:
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
            raise not_found()
        if _depth(parent, by_id) >= MAX_FOLDER_DEPTH:
            raise AppError("files.folder_depth", 422, max=MAX_FOLDER_DEPTH)
    await _check_free_name(ctx, course_id, parent_id, name)
    siblings = [f for f in folders if f.parent_id == parent_id]
    row = FilesFolder(
        user_id=ctx.user_id,
        course_id=course_id,
        parent_id=parent_id,
        name=name,
        position=max((f.position for f in siblings), default=-1) + 1,
        created_at=ctx.now,
        updated_at=ctx.now,
    )
    ctx.db.add(row)
    await ctx.db.flush()
    await events.publish(ctx, "files.folder.created", {"folder_id": row.id, "course_id": course_id})
    return folder_out(row, {})


async def update_folder(
    ctx: Ctx,
    folder_id: str,
    fields: set[str],
    name: str | None,
    parent_id: str | None,
    position: int | None,
) -> FolderOut:
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
    if position is not None and "position" in fields:
        row.position = position
    row.updated_at = ctx.now
    await ctx.db.flush()
    await events.publish(
        ctx, "files.folder.updated", {"folder_id": row.id, "course_id": row.course_id}
    )
    return folder_out(row, await _folder_counts(ctx, row.course_id))


async def _folder_contents(ctx: Ctx, row: FilesFolder) -> tuple[set[str], list[FilesItem]]:
    """(the folder and its subfolders, the files in any of them): what deleting it removes."""
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
    return tree, items


async def delete_folder(ctx: Ctx, folder_id: str, recursive: bool) -> None:
    row = await get_folder(ctx, folder_id)
    tree, items = await _folder_contents(ctx, row)
    if (items or len(tree) > 1) and not recursive:
        raise AppError("files.folder_not_empty", 409)
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
    ctx: Ctx, *, filename: str | None, stream: AsyncIterable[bytes], budget: int | None
) -> StagedFile:
    """Writes one upload to storage, cut off above the per-file limit or `budget` (the quota
    left, None = unlimited). No database write happens here, so no write lock is held while
    the bytes arrive; `add_staged_files` makes the rows."""
    if budget is not None and budget <= 0:
        raise await _quota_error(ctx)
    storage = get_storage(ctx)
    cap = ctx.settings.files_max_upload_bytes
    limit = cap if budget is None else min(cap, budget)
    item_id = new_id()
    key = storage_key(ctx.user_id, item_id)
    try:
        stored = await storage.put(key, stream, "application/octet-stream", max_bytes=limit)
    except AppError as exc:
        if exc.code != "common.quota_exceeded":
            raise
        if budget is None or cap <= budget:
            raise AppError("files.too_large", 413, max=cap) from None
        raise await _quota_error(ctx) from None
    try:
        name = _safe_name(filename)
        detected = detect(await _read_all(ctx, key), name)
    except BaseException:
        await storage.delete(key)
        raise
    return StagedFile(item_id, name, stored, detected.mime, detected.kind in PARSEABLE)


async def add_staged_files(
    ctx: Ctx,
    course_id: str,
    folder_id: str | None,
    staged: Sequence[StagedFile],
    source_kind: SourceKind = "upload",
    source_ref: str | None = None,
) -> list[FilesItem]:
    """Creates the rows for staged files and checks the quota again with them counted. The
    first insert takes SQLite's write lock, so two uploads racing for the last free bytes are
    decided one after the other. Nothing is committed here; on error the caller deletes the
    staged bytes."""
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
    await ctx.db.flush()
    current = await core_usage(ctx)
    if current.quota_bytes > 0 and current.used_bytes > current.quota_bytes:
        raise AppError(
            "common.quota_exceeded", 413, used=current.used_bytes, quota=current.quota_bytes
        )
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
    staged = await stage_file(
        ctx, filename=filename, stream=stream, budget=await remaining_quota(ctx)
    )
    try:
        [row] = await add_staged_files(ctx, course_id, folder_id, [staged], source_kind, source_ref)
    except BaseException:
        await get_storage(ctx).delete(staged.stored.key)
        raise
    return row


async def _quota_error(ctx: Ctx) -> AppError:
    current = await core_usage(ctx)
    return AppError(
        "common.quota_exceeded", 413, used=current.used_bytes, quota=current.quota_bytes
    )


async def _read_all(ctx: Ctx, key: str) -> bytes:
    return b"".join([chunk async for chunk in get_storage(ctx).open(key)])


async def enqueue_processing(ctx: Ctx, row: FilesItem) -> None:
    from semestra.modules.files.jobs import ProcessPayload

    await enqueue(
        ctx, "files.process", ProcessPayload(item_id=row.id), dedupe_key=f"{row.id}:{row.sha256}"
    )


async def save_bytes_as_file(
    ctx: Ctx,
    course_id: str,
    name: str,
    stream: AsyncIterable[bytes],
    source_kind: SourceKind,
    source_ref: str | None = None,
    folder_id: str | None = None,
) -> ItemOut:
    """For other modules (M09 saves Canvas files, M12 files the agent generates)."""
    row = await store_file(
        ctx,
        course_id=course_id,
        filename=name,
        stream=stream,
        folder_id=folder_id,
        source_kind=source_kind,
        source_ref=source_ref,
    )
    return await item_out(ctx, row)


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
    ctx: Ctx, course_id: str, url: str, display_name: str | None, folder_id: str | None
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
        doc_status="none",
        created_at=ctx.now,
        updated_at=ctx.now,
    )
    ctx.db.add(row)
    await ctx.db.flush()
    await events.publish(ctx, "files.item.created", {"item_id": row.id, "course_id": course_id})
    return await item_out(ctx, row)


async def update_item(ctx: Ctx, inp: ItemUpdateInput) -> ItemOut:
    row = await get_item(ctx, inp.item_id)
    sent = inp.model_fields_set
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
    if row.kind != "file" or not row.storage_key:
        raise AppError("files.unsupported_type", 422)
    detected = detect(await _read_all(ctx, row.storage_key), row.original_name)
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
    storage = get_storage(ctx)

    async def remove() -> None:
        for key in keys:
            await storage.delete(key)

    ctx.after_commit.append(remove)
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
            FilesItem.user_id == ctx.user_id, FilesItem.kind == "file"
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
    )
