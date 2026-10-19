"""Background jobs of the document pipeline (M07 §3.1)."""

from pydantic import BaseModel

from semestra.core.jobs import JobCtx, job_handler
from semestra.modules.files import pipeline

# Weights follow M07 §3.1; stages that do not apply are skipped and their weight is shared out.
PROCESS_STAGES = [
    ("detecting", 3),
    ("parsing", 25),
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
    pass


class ReindexResult(BaseModel):
    items_rebuilt: int


@job_handler("files.process", stages=PROCESS_STAGES, max_attempts=1)
async def process(ctx: JobCtx, payload: ProcessPayload) -> ProcessResult:
    return ProcessResult(page_count=await pipeline.run(ctx, payload.item_id))


@job_handler("files.reindex_vectors", stages=[("embedding", 1)], max_attempts=2)
async def reindex_vectors(ctx: JobCtx, payload: ReindexPayload) -> ReindexResult:
    del payload
    return ReindexResult(items_rebuilt=await pipeline.reindex_vectors(ctx))
