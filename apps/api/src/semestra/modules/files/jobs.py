"""Background jobs of the document pipeline (M07 §3.1)."""

from datetime import timedelta

from pydantic import BaseModel
from sqlalchemy import exists, func, or_, select

from semestra.core.context import Ctx, run_as_system
from semestra.core.errors import AppError
from semestra.core.events import events
from semestra.core.jobs import CoreJob, JobCtx, enqueue, job_handler, periodic
from semestra.modules import ai
from semestra.modules.files import pipeline, service, sources
from semestra.modules.files.models import FilesChunk, FilesDocument, FilesIndexState, FilesItem
from semestra.modules.files.parse.readers import outdated

# Weights follow M07 §3.1; stages that do not apply are skipped and their weight is shared out.
PROCESS_STAGES = [
    ("detecting", 3),
    ("parsing", 25),
    # Only on a self-hosted server whose local OCR model has not been downloaded yet.
    ("ocr_model", 10),
    ("ocr", 30),
    ("chunking", 5),
    ("indexing", 7),
    ("embedding", 30),
]


class ProcessPayload(BaseModel):
    item_id: str
    # The item's version (`content.version`) it was queued for: a newer one makes its result
    # stale.
    # None in jobs queued before versions were kept.
    version: str | None = None


class ProcessResult(BaseModel):
    page_count: int


class KeepPayload(BaseModel):
    item_ids: list[str]


class KeepResult(BaseModel):
    kept: int
    # Left as they were: the quota is full, or one could not be stored (too large, unreadable).
    left: int


class ReindexPayload(BaseModel):
    # The periodic retry: documents that failed too often are left alone.
    retry: bool = False


class ReindexResult(BaseModel):
    items_rebuilt: int


async def _process_failed(ctx: Ctx, payload: ProcessPayload, job: CoreJob) -> None:
    await pipeline.mark_failed(ctx, payload.item_id, job)


# Shown in the status bar by the files module's own line (`files.processing.list`), with the
# synced ones below.
@job_handler(
    "files.process",
    stages=PROCESS_STAGES,
    max_attempts=1,
    on_failure=_process_failed,
    listed=False,
)
async def process(ctx: JobCtx, payload: ProcessPayload) -> ProcessResult:
    return ProcessResult(page_count=await pipeline.run(ctx, payload.item_id, payload.version))


# The same work for files another module keeps in step with its source (M09's course materials):
# behind what the user is waiting on, behind the source's own sync (one run can bring hundreds
# of files; a course sync queued meanwhile goes first), and behind the local copies the source's
# setting asks for, so a file to be kept here is read from its copy, not downloaded twice.
@job_handler(
    "files.process_synced",
    stages=PROCESS_STAGES,
    max_attempts=1,
    on_failure=_process_failed,
    lane="background",
    listed=False,
    labels="files.process",
    # Parsing works the machine, not the network: the files a sync brings take one of the
    # parse children (`parse.isolated.MAX_CHILDREN`) at a time, as with one background worker,
    # and never crowd out the user's own uploads, imports and attachments (M00 §3.7).
    at_once=1,
    priority=-2,
)
async def process_synced(ctx: JobCtx, payload: ProcessPayload) -> ProcessResult:
    page_count = await pipeline.run(ctx, payload.item_id, payload.version, background=True)
    return ProcessResult(page_count=page_count)


@job_handler("files.store_copy", stages=[("storing", 1)], max_attempts=1)
async def store_copy(ctx: JobCtx, payload: KeepPayload) -> KeepResult:
    """A copy the user asked for; a failure shows in the status bar."""
    for item_id in payload.item_ids:
        await ctx.stage("storing")
        await sources.store_from_source(ctx, item_id, quiet=False)
    return KeepResult(kept=len(payload.item_ids), left=0)


@job_handler(
    "files.store_synced_copies",
    stages=[("storing", 1)],
    lane="background",
    listed=False,
    labels="files.store_copy",
    priority=-1,
)
async def store_synced_copies(ctx: JobCtx, payload: KeepPayload) -> KeepResult:
    """Local copies the source's setting asks for, stored one by one until the quota is full;
    one that can't be stored (too large, unreadable now) is left read from its source."""
    kept = 0
    for index, item_id in enumerate(payload.item_ids):
        await ctx.stage("storing", current=index, total=len(payload.item_ids))
        try:
            if not await sources.store_from_source(ctx, item_id, quiet=True):
                break
        except AppError:
            continue
        kept += 1
    return KeepResult(kept=kept, left=len(payload.item_ids) - kept)


@job_handler("files.reindex_vectors", stages=[("embedding", 1)], max_attempts=2, lane="bulk")
async def reindex_vectors(ctx: JobCtx, payload: ReindexPayload) -> ReindexResult:
    return ReindexResult(items_rebuilt=await pipeline.reindex_vectors(ctx, retry=payload.retry))


@periodic("files.retry_vectors", every=timedelta(hours=6), first_after=timedelta(minutes=10))
async def retry_vectors(ctx: Ctx) -> None:
    """Documents whose embedding failed (the provider was down, a key had run out) are only
    searchable by keyword; every few hours their users get another reindex, until a document has
    failed `VECTOR_RETRIES` times in a row."""
    missing = (
        select(FilesItem.user_id)
        .outerjoin(FilesIndexState, FilesIndexState.item_id == FilesItem.id)
        .where(
            FilesItem.active_document_id.is_not(None),
            or_(
                FilesIndexState.vector_document_id.is_(None),
                FilesIndexState.vector_document_id != FilesItem.active_document_id,
            ),
            exists().where(FilesChunk.document_id == FilesItem.active_document_id),
            func.coalesce(FilesIndexState.vector_failures, 0) < pipeline.VECTOR_RETRIES,
        )
        .distinct()
    )
    for user_id in list(await ctx.db.scalars(missing)):

        async def again(user_ctx: Ctx) -> None:
            # A local model that is not here yet is fetched first; its download rebuilds.
            await ai.local_jobs.prepare_embedding(user_ctx)
            if await ai.available(user_ctx, "embedding"):
                await enqueue(
                    user_ctx,
                    "files.reindex_vectors",
                    ReindexPayload(retry=True),
                    dedupe_key="reindex",
                )

        await run_as_system(ctx.state, user_id, again)


@periodic("files.reread_outdated", every=timedelta(hours=6), first_after=timedelta(minutes=10))
async def reread_outdated(ctx: Ctx) -> None:
    """The user's own files read by an older version of a reader that needs no model
    (`readers.outdated`) are read again from their stored bytes, behind the users' own reads, so
    a reader's change reaches the files already read. A source's files are its sync's to read
    again (`sources.read_again_if_outdated`): their bytes are on the source's platform."""
    found = await ctx.db.execute(
        select(
            FilesItem.user_id, FilesItem.id, FilesItem.mime_type, FilesDocument.parser_fingerprint
        )
        .join(FilesDocument, FilesDocument.id == FilesItem.active_document_id)
        .where(
            FilesItem.doc_status == "ready",
            FilesItem.storage_key.is_not(None),
            FilesItem.source_kind.is_(None),
        )
    )
    stale: dict[str, list[str]] = {}
    for user_id, item_id, mime, fingerprint in found.all():
        if outdated(mime, fingerprint):
            stale.setdefault(user_id, []).append(item_id)
    for user_id, item_ids in stale.items():

        async def again(user_ctx: Ctx, item_ids: list[str] = item_ids) -> None:
            rows = await user_ctx.db.scalars(select(FilesItem).where(FilesItem.id.in_(item_ids)))
            for row in rows:
                await service.request_read(user_ctx, row, "upgrade")
                await events.publish(
                    user_ctx, "files.item.updated", {"item_id": row.id, "course_id": row.course_id}
                )

        await run_as_system(ctx.state, user_id, again)
