"""Extraction job (M08 §4.2-4.4): reads every file of a session, asks the model, builds items."""

from typing import Any

import anyio
from pydantic import BaseModel
from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.core.events import Event, events
from semestra.core.jobs import JOB_PROGRESS, JobCtx, enqueue, job_handler
from semestra.modules import ai
from semestra.modules.imports import build, deps, extraction, service
from semestra.modules.imports.models import ImportsSession, ImportsUpload


class ExtractPayload(BaseModel):
    session_id: str


class ExtractResult(BaseModel):
    session_id: str
    program_id: str | None = None
    items: int
    failed_sources: int


STAGES = [("reading", 15), ("extracting", 75), ("checking", 10)]
# Model errors that may pass: a file that hits one is read once more before it counts as failed.
TRANSIENT = {"ai.timeout", "ai.rate_limited", "ai.provider_unreachable"}
SOURCE_ATTEMPTS = 2
SOURCE_RETRY_SECONDS = 20.0


async def _source_input(
    ctx: JobCtx, row: ImportsSession, ref: dict[str, Any]
) -> tuple[list[ai.PageText], list[ai.Image], dict[str, str | None]]:
    if ref.get("upload_id"):
        upload = await ctx.db.get(ImportsUpload, ref["upload_id"])
        if upload is None:
            raise AppError("common.not_found", 404)
        data = await service.read_upload_bytes(ctx, upload)
        source: dict[str, str | None] = {"upload_id": upload.id}
        if row.source_kind == "timetable_image":
            return (
                [],
                await deps.render_pages(ctx.settings, data, upload.mime_type, upload.filename),
                source,
            )
        texts, images = await deps.read_upload(
            ctx.settings, data, upload.filename, upload.mime_type
        )
        return texts, images, source
    if ref.get("file_item_id"):
        pages = await deps.read_course_file(ctx, ref["file_item_id"], row.program_id)
        item_source: dict[str, str | None] = {"file_item_id": ref["file_item_id"]}
        return pages, [], item_source
    return deps.text_pages(row.text or ""), [], {}


async def _extract_source(
    ctx: JobCtx,
    row: ImportsSession,
    ref: dict[str, Any],
    context: build.BuildContext,
    builder: build.Builder,
    index: int,
    total: int,
) -> None:
    texts, images, source = await _source_input(ctx, row, ref)
    if not texts and not images:
        raise AppError("import.no_content", 422)

    async def on_segment(done: int, parts: int) -> None:
        await ctx.stage("extracting", fraction=(index + done / max(parts, 1)) / total)

    await ctx.stage("extracting", fraction=index / total)
    label = ref.get("filename") or "document"
    if row.source_kind == "timetable_image":
        timetable = await extraction.extract_timetable(
            ctx, images, source_ref=row.id, on_segment=on_segment
        )
        added = extraction.from_timetable(timetable, context, builder, source)
    else:
        syllabus = await extraction.extract_syllabus(
            ctx, texts, images=images, label=label, source_ref=row.id, on_segment=on_segment
        )
        added = extraction.from_syllabus(syllabus, context, builder, source)
    if added == 0:
        raise AppError("import.no_content", 422)


@job_handler("imports.extract", stages=STAGES, max_attempts=6)
async def extract(ctx: JobCtx, payload: ExtractPayload) -> ExtractResult:
    row = await ctx.db.get(ImportsSession, payload.session_id)
    if row is None or row.status != "extracting":
        return ExtractResult(session_id=payload.session_id, items=0, failed_sources=0)
    refs = [dict(r) for r in row.source_refs]
    # Course files M07 is still processing: nothing is read (or paid for) until all are ready;
    # `on_course_file_done` starts the job again when they are.
    waiting = {
        r["file_item_id"]
        for r in refs
        if r.get("file_item_id") and not await deps.course_file_ready(ctx, r["file_item_id"])
    }
    if waiting:
        for ref in refs:
            ref["status"] = "waiting" if ref.get("file_item_id") in waiting else "pending"
        row.source_refs = refs
        row.job_id = None
        row.updated_at = ctx.now
        return ExtractResult(session_id=row.id, items=0, failed_sources=0)
    context = await service.build_context(ctx, row)
    builder = build.Builder(context)
    total = len(refs)
    failed = 0
    for index, ref in enumerate(refs):
        await ctx.check_cancelled()
        await ctx.stage("reading", current=index, total=total)
        ref["status"] = "extracting"
        for attempt in range(SOURCE_ATTEMPTS):
            try:
                await _extract_source(ctx, row, ref, context, builder, index, total)
                ref["status"] = "done"
                break
            except AppError as exc:
                if exc.code in TRANSIENT and attempt + 1 < SOURCE_ATTEMPTS:
                    # The provider already retried; one more try after a pause, for this file
                    # only (the ones before it are not read again).
                    await anyio.sleep(SOURCE_RETRY_SECONDS)
                    continue
                ref["status"] = "failed"
                ref["error_code"] = exc.code
                failed += 1
    await ctx.stage("checking")
    # Discarded while the model was reading: leave it discarded.
    await ctx.db.refresh(row, ["status"])
    if row.status != "extracting":
        return ExtractResult(session_id=row.id, items=0, failed_sources=failed)
    row.source_refs = refs
    course_info = row.source_meta.get("only") == "course_info"
    if course_info:
        # "Update course info from syllabus": only the field changes of the target course.
        builder.items = [i for i in builder.items if i.type == "course_patch"]
    else:
        # Elsewhere (the gradebook, the wizard) changing the course itself is opt-in.
        for item in builder.items:
            if item.type == "course_patch":
                item.decision = "reject"
    if builder.items:
        await service.add_items(ctx, row, builder.items)
        row.status = "ready"
    else:
        row.status = "failed"
        codes = {r.get("error_code") for r in refs}
        if course_info and failed == 0:
            row.error_code = "import.no_changes"  # read fine; the course is up to date
        else:
            row.error_code = codes.pop() if len(codes) == 1 else "import.no_content"
            row.error_code = row.error_code or "import.no_content"
        await service.revalidate(ctx, row, [])
    row.job_id = None
    row.updated_at = ctx.now
    await events.publish(ctx, f"imports.session.{row.status}", service.event_data(row))
    return ExtractResult(
        session_id=row.id,
        program_id=row.program_id,
        items=len(builder.items),
        failed_sources=failed,
    )


@events.subscribe(JOB_PROGRESS)
async def on_job_progress(ctx: Ctx, event: Event) -> None:
    """A job that crashed for good (or was cancelled) leaves its session failed, not stuck."""
    data = event.data
    if data.get("kind") != "imports.extract" or data.get("status") not in ("failed", "cancelled"):
        return
    row = await ctx.db.scalar(
        select(ImportsSession).where(
            ImportsSession.job_id == data["job_id"], ImportsSession.status == "extracting"
        )
    )
    if row is None:
        return
    row.status = "failed"
    row.error_code = "import.extraction_failed"
    row.job_id = None
    row.updated_at = ctx.now
    await events.publish(
        ctx, "imports.session.failed", service.event_data(row), user_id=row.user_id
    )


@events.subscribe("files.document.ready")
@events.subscribe("files.document.failed")
@events.subscribe("files.item.deleted")
async def on_course_file_done(ctx: Ctx, event: Event) -> None:
    """Sessions waiting for this course file start reading."""
    item_id = event.data.get("item_id")
    if not isinstance(item_id, str) or ctx.user_id is None:
        return
    rows = await ctx.db.scalars(
        select(ImportsSession).where(
            ImportsSession.user_id == ctx.user_id,
            ImportsSession.status == "extracting",
            ImportsSession.job_id.is_(None),
        )
    )
    for row in rows:
        refs = row.source_refs
        if not any(r.get("file_item_id") == item_id and r.get("status") == "waiting" for r in refs):
            continue
        job = await enqueue(
            ctx,
            "imports.extract",
            ExtractPayload(session_id=row.id),
            dedupe_key=f"extract:{row.id}",
        )
        row.job_id = job.id
        row.updated_at = ctx.now
