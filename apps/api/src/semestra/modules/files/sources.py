"""Files another module keeps in step with its source (M07 §2.3): the files module's interface
for source modules (M09 keeps a linked course's files, pages and links in the course's files).

A source registers where its bytes come from (`content.register_content_source`) and keeps its
items here with these functions: an item for a file it keeps (`add_remote_file`, stored nowhere,
taking no quota) or a link (`create_link` with a `source_ref`), updated when the source changes
(`update_remote_file`, `rename_synced`, `update_link`), read again after the source failed
(`retry_synced`), let go of (`purge_items`) or handed to the user (`detach_from_source`).
`find_items`, `get_folder` and `folder_names` read what it keeps. It puts its items in the
folders of their places on the source (`source_folders.SourceFolders`), and tells "Organize" where
the items it put somewhere else belong (`register_homes`).
A source module reads and writes `files_*` only through these.

A file that follows its source is read from it when opened, or has a local copy here; either
way it keeps following (updated, removed). The source's setting for the course says which
(`apply_copies`), unless the user chose for the file (`keep_copy`, `drop_copy`: `FilesItem.
keep_copy`). Only `make_own` (or `detach_from_source`) ends the following: the file becomes the
user's own, with its bytes stored here.
"""

import hashlib
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select

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
from semestra.modules.files import content, items, service
from semestra.modules.files.folders import folder_names
from semestra.modules.files.items import create_link, save_bytes_as_file
from semestra.modules.files.models import FilesDocument, FilesItem
from semestra.modules.files.parse.detect import DOCX, PPTX, XLSX
from semestra.modules.files.schemas import SourceKind
from semestra.modules.files.service import find_items, get_folder, purge_items
from semestra.modules.files.settings import auto_index

__all__ = [
    "SOURCE_UNREAD",
    "add_remote_file",
    "apply_copies",
    "create_link",
    "detach_from_source",
    "drop_copy",
    "find_items",
    "folder_names",
    "get_folder",
    "keep_copy",
    "make_own",
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
    source_name: str,
    modified_at: datetime | None,
    unseen: bool,
    source_kind: SourceKind = "lms",
) -> FilesItem:
    """An item for a file kept by another module (`content.py`): stored nowhere, so it takes
    no quota. `version` names the source's version of the bytes (it changes when they do), `url`
    where the source shows the file, `modified_at` when the source last changed it; `unseen`
    marks it new until the user opens it. Processed like an upload."""
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
        source_name=source_name,
        source_modified_at=modified_at,
        unseen=unseen,
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
    modified_at: datetime | None,
) -> None:
    """The source's file changed: its new metadata, and its text read again. `name` replaces
    the shown name (None: the user renamed it, keep theirs); its place is never changed. A local
    copy is kept until the new bytes replace it (`apply_copies` stores them, `store_from_source`
    swaps them in and reads the text again): until then the item opens as the copy it has, and
    the platform deleting it meanwhile still hands that copy over."""
    if name is not None:
        row.display_name = row.original_name = service.safe_name(name)
    row.url, row.source_modified_at = url, modified_at
    row.sha256 = _version_hash(version)
    row.updated_at = ctx.now
    if row.storage_key:
        row.source_mime, row.source_size = mime, size
        await _updated(ctx, row)
        return
    row.mime_type, row.size_bytes = mime, size
    status, error = _remote_status(ctx, row.original_name or row.display_name, mime, size)
    if status == "pending" and not await auto_index(ctx, row.course_id):
        status = "none"
    row.doc_status, row.doc_error_code = status, error
    await ctx.db.flush()
    if status == "pending":
        await service.enqueue_processing(ctx, row, synced=True)
    await events.publish(ctx, "files.item.updated", {"item_id": row.id, "course_id": row.course_id})


async def _release(ctx: Ctx, row: FilesItem) -> bool:
    """Lets the local copy go (deleted once the transaction commits): the item is read from its
    source again, its newer version if the copy held an older one. False when it had none."""
    if not row.storage_key:
        return False
    delete_after_commit(ctx, [row.storage_key])
    older = row.copy_version != row.sha256
    row.storage_key = row.copy_version = None
    _take_source_meta(row)
    row.updated_at = ctx.now
    if older:
        await _read_new_bytes(ctx, row)
    return True


def _take_source_meta(row: FilesItem) -> None:
    """The type and size of the source's version the item now holds (see `source_mime`)."""
    if row.source_mime is not None:
        row.mime_type = row.source_mime
    if row.source_size is not None:
        row.size_bytes = row.source_size
    row.source_mime = row.source_size = None


def _outdated(row: FilesItem) -> bool:
    """Its bytes are not the source's current version: none here, or an older local copy."""
    return not row.storage_key or row.copy_version != row.sha256


async def _check_room(ctx: Ctx, row: FilesItem) -> None:
    """Refuses now what can be told now about storing a copy: too large, no quota left."""
    cap = ctx.settings.files_max_upload_bytes
    if row.size_bytes > cap:
        raise AppError("files.too_large", 413, max=cap)
    left = await remaining_quota(ctx)
    if left is not None and row.size_bytes > left:
        current = await core_usage(ctx)
        raise AppError(
            "common.quota_exceeded", 413, used=current.used_bytes, quota=current.quota_bytes
        )


async def _store(ctx: Ctx, row: FilesItem, *, own: bool) -> None:
    from semestra.modules.files.jobs import KeepPayload

    await enqueue(
        ctx,
        "files.store_copy",
        KeepPayload(item_ids=[row.id], own=own),
        dedupe_key=f"files.store_copy:{row.id}",
    )


async def _updated(ctx: Ctx, row: FilesItem) -> None:
    await ctx.db.flush()
    await events.publish(ctx, "files.item.updated", {"item_id": row.id, "course_id": row.course_id})


async def keep_copy(ctx: Ctx, row: FilesItem) -> None:
    """The user keeps a local copy of a file that follows its source, whatever the source's
    setting: stored in a listed job (its failure shows in the status bar), so it still opens
    once the source is gone (a course closed on the LMS). It still follows its source."""
    if not content.follows_source(row):
        return
    row.keep_copy = True
    if _outdated(row):
        await _check_room(ctx, row)
        await _store(ctx, row, own=False)
    await _updated(ctx, row)


async def drop_copy(ctx: Ctx, row: FilesItem) -> None:
    """The user reads a file that follows its source from there again, whatever the source's
    setting: its local copy is let go, freeing its storage."""
    if not content.follows_source(row):
        return
    row.keep_copy = False
    await _release(ctx, row)
    await _updated(ctx, row)


async def make_own(ctx: Ctx, row: FilesItem) -> None:
    """The user makes a file that follows its source their own: no longer updated or removed by
    the source. Its bytes must be here first: a file read from its source is stored in a listed
    job and handed over once they are (`store_from_source`); one that can't be stored (the
    source is unreachable) stays as it was and the job's failure says why."""
    if not content.follows_source(row):
        return
    if not _outdated(row):
        await detach_from_source(ctx, [row])
        return
    await _check_room(ctx, row)
    await _store(ctx, row, own=True)


async def apply_copies(ctx: Ctx, rows: Sequence[FilesItem], local: bool, *, dedupe: str) -> None:
    """Brings the files that follow their source in line with the source's setting for their
    course (`local`: keep local copies), except where the user chose for a file (`keep_copy`).
    Copies no longer wanted are let go at once; wanted ones are stored quietly in the background
    as far as the quota goes (by the source's sizes, so a full quota downloads nothing): the
    rest stay read from the source."""
    cap = ctx.settings.files_max_upload_bytes
    left = await remaining_quota(ctx)
    ids: list[str] = []
    for row in rows:
        if not content.follows_source(row):
            continue
        want = row.keep_copy if row.keep_copy is not None else local
        if not want:
            if await _release(ctx, row):
                await _updated(ctx, row)
            continue
        if not _outdated(row) or row.size_bytes > cap:
            continue
        if left is not None:
            if row.size_bytes > left:
                continue
            left -= row.size_bytes
        ids.append(row.id)
    if ids:
        from semestra.modules.files.jobs import KeepPayload

        await enqueue(
            ctx, "files.store_synced_copies", KeepPayload(item_ids=ids), dedupe_key=dedupe
        )


async def store_from_source(ctx: Ctx, item_id: str, *, quiet: bool, own: bool = False) -> bool:
    """Stores one file read from its source (the copy jobs). The source is opened in a short
    transaction, the bytes are written to storage holding no database lock, and the item takes
    them in another short transaction. Each run stages under a key of its own, so two runs for
    one item never touch each other's bytes. `quiet` (the source's setting): a file the user
    chose to read from its source meanwhile is left alone. `own`: the item becomes the user's
    own file in the transaction that has its bytes stored, so a failure leaves it following.
    False (`quiet` only): the quota is full and nothing changed; otherwise that and every other
    failure raise."""
    opened: list[AsyncIterator[bytes]] = []
    version: list[str | None] = []  # of the bytes opened

    def wanted(row: FilesItem | None) -> bool:
        return (
            row is not None
            and content.follows_source(row)
            and not (quiet and row.keep_copy is False)
        )

    async def open_(sys_ctx: Ctx) -> None:
        row = await sys_ctx.db.get(FilesItem, item_id)
        if row is None or not wanted(row):
            return
        if _outdated(row):
            version.append(row.sha256)
            opened.append(await content.open_source(sys_ctx, row))
        elif own:  # stored meanwhile: hand it over now
            await detach_from_source(sys_ctx, [row])

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
        if row is None or not wanted(row):
            return
        # Else the same version was stored meanwhile: these bytes are not needed.
        if not row.storage_key or row.copy_version != version[0]:
            older = row.storage_key
            row.storage_key, row.copy_version = staged.stored.key, version[0]
            if version[0] == row.sha256:
                _take_source_meta(row)
            row.size_bytes = staged.stored.size
            taken.append(True)
            if older:  # a newer version replaces the copy: its text is read again
                delete_after_commit(sys_ctx, [older])
                await _read_new_bytes(sys_ctx, row)
        row.updated_at = sys_ctx.now
        await charge(sys_ctx)
        if own:
            await detach_from_source(sys_ctx, [row])
        else:
            await _updated(sys_ctx, row)

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


async def _read_new_bytes(ctx: Ctx, row: FilesItem) -> None:
    status = "pending" if await auto_index(ctx, row.course_id) else "none"
    row.doc_status, row.doc_error_code = status, None
    await ctx.db.flush()
    if status == "pending":
        await service.enqueue_processing(ctx, row, synced=True)


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
    """Files with a local copy become the user's own (`make_own`, or the source no longer keeps
    them: an LMS course unlinked, the file deleted there): plain files from now on (`source_ref`
    cleared), never updated or removed by the source."""
    for row in rows:
        assert row.storage_key
        row.source_ref = row.source_name = row.keep_copy = None
        # The version it holds (an older one if the newest was still being fetched).
        row.sha256 = row.copy_version or row.sha256
        row.copy_version = row.source_mime = row.source_size = None
        row.updated_at = ctx.now
        await _updated(ctx, row)


async def update_link(ctx: Ctx, row: FilesItem, *, url: str, name: str | None) -> None:
    """Another module's link moved (and, unless None, was renamed); its place stays."""
    row.url = items.normalize_url(url)
    if name is not None:
        row.display_name = service.clean_name(name)
    row.updated_at = ctx.now
    await ctx.db.flush()
    await events.publish(ctx, "files.item.updated", {"item_id": row.id, "course_id": row.course_id})


# --- where items belong ---------------------------------------------------------------------


@dataclass(frozen=True)
class Home:
    """Where an item of a source belongs on it (folder names from the top), for an item the
    user has not moved since the source put it somewhere else."""

    item_id: str
    path: tuple[str, ...]
    source_kind: str
    source_name: str


HomeFinder = Callable[[Ctx, str], Awaitable[list[Home]]]
# Told the folder each item was moved back to: it is where the source put it now.
MovedBack = Callable[[Ctx, Mapping[str, str | None]], Awaitable[None]]
_home_finders: dict[str, tuple[HomeFinder, MovedBack]] = {}


def register_homes(source_kind: str, finder: HomeFinder, moved_back: MovedBack) -> None:
    """`finder(ctx, course_id)` gives the course's items of this source that sit where the
    source once put them, away from their place on it; `moved_back(ctx, {item: folder})` is
    told when the user moves them back (by "Organize")."""
    _home_finders[source_kind] = (finder, moved_back)


async def homes(ctx: Ctx, course_id: str) -> list[Home]:
    return [home for finder, _ in _home_finders.values() for home in await finder(ctx, course_id)]


async def moved_back(ctx: Ctx, source_kind: str, placed: Mapping[str, str | None]) -> None:
    if (known := _home_finders.get(source_kind)) is not None:
        await known[1](ctx, placed)


# --- reading scanned pages of synced files --------------------------------------------------

ScansSetting = Callable[[Ctx, str], Awaitable[bool]]
_scans: list[ScansSetting] = []


def register_synced_scans(setting: ScansSetting) -> None:
    """`setting(ctx, course_id)`: whether the user's AI provider reads the scanned pages of the
    files the source syncs into that course (its own setting: hundreds come at once, and nobody
    asked). Without it they are read when the user processes a file again."""
    _scans.append(setting)


async def synced_scans(ctx: Ctx, course_id: str) -> bool:
    return any([await setting(ctx, course_id) for setting in _scans])


async def read_skipped_scans(ctx: Ctx, course_ids: Sequence[str]) -> None:
    """The source's setting turned on for these courses: their synced files whose scanned pages
    were skipped are read again, now by the provider (the user just asked for it)."""
    rows = await ctx.db.scalars(
        select(FilesItem)
        .join(FilesDocument, FilesDocument.id == FilesItem.active_document_id)
        .where(
            FilesItem.user_id == ctx.user_id,
            FilesItem.course_id.in_(list(course_ids)),
            FilesItem.doc_status == "ready",
            FilesDocument.ocr_skipped_pages > 0,
        )
    )
    for row in rows:
        if content.follows_source(row):
            await read_again_synced(ctx, row)
