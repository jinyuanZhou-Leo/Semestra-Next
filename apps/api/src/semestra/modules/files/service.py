"""Course files (M07 §2, §4, §5): what the rest of the module shares: storage keys, finding the
user's items and folders, an item's output, names, the processing job and removing items.

Folders are in `folders`, listing and name search in `listing`, uploads and links in `items`,
several entries at once (the file page's selection) in `entries`, the storage used in `quota`."""

import re
from collections.abc import Sequence
from typing import Any

from sqlalchemy import delete, select

from semestra.core.context import Ctx
from semestra.core.errors import AppError, not_found
from semestra.core.events import events
from semestra.core.jobs import CoreJob, enqueue
from semestra.core.storage import delete_after_commit
from semestra.modules.academics import service as academics
from semestra.modules.files import content, indexing
from semestra.modules.files.models import FilesDocument, FilesFolder, FilesIndexState, FilesItem
from semestra.modules.files.parse.detect import DOCX, PPTX, XLSX
from semestra.modules.files.schemas import FileType, ItemOut, ItemRef
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
                source_kind=r.source_kind,  # pyright: ignore[reportArgumentType]
                source_ref=r.source_ref,
                source_name=r.source_name if r.source_ref else None,
                unseen=r.unseen,
                doc_status=r.doc_status,  # pyright: ignore[reportArgumentType]
                doc_error_code=r.doc_error_code,
                page_count=doc.page_count if doc else None,
                ocr_skipped_pages=doc.ocr_skipped_pages if doc else 0,
                job_id=jobs.get(r.id),
                created_at=r.created_at,
                updated_at=r.updated_at,
                modified_at=r.source_modified_at or r.updated_at,
            )
        )
    return out


async def item_out(ctx: Ctx, row: FilesItem) -> ItemOut:
    return (await item_outs(ctx, [row]))[0]


def clean_name(name: str) -> str:
    cleaned = _UNSAFE_NAME.sub("", name).strip()
    if not cleaned or "/" in cleaned or "\\" in cleaned:
        raise AppError("common.validation", 422, errors=[{"loc": ["name"], "code": "invalid"}])
    return cleaned


def safe_name(filename: str | None) -> str:
    name = _UNSAFE_NAME.sub("", (filename or "").replace("\\", "/").rsplit("/", 1)[-1]).strip()
    return name[:255] or "file"


def refuse_none(fields: list[str]) -> None:
    """A name or a pin can't be cleared: null is refused rather than ignored, so a write never
    looks like it changed something it left alone."""
    if fields:
        errors = [{"loc": [f], "code": "none_not_allowed"} for f in fields]
        raise AppError("common.validation", 422, errors=errors)


PROCESS_KINDS = ("files.process", "files.process_synced")


async def enqueue_processing(ctx: Ctx, row: FilesItem, *, synced: bool = False) -> None:
    """Queues reading the file's text; `synced`: kept in step with its source by another
    module, not something the user is waiting on (`files.process_synced`)."""
    from semestra.modules.files.jobs import ProcessPayload

    kind = PROCESS_KINDS[1] if synced else PROCESS_KINDS[0]
    await enqueue(ctx, kind, ProcessPayload(item_id=row.id), dedupe_key=f"{row.id}:{row.sha256}")


async def delete_item(ctx: Ctx, item_id: str) -> None:
    row = await get_item(ctx, item_id)
    await purge_items(ctx, [row])


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
