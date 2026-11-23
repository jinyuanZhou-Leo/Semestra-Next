"""Course files (M07 §2, §4, §5): what the rest of the module shares: storage keys, finding the
user's items and folders, an item's output, names, the processing job and removing items.

Folders are in `folders`, listing and name search in `listing`, uploads and links in `items`,
several entries at once (the file page's selection) in `entries`, the storage used in `quota`."""

import re
from collections.abc import Sequence
from typing import Any, Literal

from sqlalchemy import delete, select

from semestra.core.context import Ctx
from semestra.core.errors import AppError, not_found
from semestra.core.events import events
from semestra.core.jobs import CoreJob, enqueue, withdraw
from semestra.core.storage import delete_after_commit
from semestra.modules.academics import service as academics
from semestra.modules.files import content, indexing
from semestra.modules.files.models import FilesDocument, FilesFolder, FilesIndexState, FilesItem
from semestra.modules.files.parse.detect import DOCX, PPTX, XLSX
from semestra.modules.files.schemas import CopyOut, FileType, ItemOut, ItemRef
from semestra.modules.files.vectors import get_vector_store

PARSEABLE = frozenset({"pdf", "docx", "pptx", "xlsx", "csv", "text", "markdown", "html", "image"})
_UNSAFE_NAME = re.compile(r"[\x00-\x1f\x7f]")


def storage_key(user_id: str, item_id: str) -> str:
    return f"users/{user_id}/files/{item_id}/original"


def page_image_key(user_id: str, item_id: str, document_id: str, page_no: int) -> str:
    return f"users/{user_id}/files/{item_id}/pages/{document_id}/{page_no}.png"


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


# Targets for the assistant's confirmation cards of deletes (M12 §3.5): what goes, by name.


async def preview_item_delete(ctx: Ctx, inp: ItemRef) -> dict[str, Any]:
    row = await get_item(ctx, inp.item_id)
    return {"target": row.display_name, "changes": []}


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
    keys = {process_key(r): r.id for r in rows if r.doc_status in ("pending", "processing")}
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
    saving = await _saving(ctx, [r.id for r in rows if content.follows_source(r)])
    names = await content.source_names(ctx, rows)
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
                local_copy=_copy_out(r, r.id in saving),
                pinned=r.pinned,
                source_kind=r.source_kind,  # pyright: ignore[reportArgumentType]
                source_name=names.get(r.id),
                unseen=r.unseen,
                doc_status=r.doc_status,  # pyright: ignore[reportArgumentType]
                doc_error_code=r.doc_error_code,
                page_count=doc.page_count if doc else None,
                ocr_skipped_pages=doc.ocr_skipped_pages if doc else 0,
                job_id=jobs.get(r.id),
                created_at=r.created_at,
                updated_at=r.updated_at,
                modified_at=(r.copy_modified_at if r.storage_key else None)
                or r.source_modified_at
                or r.updated_at,
            )
        )
    return out


STORE_KINDS = ("files.store_copy", "files.store_synced_copies")


async def _saving(ctx: Ctx, item_ids: Sequence[str]) -> set[str]:
    """Which of these items a copy job is storing or about to store."""
    if not item_ids:
        return set()
    wanted, found = set(item_ids), set[str]()
    for payload in await ctx.db.scalars(
        select(CoreJob.payload).where(
            CoreJob.user_id == ctx.user_id,
            CoreJob.kind.in_(STORE_KINDS),
            CoreJob.status.in_(("pending", "running")),
        )
    ):
        found.update(str(i) for i in payload.get("item_ids") or [] if str(i) in wanted)
    return found


def _copy_out(row: FilesItem, saving: bool) -> CopyOut | None:
    if not content.follows_source(row):
        return None
    if not row.storage_key:
        state = "saving" if saving else "failed" if row.copy_error_code else "online"
    elif row.copy_version != row.source_version:
        state = "outdated"
    else:
        state = "saved"
    return CopyOut(
        state=state,
        error_code=row.copy_error_code if state in ("failed", "outdated") else None,
        saved_version_at=row.copy_modified_at if row.storage_key else None,
    )


async def item_out(ctx: Ctx, row: FilesItem) -> ItemOut:
    return (await item_outs(ctx, [row]))[0]


def clean_name(name: str) -> str:
    cleaned = _UNSAFE_NAME.sub("", name).strip()
    if not cleaned or "/" in cleaned or "\\" in cleaned:
        raise AppError("common.validation", 422, errors=[{"loc": ["name"], "code": "invalid"}])
    return cleaned


def safe_name(filename: str | None) -> str:
    """An uploaded file's name: what follows its last slash (browsers may send a path)."""
    name = _UNSAFE_NAME.sub("", (filename or "").replace("\\", "/").rsplit("/", 1)[-1]).strip()
    return name[:255] or "file"


def name_from_source(title: str, fallback: str = "") -> str:
    """A source's title as a name here (an item's or a folder's): a title, not a path, so a
    slash reads as a dash ("Week 1/2" → "Week 1-2") rather than cutting it; `fallback` when
    nothing is left."""
    name = _UNSAFE_NAME.sub("", title.replace("/", "-").replace("\\", "-")).strip()
    return name[:255] or fallback


def refuse_none(fields: list[str]) -> None:
    """A name or a pin can't be cleared: null is refused rather than ignored, so a write never
    looks like it changed something it left alone."""
    if fields:
        errors = [{"loc": [f], "code": "none_not_allowed"} for f in fields]
        raise AppError("common.validation", 422, errors=errors)


PROCESS_KINDS = ("files.process", "files.process_synced")


def process_key(row: FilesItem) -> str:
    """The processing jobs' dedupe key: one read per item and version (`content.version`)."""
    return f"{row.id}:{content.version(row)}"


# Who asks for a file to be read: the user (reprocess, retry), its upload, the source that keeps
# it in step (new, changed, new bytes stored, retried after the source failed), or a backup
# restore.
Reader = Literal["user", "upload", "source", "restore"]


async def request_read(
    ctx: Ctx, row: FilesItem, by: Reader, *, auto_index: bool | None = None
) -> None:
    """The one way into `pending`: the item's text is to be read. Whether it is read now:

    - the user asked: always, in the user's queue (`files.process`), ahead of synced files;
    - an upload or its source: as the course's `auto_index` says (else `none`, read when asked);
      a source's in the queue behind it (`files.process_synced`);
    - a backup restore: what was read when the backup was made is read again, the rest as
      `auto_index` says.

    A job queued for an older version of the item (or, for the user, behind the synced files)
    is withdrawn; one running reads again once it ends (`again`), and a result for a version the
    item no longer has is dropped (`pipeline._activate`). The caller makes sure the item can be
    read (`content.has_content`) and tells of its change (`files.item.*`); one adding a batch
    passes the course's `auto_index`, read once."""
    from semestra.modules.files import settings
    from semestra.modules.files.jobs import ProcessPayload

    was_read = row.doc_status == "ready"
    wanted = (
        by == "user"
        or (by == "restore" and was_read)
        or (auto_index if auto_index is not None else await settings.auto_index(ctx, row.course_id))
    )
    row.doc_error_code, row.updated_at = None, ctx.now
    if not wanted:
        row.doc_status = "none"
        await ctx.db.flush()
        return
    row.doc_status = "pending"
    synced = by == "source" or (by == "restore" and content.follows_source(row))
    kind = PROCESS_KINDS[1] if synced else PROCESS_KINDS[0]
    key = process_key(row)
    stale = [
        job.id
        for job in await ctx.db.scalars(
            select(CoreJob).where(
                CoreJob.user_id == ctx.user_id,
                CoreJob.kind.in_(PROCESS_KINDS),
                CoreJob.status == "pending",
                CoreJob.dedupe_key.like(f"{row.id}:%"),
            )
        )
        if job.dedupe_key != key or (job.kind != kind and kind == PROCESS_KINDS[0])
    ]
    await withdraw(ctx, stale)
    await ctx.db.flush()
    payload = ProcessPayload(item_id=row.id, version=content.version(row))
    await enqueue(ctx, kind, payload, dedupe_key=key, again=True)


async def delete_item(ctx: Ctx, item_id: str) -> None:
    row = await get_item(ctx, item_id)
    await purge_items(ctx, [row])


async def purge_items(ctx: Ctx, rows: Sequence[FilesItem]) -> None:
    """Deletes items with their documents, index entries and stored objects.

    The objects are removed after the transaction commits, so a rollback never loses a file.
    The module keeping an item (its `source_kind`) is told in this transaction first
    (`files.item.deleting`), so its own records never name an item that is gone.
    """
    if not rows:
        return
    for row in rows:
        if row.source_kind:
            await events.publish_in_transaction(
                ctx,
                "files.item.deleting",
                {"item_id": row.id, "course_id": row.course_id, "source_kind": row.source_kind},
            )
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
