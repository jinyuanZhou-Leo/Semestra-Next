"""Reactions to other modules' events (M07 §5)."""

from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.events import Event, events
from semestra.core.jobs import enqueue
from semestra.modules.files import content, service, sources
from semestra.modules.files.jobs import ReindexPayload
from semestra.modules.files.models import FilesDocument, FilesItem
from semestra.modules.files.settings import synced_scans


@events.subscribe("academics.course.deleting", in_transaction=True)
async def on_course_deleting(ctx: Ctx, event: Event) -> None:
    """The course's files, folders and index entries go with it, in the same transaction;
    stored objects are removed after it commits."""
    course_id = event.data.get("course_id")
    if isinstance(course_id, str):
        await service.purge_course(ctx, course_id)


@events.subscribe("ai.assignment.updated")
async def on_embedding_changed(ctx: Ctx, event: Event) -> None:
    """A new embedding model means a new vector space: rebuild the user's vectors."""
    if event.data.get("purpose") == "embedding" and event.user_id:
        await enqueue(ctx, "files.reindex_vectors", ReindexPayload(), dedupe_key="reindex")


@events.subscribe("settings.values.updated")
async def on_synced_scans_changed(ctx: Ctx, event: Event) -> None:
    """`synced_scans` turned on for a Program or course: the synced files there whose scanned
    pages were skipped are read again, now by the provider (the user just asked for it)."""
    data = event.data
    scope = data.get("scope")
    if (
        data.get("namespace") != "files"
        or "synced_scans" not in (data.get("changed") or [])
        or not isinstance(scope, dict)
        or not isinstance(scope_id := scope.get("id"), str)
    ):
        return
    courses = (
        [scope_id]
        if scope.get("type") == "course"
        else await service.program_course_ids(ctx, scope_id)
    )
    rows = await ctx.db.scalars(
        select(FilesItem)
        .join(FilesDocument, FilesDocument.id == FilesItem.active_document_id)
        .where(
            FilesItem.user_id == ctx.user_id,
            FilesItem.course_id.in_(courses),
            FilesItem.doc_status == "ready",
            FilesDocument.ocr_skipped_pages > 0,
        )
    )
    reading: dict[str, bool] = {}
    for row in rows:
        if not content.follows_source(row):
            continue
        if row.course_id not in reading:
            reading[row.course_id] = await synced_scans(ctx, row.course_id)
        if reading[row.course_id]:
            await sources.read_again_synced(ctx, row)
