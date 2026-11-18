"""Reactions to other modules' events (M07 §5)."""

from semestra.core.context import Ctx
from semestra.core.events import Event, events
from semestra.core.jobs import enqueue
from semestra.modules.files import service
from semestra.modules.files.jobs import ReindexPayload


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
