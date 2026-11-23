"""Files another module keeps in step with its source (M07 §2.3): the files module's interface
for source modules (M09 keeps a linked course's files, pages and links in the course's files).

A source registers where its bytes come from (`content.register_content_source`) and keeps its
items here with these functions: an item for a file it keeps (`add_remote_file`, stored nowhere,
taking no quota) or a link (`create_link` with a `source_kind`), updated when the source changes
(`update_remote_file`, `rename_synced`, `update_link`), read again after the source failed
(`retry_synced`), let go of (`purge_items`) or handed to the user (`detach_from_source`).
`find_items`, `get_folder` and `folder_names` read what it keeps. Its titles become names here
as `name_from_source` makes them, and a link's address must pass `normalize_url`. It puts its
items in the folders of their places on the source (`source_folders.SourceFolders`), and tells
"Organize" where the items it put somewhere else belong (`register_homes`).
A source module reads and writes `files_*` only through these.

A file that follows its source is read from it when opened, or has a local copy here; either
way it keeps following (updated, removed). The source's setting for the course says which
(`apply_copies`), unless the user chose for the file (`keep_copy`, `drop_copy`: `FilesItem.
keep_copy`). Only the source ends the following (`detach_from_source`: the file is gone there, or
the course is no longer linked): a file stored here becomes the user's own.
"""

import hashlib
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from urllib.parse import urlsplit

from sqlalchemy import select

from semestra.core.context import Ctx, run_as_system
from semestra.core.db import new_id
from semestra.core.errors import AppError
from semestra.core.events import events
from semestra.core.jobs import CoreJob, enqueue, withdraw
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
from semestra.modules.files.items import (
    create_link,
    find_duplicate,
    normalize_url,
    save_bytes_as_file,
)
from semestra.modules.files.models import FilesDocument, FilesDocumentPage, FilesItem
from semestra.modules.files.parse.detect import DOCX, PPTX, XLSX
from semestra.modules.files.schemas import SourceKind
from semestra.modules.files.service import find_items, get_folder, name_from_source, purge_items

__all__ = [
    "SOURCE_UNREAD",
    "add_remote_file",
    "apply_copies",
    "create_link",
    "current_copy",
    "detach_from_source",
    "document_pages",
    "drop_copy",
    "find_duplicate",
    "find_items",
    "folder_names",
    "get_folder",
    "keep_copy",
    "name_from_source",
    "normalize_url",
    "purge_items",
    "remote",
    "rename_synced",
    "reset_copy_choices",
    "retry_synced",
    "save_bytes_as_file",
    "source_changed",
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


def _remote_status(ctx: Ctx, name: str, mime: str | None, size: int) -> tuple[str, str | None]:
    if not _readable(name, mime):
        return "unsupported", "files.unsupported_type"
    if size > ctx.settings.files_max_upload_bytes:
        # Not the user's file to make smaller: it opens, its text is just not read.
        return "unsupported", "files.too_large"
    return "none", None  # readable: `service.request_read` says when


async def add_remote_file(
    ctx: Ctx,
    course_id: str,
    folder_id: str | None,
    *,
    name: str,
    mime: str | None,
    size: int,
    version: str,
    url: str | None,
    modified_at: datetime | None,
    unseen: bool,
    source_kind: SourceKind = "lms",
) -> FilesItem:
    """An item for a file kept by another module (`content.py`): stored nowhere, so it takes
    no quota. `version` names the source's version of the bytes (it changes when they do), `url`
    where the source shows the file, `modified_at` when the source last changed it; `unseen`
    marks it new until the user opens it. Processed like an upload."""
    status, error = _remote_status(ctx, name, mime, size)
    clean = service.name_from_source(name, "file")
    row = FilesItem(
        user_id=ctx.user_id,
        course_id=course_id,
        folder_id=folder_id,
        kind="file",
        display_name=clean,
        original_name=clean,
        mime_type=mime,
        size_bytes=size,
        source_version=content.version_hash(version),
        source_mime=mime,
        source_size=size,
        url=url,
        source_kind=source_kind,
        source_modified_at=modified_at,
        unseen=unseen,
        doc_status=status,
        doc_error_code=error,
        created_at=ctx.now,
        updated_at=ctx.now,
    )
    ctx.db.add(row)
    await ctx.db.flush()
    if row.doc_status != "unsupported":
        await service.request_read(ctx, row, "source")
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
        row.display_name = row.original_name = service.name_from_source(name, "file")
    row.url, row.source_modified_at = url, modified_at
    row.source_version = content.version_hash(version)
    row.source_mime, row.source_size = mime, size
    row.updated_at = ctx.now
    if row.storage_key:  # opens as its copy until the new bytes replace it
        await _updated(ctx, row)
        return
    row.mime_type, row.size_bytes = mime, size
    status, error = _remote_status(ctx, row.original_name or row.display_name, mime, size)
    row.doc_status, row.doc_error_code = status, error
    if status != "unsupported":
        await service.request_read(ctx, row, "source")
    await ctx.db.flush()
    await events.publish(ctx, "files.item.updated", {"item_id": row.id, "course_id": row.course_id})


# --- the local copy -------------------------------------------------------------------------
# A followed file's source side (`source_version`, `source_mime`, `source_size`) is the
# source's current version; its copy side (`storage_key`, `sha256`, `copy_version`,
# `copy_modified_at`, `copy_error_code`) what is stored here. `mime_type` and `size_bytes` are
# the file as it opens. Only `_take_copy` and `_release` change the copy side, and they read the
# text again when the version the file opens as (`content.version`) changes.


async def _reread_if_changed(ctx: Ctx, row: FilesItem, before: str | None) -> None:
    if content.version(row) != before and row.doc_status != "unsupported":
        await service.request_read(ctx, row, "source")


def _take_copy(row: FilesItem, key: str, sha256: str, size: int, version: str | None) -> None:
    row.storage_key, row.sha256, row.size_bytes = key, sha256, size
    row.copy_version, row.copy_error_code = version, None
    current = version == row.source_version
    if current and row.source_mime is not None:
        row.mime_type = row.source_mime
    row.copy_modified_at = row.source_modified_at if current else None


async def _release(ctx: Ctx, row: FilesItem) -> bool:
    """Lets the local copy go (deleted once the transaction commits): the item opens as the
    source's current version again. False when it had none."""
    row.copy_error_code = None
    if not row.storage_key:
        return False
    before = content.version(row)
    delete_after_commit(ctx, [row.storage_key])
    row.storage_key = row.sha256 = row.copy_version = row.copy_modified_at = None
    if row.source_mime is not None:
        row.mime_type = row.source_mime
    row.size_bytes = _source_size(row)
    row.updated_at = ctx.now
    await _reread_if_changed(ctx, row, before)
    return True


def source_changed(row: FilesItem, version: str) -> bool:
    """Whether `version` (the source's version string) is not the one the item follows now
    (`source_version`): the source's only record of an item's version is here (M09 §4.6)."""
    return row.source_version != content.version_hash(version)


def _source_size(row: FilesItem) -> int:
    return row.source_size if row.source_size is not None else row.size_bytes


def _outdated(row: FilesItem) -> bool:
    """Its bytes are not the source's current version: none here, or an older local copy."""
    return not row.storage_key or row.copy_version != row.source_version


def _room_needed(row: FilesItem) -> int:
    """What storing the source's current version adds: replacing a copy takes the difference."""
    return _source_size(row) - (row.size_bytes if row.storage_key else 0)


async def _check_room(ctx: Ctx, row: FilesItem) -> None:
    """Refuses now what can be told now about storing a copy: too large, no quota left."""
    cap = ctx.settings.files_max_upload_bytes
    if _source_size(row) > cap:
        raise AppError("files.too_large", 413, max=cap)
    left = await remaining_quota(ctx)
    if left is not None and _room_needed(row) > left:
        current = await core_usage(ctx)
        raise AppError(
            "common.quota_exceeded", 413, used=current.used_bytes, quota=current.quota_bytes
        )


async def _store(ctx: Ctx, row: FilesItem) -> None:
    from semestra.modules.files.jobs import KeepPayload

    await enqueue(
        ctx,
        "files.store_copy",
        KeepPayload(item_ids=[row.id]),
        dedupe_key=f"files.store_copy:{row.id}",
    )


async def _updated(ctx: Ctx, row: FilesItem) -> None:
    await ctx.db.flush()
    await events.publish(ctx, "files.item.updated", {"item_id": row.id, "course_id": row.course_id})


async def _check_source(ctx: Ctx, row: FilesItem) -> None:
    """Refuses (`files.source_unreachable`) when the source does not give the file now. The
    source is opened in a short transaction of its own (it may write, say renewed credentials)
    and closed right away: opening reads up to the first bytes, which tells."""
    opened: list[AsyncIterator[bytes]] = []

    async def open_(sys_ctx: Ctx) -> None:
        found = await sys_ctx.db.get(FilesItem, row.id)
        if found is not None:
            opened.append(await content.open_source(sys_ctx, found))

    try:
        await run_as_system(ctx.state, ctx.user_id, open_)
    except AppError as exc:
        names = await content.source_names(ctx, [row])
        raise AppError("files.source_unreachable", 409, source=names.get(row.id, "")) from exc
    for stream in opened:
        await stream.aclose()  # pyright: ignore[reportAttributeAccessIssue]


async def keep_copy(ctx: Ctx, row: FilesItem) -> None:
    """The user keeps a local copy of a file that follows its source, whatever the source's
    setting: stored in a listed job (its failure shows in the status bar), so it still opens
    once the source is gone (a course closed on the LMS). It still follows its source."""
    if not content.follows_source(row):
        return
    row.keep_copy = True
    if _outdated(row):
        await _check_room(ctx, row)
        await _store(ctx, row)
    await _updated(ctx, row)


async def drop_copy(ctx: Ctx, row: FilesItem) -> None:
    """The user reads a file that follows its source from there again, whatever the source's
    setting: its local copy is let go, freeing its storage. Not while the source can't give the
    file (a course closed on the LMS): the copy may be the only one left."""
    if not content.follows_source(row):
        return
    if row.storage_key:
        await _check_source(ctx, row)
    row.keep_copy = False
    await _release(ctx, row)
    await _updated(ctx, row)


async def reset_copy_choices(ctx: Ctx, rows: Sequence[FilesItem]) -> None:
    """The source's setting for these files changed: the user's choices for single files are
    cleared, so each follows the setting (`apply_copies`)."""
    for row in rows:
        if content.follows_source(row) and row.keep_copy is not None:
            row.keep_copy = None
            await _updated(ctx, row)


async def apply_copies(
    ctx: Ctx, rows: Sequence[FilesItem], local: bool, *, release: bool = True
) -> None:
    """Brings the files that follow their source in line with the source's setting for their
    course (`local`: keep local copies), except where the user chose for a file (`keep_copy`).
    Copies no longer wanted are let go at once, unless `release` is False (the source could not
    show it still has them: the copy may be the only one left); wanted ones are stored quietly
    in the background as far as the quota goes (by the source's sizes, so a full quota
    downloads nothing): the rest stay read from the source."""
    from semestra.modules.files.jobs import KeepPayload

    cap = ctx.settings.files_max_upload_bytes
    left = await remaining_quota(ctx)
    unwanted: list[str] = []
    for row in rows:
        if not content.follows_source(row):
            continue
        error = row.copy_error_code
        want = row.keep_copy if row.keep_copy is not None else local
        if not want:
            unwanted.append(_copy_key(row.id))
            row.copy_error_code = None  # not wanted: nothing failed, copy kept or not
            released = release and await _release(ctx, row)
            if released or row.copy_error_code != error:
                await _updated(ctx, row)
            continue
        if not _outdated(row):
            continue
        need = _room_needed(row)
        if _source_size(row) > cap:
            row.copy_error_code = "files.too_large"
        elif left is not None and need > left:
            row.copy_error_code = "common.quota_exceeded"
        else:
            left = None if left is None else left - max(need, 0)
            # A job per file: the one background worker takes a sync queued meanwhile between
            # two of them, and a file added while others wait is queued with them.
            await enqueue(
                ctx,
                "files.store_synced_copies",
                KeepPayload(item_ids=[row.id]),
                dedupe_key=_copy_key(row.id),
                again=True,
            )
        if row.copy_error_code != error:
            await _updated(ctx, row)
    await _drop_queued_copies(ctx, unwanted)


def current_copy(ctx: Ctx, row: FilesItem) -> AsyncIterator[bytes] | None:
    """The bytes of a followed file's local copy, when it is of the source's current version
    (the source's own view opens it without asking the source); None otherwise."""
    if not content.follows_source(row) or _outdated(row) or not row.storage_key:
        return None
    return get_storage(ctx).open(row.storage_key)


async def document_pages(ctx: Ctx, row: FilesItem) -> list[str] | None:
    """The text of a followed file page by page (Markdown), as the course files read it, when
    it has been read for the version it opens as; None otherwise."""
    if row.doc_status != "ready" or row.active_document_id is None:
        return None
    doc = await ctx.db.get(FilesDocument, row.active_document_id)
    if doc is None or doc.status != "ready":
        return None
    pages = await ctx.db.scalars(
        select(FilesDocumentPage.markdown)
        .where(FilesDocumentPage.document_id == doc.id)
        .order_by(FilesDocumentPage.page_no)
    )
    return list(pages)


def _copy_key(item_id: str) -> str:
    return f"files.store_synced_copies:{item_id}"


async def _drop_queued_copies(ctx: Ctx, keys: Sequence[str]) -> None:
    """Copies queued for files that no longer want one (the course reads from its source again
    before they ran) are not stored: one not started is withdrawn, one storing now is not run
    again. A course sync runs before the copy jobs, so this comes before they do."""
    if not keys:
        return
    found = (
        await ctx.db.scalars(
            select(CoreJob).where(
                CoreJob.user_id == ctx.user_id,
                CoreJob.dedupe_key.in_(list(keys)),
                CoreJob.status.in_(("pending", "running")),
            )
        )
    ).all()
    for job in found:
        job.next_payload = None
    await withdraw(ctx, [job.id for job in found if job.status == "pending"])


async def store_from_source(ctx: Ctx, item_id: str, *, quiet: bool) -> bool:
    """Stores one file read from its source (the copy jobs). The source is opened in a short
    transaction, the bytes are written to storage holding no database lock, and the item takes
    them in another short transaction. Each run stages under a key of its own, so two runs for
    one item never touch each other's bytes. `quiet` (the source's setting): a file the user
    chose to read from its source meanwhile is left alone. False (`quiet` only): the quota is
    full and nothing changed; otherwise that and every other failure raise."""
    opened: list[AsyncIterator[bytes]] = []
    version: list[str | None] = []  # of the bytes opened
    replaces: list[int] = []  # the size of the copy they replace (counted in the quota now)

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
            version.append(row.source_version)
            replaces.append(row.size_bytes if row.storage_key else 0)
            opened.append(await content.open_source(sys_ctx, row))

    cap = ctx.settings.files_max_upload_bytes
    try:
        await run_as_system(ctx.state, ctx.user_id, open_)
        if not opened:
            return True
        staged = await stage(
            ctx,
            f"{service.storage_key(ctx.user_id or '', item_id)}-{new_id()}",
            opened[0],
            cap=cap,
            too_large=AppError("files.too_large", 413, max=cap),
            replaces=replaces[0],
        )
    except AppError as exc:
        await _note_failure(ctx, item_id, exc.code)
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
            older, before = row.storage_key, content.version(row)
            stored = staged.stored
            _take_copy(row, stored.key, stored.sha256, stored.size, version[0])
            taken.append(True)
            if older:
                delete_after_commit(sys_ctx, [older])
            await _reread_if_changed(sys_ctx, row, before)
        row.updated_at = sys_ctx.now
        await charge(sys_ctx)
        await _updated(sys_ctx, row)

    try:
        await run_as_system(ctx.state, ctx.user_id, take)
    except AppError as exc:
        await get_storage(ctx).delete(staged.stored.key)
        await _note_failure(ctx, item_id, exc.code)
        if quiet and exc.code == "common.quota_exceeded":
            return False
        raise
    if not taken:
        await get_storage(ctx).delete(staged.stored.key)
    return True


async def _note_failure(ctx: Ctx, item_id: str, code: str) -> None:
    """Why the copy could not be stored, shown with the file until a later attempt stores it
    (the source's next sync, or the user asking again) or the copy is no longer wanted: not
    noted for a file the user chose to read from its source meanwhile."""

    async def note(sys_ctx: Ctx) -> None:
        row = await sys_ctx.db.get(FilesItem, item_id)
        if (
            row is not None
            and content.follows_source(row)
            and row.keep_copy is not False
            and row.copy_error_code != code
        ):
            row.copy_error_code = code
            await _updated(sys_ctx, row)

    await run_as_system(ctx.state, ctx.user_id, note)


async def _hash_stored(ctx: Ctx, key: str) -> str:
    digest = hashlib.sha256()
    async for chunk in get_storage(ctx).open(key):
        digest.update(chunk)
    return digest.hexdigest()


async def retry_synced(ctx: Ctx, row: FilesItem) -> None:
    """Reads a file from its source again after the source failed (or was never read); the
    source's sync decides when (M09 retries once its platform answers again)."""
    await service.request_read(ctx, row, "source")
    await events.publish(ctx, "files.item.updated", {"item_id": row.id, "course_id": row.course_id})


async def rename_synced(ctx: Ctx, row: FilesItem, name: str) -> None:
    """The source renamed its file (the bytes are the same)."""
    row.display_name = row.original_name = service.name_from_source(name, "file")
    row.updated_at = ctx.now
    await ctx.db.flush()
    await events.publish(ctx, "files.item.updated", {"item_id": row.id, "course_id": row.course_id})


async def detach_from_source(ctx: Ctx, rows: Sequence[FilesItem]) -> None:
    """Files with a local copy become the user's own when the source no longer keeps them (an
    LMS course unlinked, the file deleted there): plain files from now on (`source_kind`
    cleared, and the source's address with it), never updated or removed by the source."""
    for row in rows:
        assert row.storage_key
        before = service.process_key(row)
        if row.sha256 is None:  # a copy stored before copies kept their hash (migration 0062)
            row.sha256 = await _hash_stored(ctx, row.storage_key)
        row.source_kind = row.url = row.keep_copy = None
        row.source_version = row.source_mime = row.source_size = None
        row.copy_version = row.copy_modified_at = row.copy_error_code = None
        row.updated_at = ctx.now
        if row.doc_status in ("pending", "processing") and service.process_key(row) != before:
            # Its read was queued under the source's version: queued again under its own.
            await service.request_read(ctx, row, "source")
        await _updated(ctx, row)


async def update_link(
    ctx: Ctx, row: FilesItem, *, url: str, name: str | None, version: str
) -> None:
    """Another module's link moved (and, unless None, was renamed); its place stays."""
    row.url = clean = items.normalize_url(url)
    row.source_version = content.version_hash(version)
    if name is not None:
        row.display_name = service.name_from_source(name, urlsplit(clean).hostname or clean)
    row.updated_at = ctx.now
    await ctx.db.flush()
    await events.publish(ctx, "files.item.updated", {"item_id": row.id, "course_id": row.course_id})


# --- where items belong ---------------------------------------------------------------------


@dataclass(frozen=True)
class Home:
    """Where an item of a source belongs on it ((id, name) of each level from the top), for an
    item the user has not moved since the source put it somewhere else."""

    item_id: str
    path: tuple[tuple[str, str], ...]
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
