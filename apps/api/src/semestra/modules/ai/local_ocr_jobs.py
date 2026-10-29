"""Downloading local OCR models in the background, with progress the user can watch (M06).

A model downloads the first time it is needed: when a user picks it for OCR, from the OCR row of
the AI settings, or when a file with scanned pages is processed (M07 runs `download_with_progress`
inside its own job).
"""

import math

import structlog
from pydantic import BaseModel
from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.core.events import events
from semestra.core.jobs import CoreJob, JobCancelled, JobCtx, enqueue, job_handler
from semestra.modules.ai import local_ocr

log = structlog.get_logger(__name__)

DOWNLOAD_KIND = "ai.local_ocr.download"
# Published to the user who waited for it, so their settings show the model as downloaded.
DOWNLOADED = "ai.local_ocr.downloaded"
MB = 1_000_000


class DownloadPayload(BaseModel):
    model: str


class DownloadResult(BaseModel):
    model: str


async def download_with_progress(ctx: JobCtx, model: str, stage: str) -> None:
    """Downloads the model inside `ctx`'s job, reporting megabytes received in `stage`. Raises
    `ai.local_ocr_download_failed` when no model source can be reached."""

    async def progress(received: int, total: int | None) -> None:
        if total:
            await ctx.stage(stage, current=received // MB, total=max(1, math.ceil(total / MB)))
        else:
            await ctx.stage(stage)
        await ctx.check_cancelled()

    try:
        await local_ocr.download(model, progress)
    except AppError, JobCancelled:
        raise
    except Exception as exc:
        log.warning("local_ocr_download_failed", model=model, error=repr(exc))
        raise AppError("ai.local_ocr_download_failed", 502, model=model) from exc
    await events.publish(ctx, DOWNLOADED, {"model": model})


@job_handler(DOWNLOAD_KIND, stages=[("downloading", 1)], max_attempts=1)
async def download(ctx: JobCtx, payload: DownloadPayload) -> DownloadResult:
    await download_with_progress(ctx, payload.model, "downloading")
    return DownloadResult(model=payload.model)


async def start_download(ctx: Ctx, model: str) -> CoreJob | None:
    """Queues the model's download for the ctx user, unless it is already on disk. A download
    of the same model already queued for this user is returned instead of a second one."""
    if local_ocr.downloaded(model):
        return None
    return await enqueue(
        ctx, DOWNLOAD_KIND, DownloadPayload(model=model), dedupe_key=f"{DOWNLOAD_KIND}:{model}"
    )


async def latest_download(ctx: Ctx, model: str) -> str | None:
    """The ctx user's latest download of `model` while it runs, or after it failed (so the OCR
    row can show why and offer a retry); None once the model is on disk."""
    if local_ocr.downloaded(model):
        return None
    job = (
        await ctx.db.execute(
            select(CoreJob.id, CoreJob.status)
            .where(
                CoreJob.user_id == ctx.user_id,
                CoreJob.kind == DOWNLOAD_KIND,
                CoreJob.payload["model"].as_string() == model,
            )
            .order_by(CoreJob.id.desc())
            .limit(1)
        )
    ).first()
    return job.id if job and job.status in ("pending", "running", "failed") else None
