"""Extraction job (M08 §4.2-4.4): reads every file of a session, asks the model, builds items."""

from typing import Any

from pydantic import BaseModel

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.core.events import Event, events
from semestra.core.jobs import JOB_PROGRESS, JobCtx, job_handler
from semestra.modules import ai
from semestra.modules.imports import build, deps, extraction, service
from semestra.modules.imports.models import ImportsSession, ImportsUpload


class ExtractPayload(BaseModel):
    session_id: str


class ExtractResult(BaseModel):
    session_id: str
    items: int
    failed_sources: int


STAGES = [("reading", 15), ("extracting", 75), ("checking", 10)]


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
            return [], await deps.render_pages(data, upload.mime_type, upload.filename), source
        texts, images = await deps.read_upload(data, upload.filename, upload.mime_type)
        return texts, images, source
    if ref.get("file_item_id"):
        pages = await deps.read_course_file(ctx, ref["file_item_id"], row.program_id)
        item_source: dict[str, str | None] = {"file_item_id": ref["file_item_id"]}
        return pages, [], item_source
    return deps.text_pages(row.text or ""), [], {}


@job_handler("imports.extract", stages=STAGES, max_attempts=6)
async def extract(ctx: JobCtx, payload: ExtractPayload) -> ExtractResult:
    row = await ctx.db.get(ImportsSession, payload.session_id)
    if row is None or row.status != "extracting":
        return ExtractResult(session_id=payload.session_id, items=0, failed_sources=0)
    context = await service.build_context(ctx, row)
    builder = build.Builder(context)
    refs = [dict(r) for r in row.source_refs]
    total = len(refs)
    failed = 0
    for index, ref in enumerate(refs):
        await ctx.check_cancelled()
        await ctx.stage("reading", current=index, total=total)
        ref["status"] = "extracting"
        try:
            texts, images, source = await _source_input(ctx, row, ref)
            if not texts and not images:
                raise AppError("import.no_content", 422)

            async def on_segment(done: int, parts: int, index: int = index) -> None:
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
                    ctx, texts, label=label, source_ref=row.id, on_segment=on_segment
                )
                added = extraction.from_syllabus(syllabus, context, builder, source)
            if added == 0:
                raise AppError("import.no_content", 422)
            ref["status"] = "done"
        except AppError as exc:
            ref["status"] = "failed"
            ref["error_code"] = exc.code
            failed += 1
    await ctx.stage("checking")
    row.source_refs = refs
    if builder.items:
        await service.add_items(ctx, row, builder.items)
        row.status = "ready"
    else:
        row.status = "failed"
        codes = {r.get("error_code") for r in refs}
        row.error_code = codes.pop() if len(codes) == 1 else "import.no_content"
        await service.revalidate(ctx, row, [])
    row.job_id = None
    row.updated_at = ctx.now
    await events.publish(ctx, f"imports.session.{row.status}", service.event_data(row))
    return ExtractResult(session_id=row.id, items=len(builder.items), failed_sources=failed)


@events.subscribe(JOB_PROGRESS)
async def on_job_progress(ctx: Ctx, event: Event) -> None:
    """A job that crashed for good (or was cancelled) leaves its session failed, not stuck."""
    data = event.data
    if data.get("kind") != "imports.extract" or data.get("status") not in ("failed", "cancelled"):
        return
    from sqlalchemy import select

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
