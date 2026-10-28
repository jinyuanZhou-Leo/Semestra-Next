"""Background jobs of the document pipeline (M07 §3.1)."""

from datetime import timedelta

from pydantic import BaseModel
from sqlalchemy import exists, func, or_, select

from semestra.core.context import Ctx, run_as_system
from semestra.core.jobs import JobCtx, enqueue, job_handler, periodic
from semestra.modules import ai
from semestra.modules.files import pipeline
from semestra.modules.files.models import FilesChunk, FilesIndexState, FilesItem

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


class ProcessResult(BaseModel):
    page_count: int


class ReindexPayload(BaseModel):
    # The periodic retry: documents that failed too often are left alone.
    retry: bool = False


class ReindexResult(BaseModel):
    items_rebuilt: int


@job_handler("files.process", stages=PROCESS_STAGES, max_attempts=1)
async def process(ctx: JobCtx, payload: ProcessPayload) -> ProcessResult:
    return ProcessResult(page_count=await pipeline.run(ctx, payload.item_id))


@job_handler("files.reindex_vectors", stages=[("embedding", 1)], max_attempts=2)
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
            if await ai.available(user_ctx, "embedding"):
                await enqueue(
                    user_ctx,
                    "files.reindex_vectors",
                    ReindexPayload(retry=True),
                    dedupe_key="reindex",
                )

        await run_as_system(ctx.state, user_id, again)
