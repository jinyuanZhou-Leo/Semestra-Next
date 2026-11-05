"""Downloading local models in the background, with progress the user can watch (M06).

A model downloads the first time it is needed: when a user picks it in the AI settings, or when
a file needs it. An OCR model is fetched inside the file's own job (M07 runs
`download_with_progress` in its `ocr_model` stage), since the pages wait for it; an embedding
model in its own job (`prepare_embedding`), since the file stays searchable by keyword meanwhile
and its vectors are added once the model is here.
"""

import math
from typing import Literal

import structlog
from pydantic import BaseModel
from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.core.events import events
from semestra.core.jobs import CoreJob, JobCancelled, JobCtx, enqueue, job_handler
from semestra.modules.ai import local_embedding, local_ocr

log = structlog.get_logger(__name__)

type LocalPurpose = Literal["ocr", "embedding"]

KINDS: dict[LocalPurpose, str] = {
    "ocr": "ai.local_ocr.download",
    "embedding": "ai.local_embedding.download",
}
# Published to the user who waited for it, so their settings show the model as downloaded.
DOWNLOADED: dict[LocalPurpose, str] = {
    "ocr": "ai.local_ocr.downloaded",
    "embedding": "ai.local_embedding.downloaded",
}
MB = 1_000_000


class DownloadPayload(BaseModel):
    model: str


class DownloadResult(BaseModel):
    model: str


def downloaded(ctx: Ctx, purpose: LocalPurpose, model: str) -> bool:
    if purpose == "ocr":
        return local_ocr.downloaded(model)
    return local_embedding.downloaded(ctx.settings, model)


async def download_with_progress(
    ctx: JobCtx, purpose: LocalPurpose, model: str, stage: str
) -> None:
    """Downloads the model inside `ctx`'s job, reporting megabytes received in `stage`. Raises
    `ai.local_<purpose>_download_failed` when no model source can be reached (or the
    `ai.local_model_*` reason a custom embedding model cannot be used)."""

    async def progress(received: int, total: int | None) -> None:
        if total:
            await ctx.stage(stage, current=received // MB, total=max(1, math.ceil(total / MB)))
        else:
            await ctx.stage(stage)
        await ctx.check_cancelled()

    try:
        if purpose == "ocr":
            await local_ocr.download(model, progress)
        else:
            await local_embedding.download(ctx.settings, model, progress)
    except AppError, JobCancelled:
        raise
    except Exception as exc:
        log.warning("local_model_download_failed", purpose=purpose, model=model, error=repr(exc))
        raise AppError(f"ai.local_{purpose}_download_failed", 502, model=model) from exc
    await events.publish(ctx, DOWNLOADED[purpose], {"model": model})


@job_handler(KINDS["ocr"], stages=[("downloading", 1)], max_attempts=1, lane="bulk")
async def download_ocr(ctx: JobCtx, payload: DownloadPayload) -> DownloadResult:
    await download_with_progress(ctx, "ocr", payload.model, "downloading")
    return DownloadResult(model=payload.model)


@job_handler(KINDS["embedding"], stages=[("downloading", 1)], max_attempts=1, lane="bulk")
async def download_embedding(ctx: JobCtx, payload: DownloadPayload) -> DownloadResult:
    await download_with_progress(ctx, "embedding", payload.model, "downloading")
    # The user's documents were indexed by keyword only while the model was missing: adding
    # their vectors is the same as switching embedding models (M07 rebuilds them).
    if await local_embedding.choice(ctx) == payload.model:
        await events.publish(ctx, "ai.assignment.updated", {"purpose": "embedding"})
    return DownloadResult(model=payload.model)


async def start_download(ctx: Ctx, purpose: LocalPurpose, model: str) -> CoreJob | None:
    """Queues the model's download for the ctx user, unless it is already on disk. A download
    of the same model already queued for this user is returned instead of a second one."""
    if downloaded(ctx, purpose, model):
        return None
    kind = KINDS[purpose]
    return await enqueue(ctx, kind, DownloadPayload(model=model), dedupe_key=f"{kind}:{model}")


async def prepare_embedding(ctx: Ctx) -> None:
    """Starts downloading the user's local embedding model if it is not here yet."""
    model = await local_embedding.choice(ctx)
    if model is not None and not local_embedding.downloaded(ctx.settings, model):
        await start_download(ctx, "embedding", model)


async def latest_download(ctx: Ctx, purpose: LocalPurpose, model: str) -> str | None:
    """The ctx user's latest download of `model` while it runs, or after it failed (so the
    settings row can show why and offer a retry); None once the model is on disk."""
    if downloaded(ctx, purpose, model):
        return None
    job = (
        await ctx.db.execute(
            select(CoreJob.id, CoreJob.status)
            .where(
                CoreJob.user_id == ctx.user_id,
                CoreJob.kind == KINDS[purpose],
                CoreJob.payload["model"].as_string() == model,
            )
            .order_by(CoreJob.id.desc())
            .limit(1)
        )
    ).first()
    return job.id if job and job.status in ("pending", "running", "failed") else None
