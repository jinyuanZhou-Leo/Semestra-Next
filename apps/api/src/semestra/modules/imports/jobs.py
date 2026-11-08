"""Extraction job (M08 §4.2-4.4): reads every file of a session, asks the model, builds items."""

from typing import Any

from pydantic import BaseModel
from sqlalchemy import select, update

from semestra.core.context import Ctx, run_as_system
from semestra.core.errors import AppError
from semestra.core.events import Event, events
from semestra.core.jobs import CoreJob, JobCtx, enqueue, job_handler
from semestra.modules import ai
from semestra.modules.imports import build, deps, extraction, service
from semestra.modules.imports.models import ImportsSession, ImportsUpload
from semestra.modules.imports.states import move


class ExtractPayload(BaseModel):
    session_id: str


class ExtractResult(BaseModel):
    session_id: str
    program_id: str | None = None
    items: int
    failed_sources: int


STAGES = [("reading", 15), ("extracting", 75), ("checking", 10)]


async def _source_input(
    ctx: JobCtx, row: ImportsSession, ref: dict[str, Any]
) -> tuple[list[ai.PageText], list[ai.Image]]:
    if ref.get("upload_id"):
        upload = await ctx.db.get(ImportsUpload, ref["upload_id"])
        if upload is None:
            raise AppError("common.not_found", 404)
        data = await service.read_upload_bytes(ctx, upload)
        if row.source_kind == "timetable_image":
            return [], await deps.render_pages(
                ctx.settings, data, upload.mime_type, upload.filename
            )
        return await deps.read_upload(ctx.settings, data, upload.filename, upload.mime_type)
    if ref.get("file_item_id"):
        return await deps.read_course_file(ctx, ref["file_item_id"], row.program_id), []
    return deps.text_pages(row.text or ""), []


def _source_of(ref: dict[str, Any]) -> dict[str, str | None]:
    """Where the evidence of a file's items points."""
    if ref.get("upload_id"):
        return {"upload_id": ref["upload_id"]}
    if ref.get("file_item_id"):
        return {"file_item_id": ref["file_item_id"]}
    return {}


async def _read_source(
    ctx: JobCtx, row: ImportsSession, ref: dict[str, Any], index: int, total: int
) -> BaseModel:
    """The model's reading of one file. Passing provider errors are retried by M06 for each
    request (`adapters.model`), so a file is never read twice here."""
    texts, images = await _source_input(ctx, row, ref)
    if not texts and not images:
        raise AppError("import.no_content", 422)

    async def on_segment(done: int, parts: int) -> None:
        await ctx.stage("extracting", fraction=(index + done / max(parts, 1)) / total)

    await ctx.stage("extracting", fraction=index / total)
    if row.source_kind == "timetable_image":
        return await extraction.extract_timetable(
            ctx, images, source_ref=row.id, on_segment=on_segment
        )
    return await extraction.extract_syllabus(
        ctx,
        texts,
        images=images,
        label=ref.get("filename") or "document",
        source_ref=row.id,
        course_only=row.source_meta.get("only") == "course_info",
        on_segment=on_segment,
    )


def _add_source_items(
    row: ImportsSession,
    ref: dict[str, Any],
    reading: dict[str, Any],
    context: build.BuildContext,
    builder: build.Builder,
) -> None:
    """The items of one file, from its saved reading."""
    source = _source_of(ref)
    if row.source_kind == "timetable_image":
        timetable = extraction.TimetableExtraction.model_validate(reading)
        added = extraction.from_timetable(timetable, context, builder, source)
    else:
        syllabus = extraction.SyllabusExtraction.model_validate(reading)
        added = extraction.from_syllabus(syllabus, context, builder, source)
        if row.source_meta.get("only") == "course_info" and extraction.states_course(syllabus):
            return  # read fine: a course that is up to date adds no change
    if added == 0:
        raise AppError("import.no_content", 422)


async def _save_readings(ctx: JobCtx, session_id: str, readings: dict[str, Any]) -> None:
    """Keeps what the model read so far in its own short transaction: a job that runs again
    (a crash, a locked database at the end) builds the items again without paying for them."""
    async with ctx.state.session_factory() as db:
        await db.execute(
            update(ImportsSession)
            .where(ImportsSession.id == session_id, ImportsSession.status == "extracting")
            .values(readings=readings)
        )
        await db.commit()


async def _extract_failed(ctx: Ctx, payload: ExtractPayload, job: CoreJob) -> None:
    """The job crashed for good or was cancelled: the session is failed, not left extracting."""
    row = await ctx.db.get(ImportsSession, payload.session_id)
    if row is None or row.job_id != job.id or row.status != "extracting":
        return
    move(row, "failed")
    row.error_code = "import.extraction_failed"
    row.readings = {}
    row.job_id = None
    row.updated_at = ctx.now
    await events.publish(
        ctx, "imports.session.failed", service.event_data(row), user_id=row.user_id
    )


@job_handler("imports.extract", stages=STAGES, max_attempts=6, on_failure=_extract_failed)
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
        move(row, "waiting_files")
        row.job_id = None
        row.updated_at = ctx.now
        # A file that became ready between the check above and this commit sent its event while
        # the session did not look waiting yet: look once more after the commit.
        ctx.after_commit.append(
            lambda: run_as_system(ctx.state, row.user_id, lambda c: _recheck(c, row.id))
        )
        return ExtractResult(session_id=row.id, items=0, failed_sources=0)
    context = await service.build_context(ctx, row)
    builder = build.Builder(context)
    total = len(refs)
    failed = 0
    # File index → the model's reading of it ({"value"}) or the error it ended with
    # ({"error_code"}), from an earlier run of this job.
    readings: dict[str, Any] = dict(row.readings)
    for index, ref in enumerate(refs):
        key = str(index)
        if key not in readings:
            await ctx.check_cancelled()
            await ctx.stage("reading", current=index, total=total)
            ref["status"] = "extracting"
            try:
                value = await _read_source(ctx, row, ref, index, total)
                readings[key] = {"value": value.model_dump(mode="json")}
            except AppError as exc:
                readings[key] = {"error_code": exc.code}
            await _save_readings(ctx, row.id, readings)
        try:
            if code := readings[key].get("error_code"):
                raise AppError(code, 422)
            _add_source_items(row, ref, readings[key]["value"], context, builder)
            ref["status"] = "done"
        except AppError as exc:
            ref["status"] = "failed"
            ref["error_code"] = exc.code
            failed += 1
    await ctx.stage("checking")
    # Discarded while the model was reading: leave it discarded.
    await ctx.db.refresh(row, ["status"])
    if row.status != "extracting":
        return ExtractResult(session_id=row.id, items=0, failed_sources=failed)
    row.source_refs = refs
    row.readings = {}
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
        move(row, "ready")
    elif course_info and failed == 0:
        move(row, "up_to_date")  # read fine; the course is up to date
    else:
        move(row, "failed")
        codes = {r.get("error_code") for r in refs}
        row.error_code = (codes.pop() if len(codes) == 1 else None) or "import.no_content"
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
            ImportsSession.user_id == ctx.user_id, ImportsSession.status == "waiting_files"
        )
    )
    for row in rows:
        refs = row.source_refs
        if any(r.get("file_item_id") == item_id and r.get("status") == "waiting" for r in refs):
            await _restart(ctx, row)


async def _restart(ctx: Ctx, row: ImportsSession) -> None:
    job = await enqueue(
        ctx, "imports.extract", ExtractPayload(session_id=row.id), dedupe_key=f"extract:{row.id}"
    )
    move(row, "extracting")
    row.job_id = job.id
    row.updated_at = ctx.now


async def _recheck(ctx: Ctx, session_id: str) -> None:
    """Restarts a waiting session whose course files are all done by now."""
    row = await ctx.db.get(ImportsSession, session_id)
    if row is None or row.status != "waiting_files":
        return
    for ref in row.source_refs:
        if ref.get("status") == "waiting" and not await deps.course_file_ready(
            ctx, ref["file_item_id"]
        ):
            return
    await _restart(ctx, row)
