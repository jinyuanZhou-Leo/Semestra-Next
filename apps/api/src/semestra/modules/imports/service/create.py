"""Creating import sessions and their items (M08 §2-§3)."""

from collections.abc import AsyncIterator, Sequence
from typing import Any

from pydantic import ValidationError

from semestra.core.context import Ctx
from semestra.core.db import new_id
from semestra.core.errors import AppError, not_found, validation_error
from semestra.core.events import events
from semestra.core.jobs import enqueue
from semestra.core.storage import get_storage
from semestra.modules import ai
from semestra.modules.academics import service as academics
from semestra.modules.imports import build, deps
from semestra.modules.imports.ics import parse_ics
from semestra.modules.imports.models import ImportsItem, ImportsSession, ImportsUpload
from semestra.modules.imports.schemas import (
    DATA_MODELS,
    STRICT_MODELS,
    ImportSessionDetail,
    NewItem,
    SessionCreateInput,
    SessionTarget,
)
from semestra.modules.imports.service.context import build_context, revalidate
from semestra.modules.imports.service.rows import (
    AGENT_PAGE,
    detail,
    for_agent,
    get_session_row,
    session_items,
)
from semestra.modules.imports.service.uploads import get_upload, store_upload

CLOSED = ("committed", "discarded")


AI_PURPOSE = {"syllabus": "extraction", "text": "extraction", "timetable_image": "vision"}


async def _check_target(ctx: Ctx, program_id: str, target: SessionTarget) -> SessionTarget:
    if target.kind == "term_wizard" and ctx.actor in ("agent", "mcp"):
        # The new-term wizard in the app creates the term and its courses before the commit;
        # an assistant or MCP client cannot finish such an import.
        raise AppError(
            "common.validation", 422, errors=[{"loc": ["target", "kind"], "code": "wizard_only"}]
        )
    if target.kind == "term" and target.term_id is None:
        raise AppError("common.validation", 422, errors=[{"loc": ["target", "term_id"]}])
    if target.kind == "course" and target.course_id is None:
        raise AppError("common.validation", 422, errors=[{"loc": ["target", "course_id"]}])
    if target.term_id is not None:
        term = await academics.get_term_row(ctx, target.term_id)
        if term.program_id != program_id:
            raise not_found("term", target.term_id)
    if target.course_id is not None:
        course = await academics.get_course_row(ctx, target.course_id)
        if course.program_id != program_id:
            raise not_found("course", target.course_id)
    if target.kind != "term_wizard":
        target = target.model_copy(update={"start_date": None, "end_date": None})
    return target


async def _claim_uploads(
    ctx: Ctx, session_id: str, upload_ids: Sequence[str]
) -> list[ImportsUpload]:
    uploads: list[ImportsUpload] = []
    for upload_id in upload_ids:
        upload = await ctx.db.get(ImportsUpload, upload_id)
        if upload is None or upload.user_id != ctx.user_id or upload.session_id is not None:
            raise not_found()
        upload.session_id = session_id
        uploads.append(upload)
    return uploads


async def _attachment_uploads(
    ctx: Ctx, session_id: str, attachment_ids: Sequence[str]
) -> list[ImportsUpload]:
    """Copies files attached to an assistant conversation into the session's uploads, so the
    importers, "show source" and moving the file into the course work as for any upload."""
    uploads: list[ImportsUpload] = []
    for attachment_id in dict.fromkeys(attachment_ids):
        filename, _, data = await deps.read_attachment(ctx, attachment_id)

        async def chunks(data: bytes = data) -> AsyncIterator[bytes]:
            yield data

        out = await store_upload(ctx, filename=filename, chunks=chunks())
        upload = await get_upload(ctx, out.id)
        upload.session_id = session_id
        uploads.append(upload)
    return uploads


async def read_upload_bytes(ctx: Ctx, upload: ImportsUpload) -> bytes:
    return b"".join([chunk async for chunk in get_storage(ctx).open(upload.storage_key)])


async def create_session(ctx: Ctx, inp: SessionCreateInput) -> ImportSessionDetail:
    await academics.get_program_row(ctx, inp.program_id)
    target = await _check_target(ctx, inp.program_id, inp.target)
    kind = inp.source_kind
    files = [*inp.upload_ids, *inp.attachment_ids]
    if kind in ("ics", "timetable_image") and not files:
        raise AppError(
            "common.validation", 422, errors=[{"loc": ["upload_ids"], "code": "missing"}]
        )
    if kind == "syllabus" and not (files or inp.file_item_ids):
        raise AppError(
            "common.validation", 422, errors=[{"loc": ["upload_ids"], "code": "missing"}]
        )
    if kind == "text" and not (inp.text or "").strip():
        raise AppError("common.validation", 422, errors=[{"loc": ["text"], "code": "missing"}])
    purpose = AI_PURPOSE.get(kind)
    if purpose is not None and not await ai.available(ctx, purpose):  # pyright: ignore[reportArgumentType]
        raise AppError("ai.not_configured", 409, purpose=purpose)

    row = ImportsSession(
        id=new_id(),
        user_id=ctx.user_id,
        program_id=inp.program_id,
        source_kind=kind,
        target=target.model_dump(mode="json"),
        status="ready" if purpose is None else "extracting",
        source_refs=[],
        source_meta=inp.source_meta,
        text=inp.text if kind == "text" else None,
        summary={},
        created_at=ctx.now,
        updated_at=ctx.now,
    )
    ctx.db.add(row)
    await ctx.db.flush()
    uploads = await _claim_uploads(ctx, row.id, inp.upload_ids)
    uploads += await _attachment_uploads(ctx, row.id, inp.attachment_ids)
    refs: list[dict[str, Any]] = [
        {"upload_id": u.id, "filename": u.filename, "status": "pending"} for u in uploads
    ]
    for item_id in inp.file_item_ids:
        item = await deps.call(ctx, "files.item.get", {"item_id": item_id})
        refs.append(
            {"file_item_id": item_id, "filename": item.get("display_name"), "status": "pending"}
        )
    if kind == "text":
        refs.append({"filename": None, "status": "pending"})
    row.source_refs = refs

    if kind == "ics":
        await _ics_items(ctx, row, uploads)
    elif purpose is not None:
        from semestra.modules.imports.jobs import ExtractPayload

        job = await enqueue(ctx, "imports.extract", ExtractPayload(session_id=row.id))
        row.job_id = job.id
    else:
        row.status = "ready"
        await revalidate(ctx, row, [])
    return await detail(ctx, row, limit=AGENT_PAGE if for_agent(ctx) else None)


async def _ics_items(ctx: Ctx, row: ImportsSession, uploads: Sequence[ImportsUpload]) -> None:
    program = await academics.get_program_row(ctx, row.program_id)
    context = await build_context(ctx, row)
    terms = [
        (t.id, t.start_date, t.end_date) for t in await academics.program_terms(ctx, row.program_id)
    ]
    new: list[NewItem] = []
    refs = list(row.source_refs)
    for index, upload in enumerate(uploads):
        result = parse_ics(await read_upload_bytes(ctx, upload), program.timezone)
        new += build.from_ics(result, context, terms)
        refs[index] = {**refs[index], "status": "done"}
        if result.truncated:
            refs[index]["warning_code"] = "import.ics_truncated"
    row.source_refs = refs
    if not new:
        raise AppError("import.no_content", 422)
    await add_items(ctx, row, new)
    row.status = "ready"
    await events.publish(ctx, "imports.session.ready", event_data(row))


def event_data(row: ImportsSession) -> dict[str, Any]:
    return {"session_id": row.id, "program_id": row.program_id, "status": row.status}


def _validated_data(type_: str, data: dict[str, Any], *, strict: bool = False) -> dict[str, Any]:
    """Drafts keep only known fields; `strict` refuses unknown ones instead of dropping them
    (what a caller sends by hand: a misspelt field must not pass as a change)."""
    model = (STRICT_MODELS if strict else DATA_MODELS)[type_]
    try:
        return model.model_validate(data).model_dump(mode="json", exclude_none=True)
    except ValidationError as exc:
        raise validation_error(exc, ("data",)) from exc


async def add_items(ctx: Ctx, row: ImportsSession, new: Sequence[NewItem]) -> list[ImportsItem]:
    """Appends items; `item:<key>` references between them become `item:<id>`."""
    existing = await session_items(ctx, row.id)
    position = max((i.position for i in existing), default=-1) + 1
    ids = {n.key: new_id() for n in new if n.key}
    known = {i.id for i in existing} | set(ids.values())

    def resolve(ref: Any) -> Any:
        if isinstance(ref, str) and ref.startswith("item:"):
            local = ref.removeprefix("item:")
            if local in ids:
                return f"item:{ids[local]}"
            if local not in known:
                raise AppError("import.course_ref_missing", 422, ref=ref)
        return ref

    rows: list[ImportsItem] = []
    for offset, n in enumerate(new):
        data = dict(n.data)
        for name in ("course_ref", "category_ref"):
            if name in data:
                data[name] = resolve(data[name])
        data = _validated_data(n.type, data)
        depends = [
            ref.removeprefix("item:")
            for name in ("course_ref", "category_ref")
            if isinstance(ref := data.get(name), str) and ref.startswith("item:")
        ]
        item = ImportsItem(
            id=ids.get(n.key) if n.key else new_id(),
            user_id=ctx.user_id,
            session_id=row.id,
            type=n.type,
            data=data,
            evidence={
                k: v.model_dump(mode="json", exclude_none=True) for k, v in n.evidence.items()
            },
            confidence=dict(n.confidence),
            decision=n.decision,
            issues=[],
            depends_on=depends,
            result=None,
            position=position + offset,
        )
        ctx.db.add(item)
        rows.append(item)
    await ctx.db.flush()
    await revalidate(ctx, row, [*existing, *rows])
    return rows


async def add_items_capability(
    ctx: Ctx, session_id: str, new: Sequence[NewItem], *, ready: bool
) -> ImportSessionDetail:
    row = await get_session_row(ctx, session_id)
    _require_open(row)
    added = await add_items(ctx, row, new)
    if ready and row.status == "extracting" and row.job_id is None:
        row.status = "ready"
        await events.publish(ctx, "imports.session.ready", event_data(row))
    # The assistant gets the items it added (their ids), not the whole session again.
    return await detail(ctx, row, item_ids={i.id for i in added} if for_agent(ctx) else None)


def _require_open(row: ImportsSession) -> None:
    if row.status in CLOSED or row.status == "committing":
        raise AppError("import.session_closed", 409, state=row.status)
