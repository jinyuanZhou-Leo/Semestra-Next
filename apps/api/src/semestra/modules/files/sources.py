"""Files another module keeps in step with its source (M07 §2.3): the files module's interface
for source modules (M09 keeps a linked course's files, pages and links in the course's files).

A source registers where its bytes come from (`content.register_content_source`) and keeps its
items here with these functions: an item for a file it keeps (`add_remote_file`, stored nowhere,
taking no quota) or a link (`create_link` with a `source_ref`), updated when the source changes
(`update_remote_file`, `rename_synced`, `update_link`), read again after the source failed
(`retry_synced`), stored here for the source (`keep_synced_offline`) or as the user's own copy
(`keep_offline`), let go of (`purge_items`) or handed to the user (`detach_from_source`).
`find_items` and `get_folder` read what it keeps; the type folders are `sorting`'s. A source module
reads and writes `files_*` only through these.
"""

import hashlib
from collections.abc import AsyncIterator, Sequence

from semestra.core.context import Ctx, run_as_system
from semestra.core.db import new_id
from semestra.core.errors import AppError
from semestra.core.events import events
from semestra.core.jobs import enqueue
from semestra.core.storage import (
    charge,
    delete_after_commit,
    get_storage,
    remaining_quota,
    stage,
)
from semestra.core.storage import usage as core_usage
from semestra.modules.files import content, service
from semestra.modules.files.models import FilesItem
from semestra.modules.files.parse.detect import DOCX, PPTX, XLSX
from semestra.modules.files.schemas import SourceKind
from semestra.modules.files.service import (
    create_link,
    find_items,
    get_folder,
    purge_items,
    save_bytes_as_file,
)
from semestra.modules.files.settings import auto_index

__all__ = [
    "SOURCE_UNREAD",
    "add_remote_file",
    "create_link",
    "detach_from_source",
    "find_items",
    "get_folder",
    "keep_offline",
    "keep_synced_offline",
    "purge_items",
    "read_again_synced",
    "remote",
    "rename_synced",
    "retry_synced",
    "save_bytes_as_file",
    "store_from_source",
    "update_link",
    "update_remote_file",
]

remote = content.remote

# A file read from its source that has not been read yet (restored from a backup).
SOURCE_UNREAD = "files.source_unread"

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
    clean = service.safe_name(name)
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
        await service.enqueue_processing(ctx, row, synced=True)
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
        row.display_name = row.original_name = service.safe_name(name)
    row.mime_type, row.size_bytes, row.url = mime, size, url
    row.sha256 = _version_hash(version)
    status, error = _remote_status(ctx, row.original_name or row.display_name, mime, size)
    if status == "pending" and not await auto_index(ctx, row.course_id):
        status = "none"
    row.doc_status, row.doc_error_code = status, error
    row.updated_at = ctx.now
    await ctx.db.flush()
    if status == "pending":
        await service.enqueue_processing(ctx, row, synced=True)
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
            f"{service.storage_key(ctx.user_id or '', item_id)}-{new_id()}",
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
        await service.enqueue_processing(ctx, row, synced=True)
    await events.publish(ctx, "files.item.updated", {"item_id": row.id, "course_id": row.course_id})


async def read_again_synced(ctx: Ctx, row: FilesItem) -> None:
    """Reads a synced file again in the background (its source's settings changed); the version
    read so far stays searchable until then."""
    row.doc_status, row.doc_error_code, row.updated_at = "pending", None, ctx.now
    await ctx.db.flush()
    await service.enqueue_processing(ctx, row, synced=True)
    await events.publish(ctx, "files.item.updated", {"item_id": row.id, "course_id": row.course_id})


async def rename_synced(ctx: Ctx, row: FilesItem, name: str) -> None:
    """The source renamed its file (the bytes are the same)."""
    row.display_name = row.original_name = service.safe_name(name)
    row.updated_at = ctx.now
    await ctx.db.flush()
    await events.publish(ctx, "files.item.updated", {"item_id": row.id, "course_id": row.course_id})


async def detach_from_source(ctx: Ctx, rows: Sequence[FilesItem]) -> None:
    """The source no longer keeps these copies the user kept (an LMS course unlinked): they are
    plain files of the user's from now on (`source_ref` cleared), with nothing to read again."""
    for row in rows:
        row.source_ref, row.kept_offline, row.updated_at = None, False, ctx.now
    await ctx.db.flush()


async def update_link(ctx: Ctx, row: FilesItem, *, url: str, name: str | None) -> None:
    """Another module's link moved (and, unless None, was renamed); its place stays."""
    row.url = service.normalize_url(url)
    if name is not None:
        row.display_name = service.clean_name(name)
    row.updated_at = ctx.now
    await ctx.db.flush()
    await events.publish(ctx, "files.item.updated", {"item_id": row.id, "course_id": row.course_id})
