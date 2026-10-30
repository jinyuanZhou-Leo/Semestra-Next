"""Import sessions: create, review, commit, discard (M08 §2-§5)."""

import asyncio
import contextlib
import time as time_
from collections.abc import AsyncIterator, Awaitable, Callable, Collection, Sequence
from datetime import date, datetime, time, timedelta
from typing import Any

import anyio
import structlog
from pydantic import ValidationError
from sqlalchemy import delete, select, update

from semestra.core.context import Ctx
from semestra.core.db import new_id
from semestra.core.errors import AppError, not_found, validation_error
from semestra.core.events import events
from semestra.core.jobs import enqueue
from semestra.core.storage import get_storage, remaining_quota
from semestra.core.storage import usage as storage_usage
from semestra.modules import ai
from semestra.modules.academics import service as academics
from semestra.modules.academics.schemas import CourseListInput
from semestra.modules.imports import build, dates, deps
from semestra.modules.imports.ics import parse_ics
from semestra.modules.imports.models import ImportsItem, ImportsSession, ImportsUpload
from semestra.modules.imports.schemas import (
    DATA_MODELS,
    STRICT_MODELS,
    BulkDecideInput,
    CommitInput,
    ImportItem,
    ImportSession,
    ImportSessionDetail,
    ImportSessionPage,
    ItemUpdateInput,
    NewItem,
    SessionCreateInput,
    SessionTarget,
    Upload,
)
from semestra.modules.imports.validate import ValidationContext, summarize, validate

log = structlog.get_logger()

RETENTION = timedelta(days=30)
UPLOAD_RETENTION = timedelta(days=1)
WAIT_POLL_SECONDS = 0.5
CLOSED = ("committed", "discarded")
# Commit order (M08 §2): courses first, then what hangs off them.
TYPE_ORDER = {
    "course": 0,
    "course_patch": 0,
    "assessment_patch": 2,
    "task_patch": 2,
    "category": 1,
    "assessment": 2,
    "meeting": 2,
    "event": 2,
    "task": 2,
}
AI_PURPOSE = {"syllabus": "extraction", "text": "extraction", "timetable_image": "vision"}

# Called inside the commit transaction after every item was written; raising rolls back the
# whole commit (M08 §5). `created` maps item ids to the ids written in the target modules.
CommitHook = Callable[[Ctx, ImportsSession, dict[str, str]], Awaitable[None]]
_commit_hooks: dict[str, list[CommitHook]] = {}


def register_commit_hook(source_kind: str, fn: CommitHook) -> CommitHook:
    _commit_hooks.setdefault(source_kind, []).append(fn)
    return fn


# --- rows and outputs -----------------------------------------------------------------------


async def get_session_row(ctx: Ctx, session_id: str) -> ImportsSession:
    row = await ctx.db.get(ImportsSession, session_id)
    if row is None or row.user_id != ctx.user_id:
        raise not_found("session", session_id)
    return row


async def wait_while_extracting(ctx: Ctx, row: ImportsSession, seconds: int) -> None:
    """Holds the call until the background extraction ends or `seconds` pass, so the assistant
    can wait with one call instead of polling. Reads through its own session: the caller's
    transaction may not see the job's commits."""
    deadline = time_.monotonic() + seconds
    status = row.status
    while status == "extracting" and time_.monotonic() < deadline:
        await asyncio.sleep(WAIT_POLL_SECONDS)
        async with ctx.state.session_factory() as db:
            status = await db.scalar(
                select(ImportsSession.status).where(ImportsSession.id == row.id)
            )
    if status != row.status:
        # No rollback first: the driver opens a transaction only for writes, so this read sees the
        # job's commit, and a rollback would expire what the request already loaded (the user).
        await ctx.db.refresh(row)


async def session_items(ctx: Ctx, session_id: str) -> list[ImportsItem]:
    return list(
        (
            await ctx.db.scalars(
                select(ImportsItem)
                .where(ImportsItem.user_id == ctx.user_id, ImportsItem.session_id == session_id)
                .order_by(ImportsItem.position, ImportsItem.id)
            )
        ).all()
    )


async def items_of(ctx: Ctx, session_id: str) -> list[ImportsItem]:
    """The items of a session the caller already loaded (the assistant's display labels)."""
    return await session_items(ctx, session_id)


def session_out(row: ImportsSession) -> ImportSession:
    return ImportSession.model_validate(
        {
            "id": row.id,
            "program_id": row.program_id,
            "source_kind": row.source_kind,
            "target": row.target,
            "status": row.status,
            "job_id": row.job_id,
            "source_refs": row.source_refs,
            "source_meta": row.source_meta,
            "summary": row.summary,
            "error_code": row.error_code,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
            "committed_at": row.committed_at,
        }
    )


def item_out(row: ImportsItem, *, agent: bool = False) -> ImportItem:
    # `source_ref` only ties an item to its source for re-imports; an assistant never needs it.
    data = {k: v for k, v in row.data.items() if k != "source_ref"} if agent else row.data
    return ImportItem.model_validate(
        {
            "id": row.id,
            "session_id": row.session_id,
            "type": row.type,
            "data": data,
            "evidence": row.evidence,
            "confidence": row.confidence,
            "decision": row.decision,
            "issues": row.issues,
            "depends_on": row.depends_on,
            "result": row.result,
            "position": row.position,
        }
    )


# What the assistant and MCP clients get of each item unless they ask for other `fields`, and
# how many items per page: a whole session can be tens of thousands of characters.
AGENT_ITEM_FIELDS = ("type", "data", "decision", "issues", "result")
AGENT_PAGE = 25


def for_agent(ctx: Ctx) -> bool:
    """Called by an assistant or MCP client: they get trimmed, paged results. HTTP callers
    (personal access tokens included) always get the whole session."""
    return ctx.surface != "http"


async def detail(
    ctx: Ctx,
    row: ImportsSession,
    *,
    item_ids: Collection[str] | None = None,
    types: Collection[str] | None = None,
    cursor: str | None = None,
    limit: int | None = None,
) -> ImportSessionDetail:
    """The session with its items: all of them, or those with these ids or types, a page at a
    time when `limit` is given (`cursor` is the position to go on from)."""
    items = [
        i
        for i in await session_items(ctx, row.id)
        if (item_ids is None or i.id in item_ids) and (types is None or i.type in types)
    ]
    start = int(cursor) if cursor and cursor.isdigit() else 0
    end = start + limit if limit is not None else len(items)
    return ImportSessionDetail(
        **session_out(row).model_dump(),
        items=[item_out(i, agent=for_agent(ctx)) for i in items[start:end]],
        next_cursor=str(end) if end < len(items) else None,
    )


# --- context for building and validating ----------------------------------------------------


def target_of(row: ImportsSession) -> SessionTarget:
    return SessionTarget.model_validate(row.target)


async def _term_dates(ctx: Ctx, target: SessionTarget) -> dates.TermDates | None:
    if target.kind == "term_wizard":
        if target.start_date and target.end_date:
            return dates.TermDates(
                target.start_date,
                target.end_date,
                dates.plain_weeks(target.start_date, target.end_date),
            )
        return None
    if target.term_id is None:
        return None
    term = await academics.get_term_row(ctx, target.term_id)
    return await _term_dates_of(ctx, term)


async def _term_dates_of(ctx: Ctx, term: Any) -> dates.TermDates:
    weeks = await academics.weeks_of(ctx, term)
    return dates.TermDates(
        term.start_date,
        term.end_date,
        [dates.TermWeekSpan(w.number, w.start_date, w.end_date) for w in weeks],
    )


async def _program_courses(ctx: Ctx, program_id: str) -> list[Any]:
    page = await academics.list_courses(ctx, CourseListInput(program_id=program_id, limit=500))
    return page.items


async def _existing_assessments(ctx: Ctx, course_ids: Sequence[str]) -> dict[str, set[str]]:
    """Normalised titles of the courses' assessments (the plain list: no gradebook maths, which
    every review edit would otherwise pay for)."""
    if not course_ids or not deps.has_capability("grading.assessment.list"):
        return {}
    out: dict[str, set[str]] = {}
    for course_id in course_ids:
        try:
            page = await deps.call(
                ctx, "grading.assessment.list", {"course_id": course_id, "limit": 500}
            )
        except AppError:
            continue
        out[course_id] = {build.norm_title(a["title"]) for a in page.get("items", [])}
    return out


async def build_context(ctx: Ctx, row: ImportsSession) -> build.BuildContext:
    target = target_of(row)
    courses = await _program_courses(ctx, row.program_id)
    existing = [
        build.ExistingCourse(
            id=c.id,
            code=c.code,
            title=c.title,
            fields={
                "code": c.code,
                "title": c.title,
                "credits": c.credits,
                "instructors": [i.model_dump(mode="json") for i in c.instructors],
                "description": c.description,
                "website_url": c.website_url,
            },
        )
        for c in courses
    ]
    type_codes: list[str] = []
    if deps.has_capability("schedule.event_type.list"):
        types = await deps.call(ctx, "schedule.event_type.list", {"program_id": row.program_id})
        type_codes = [t["code"] for t in types.get("items", [])]
    ids = [target.course_id] if target.course_id else [c.id for c in courses]
    return build.BuildContext(
        target_kind=target.kind,
        target_course_id=target.course_id,
        term=await _term_dates(ctx, target),
        courses=existing,
        type_codes=type_codes,
        existing_assessments=await _existing_assessments(ctx, ids),
        source_kind=row.source_kind,
    )


async def _validation_context(
    ctx: Ctx, row: ImportsSession, items: Sequence[ImportsItem]
) -> ValidationContext:
    target = target_of(row)
    course_ids = sorted(
        {
            str(i.data.get("course_ref", "")).removeprefix("course:")
            for i in items
            if str(i.data.get("course_ref", "")).startswith("course:")
        }
    )
    course_terms: dict[str, list[str]] = {}
    for course_id in course_ids:
        try:
            course = await academics.course_out(ctx, await academics.get_course_row(ctx, course_id))
        except AppError:
            continue
        course_terms[course_id] = list(course.term_ids)
    term_ids = {t for terms in course_terms.values() for t in terms}
    term_ids |= {str(t) for i in items if i.type == "course" for t in i.data.get("term_ids") or []}
    terms: dict[str, dates.TermDates] = {}
    for term_id in sorted(term_ids - {target.term_id}):
        try:
            terms[term_id] = await _term_dates_of(ctx, await academics.get_term_row(ctx, term_id))
        except AppError:
            continue
    term = await _term_dates(ctx, target)
    if term is not None and target.term_id is not None:
        terms[target.term_id] = term
    return ValidationContext(
        target_kind=target.kind,
        target_term_id=target.term_id,
        existing_assessments=await _existing_assessments(ctx, course_ids),
        course_term_counts={c: len(t) for c, t in course_terms.items()},
        target_weeks=term.weeks if term else None,
        course_terms=course_terms,
        terms=terms,
    )


async def revalidate(ctx: Ctx, row: ImportsSession, items: Sequence[ImportsItem]) -> None:
    validate(items, await _validation_context(ctx, row, items))
    row.summary = summarize(items)
    row.updated_at = ctx.now
    await ctx.db.flush()


# --- creating -------------------------------------------------------------------------------


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


# --- uploads --------------------------------------------------------------------------------


async def store_upload(
    ctx: Ctx,
    *,
    filename: str,
    chunks: AsyncIterator[bytes],
    allowed: Sequence[str] | None = None,
) -> Upload:
    """Stores an import upload, cut off above the per-file limit or the quota left (imports
    count against the user's storage quota like course files). The type comes from the content;
    a type outside `allowed` is refused."""
    cap = ctx.settings.files_max_upload_bytes
    budget = await remaining_quota(ctx)
    if budget is not None and budget <= 0:
        raise await _quota_error(ctx)
    key = f"users/{ctx.user_id}/imports/{new_id()}"
    # The whole upload is kept for the type check: telling DOCX/XLSX/PPTX apart reads the zip's
    # central directory at the end of the file (uploads are capped at the upload size limit).
    seen = bytearray()

    async def kept() -> AsyncIterator[bytes]:
        async for chunk in chunks:
            seen.extend(chunk)
            yield chunk

    storage = get_storage(ctx)
    try:
        stored = await storage.put(
            key, kept(), "application/octet-stream",
            max_bytes=cap if budget is None else min(cap, budget),
        )  # fmt: skip
    except AppError as exc:
        if exc.code != "common.quota_exceeded":
            raise
        if budget is None or cap <= budget:
            raise AppError("files.too_large", 413, max=cap) from None
        raise await _quota_error(ctx) from None
    mime = await anyio.to_thread.run_sync(deps.detect_mime, bytes(seen), filename)
    if allowed is not None and mime not in allowed:
        await storage.delete(stored.key)
        raise AppError("import.file_unsupported", 415, filename=filename)
    upload = ImportsUpload(
        id=new_id(),
        user_id=ctx.user_id,
        storage_key=stored.key,
        filename=filename[:255] or "file",
        mime_type=mime,
        size_bytes=stored.size,
        sha256=stored.sha256,
        created_at=ctx.now,
    )
    ctx.db.add(upload)
    await ctx.db.flush()
    return Upload(id=upload.id, filename=upload.filename, mime_type=mime, size_bytes=stored.size)


async def _quota_error(ctx: Ctx) -> AppError:
    current = await storage_usage(ctx)
    return AppError(
        "common.quota_exceeded", 413, used=current.used_bytes, quota=current.quota_bytes
    )


async def get_upload(ctx: Ctx, upload_id: str) -> ImportsUpload:
    upload = await ctx.db.get(ImportsUpload, upload_id)
    if upload is None or upload.user_id != ctx.user_id:
        raise not_found("upload", upload_id)
    return upload


async def _delete_uploads(ctx: Ctx, uploads: Sequence[ImportsUpload]) -> None:
    keys = [u.storage_key for u in uploads]
    for upload in uploads:
        await ctx.db.delete(upload)
    _after_commit_delete(ctx, keys)


def _after_commit_delete(ctx: Ctx, keys: Sequence[str]) -> None:
    """Stored objects go once the transaction has committed, so a rollback never loses one."""
    storage = get_storage(ctx)

    async def _remove() -> None:
        for key in keys:
            await storage.delete(key)

    ctx.after_commit.append(_remove)


async def session_uploads(ctx: Ctx, session_id: str) -> list[ImportsUpload]:
    return list(
        (
            await ctx.db.scalars(
                select(ImportsUpload).where(
                    ImportsUpload.user_id == ctx.user_id, ImportsUpload.session_id == session_id
                )
            )
        ).all()
    )


# --- reviewing ------------------------------------------------------------------------------


async def update_item(ctx: Ctx, inp: ItemUpdateInput) -> ImportSessionDetail:
    row = await get_session_row(ctx, inp.session_id)
    items = await session_items(ctx, row.id)
    item = next((i for i in items if i.id == inp.item_id), None)
    if item is None:
        raise not_found()
    before = {i.id: (i.decision, list(i.issues or [])) for i in items}
    # After a commit only the items that failed can still be fixed and retried.
    failed = bool(item.result and item.result.get("error_code"))
    if not (row.status == "committed" and failed):
        _require_open(row)
    if inp.type is not None and inp.type != item.type:
        item.type, item.data = inp.type, _switched(item, inp.type)
        item.confidence = {}
    if inp.data is not None:
        # Nulls are dropped before validation below, so a misspelt field set to null is caught here.
        fields = STRICT_MODELS[item.type].model_fields
        unknown = [name for name in inp.data if name not in fields]
        if unknown:
            errors = [{"loc": ["data", name], "code": "extra_forbidden"} for name in unknown]
            raise AppError("common.validation", 422, errors=errors)
        merged = {**item.data, **inp.data}
        if item.type.endswith("_patch") and "changes" in inp.data:
            merged["changes"] = {**item.data.get("changes", {}), **inp.data["changes"]}
        for name in ("course_ref", "category_ref"):
            ref = merged.get(name)
            if (
                isinstance(ref, str)
                and ref.startswith("item:")
                and ref.removeprefix("item:") not in {i.id for i in items}
            ):
                raise AppError("import.course_ref_missing", 422, ref=ref)
        # Fields set to null are dropped (the drafts store only what is known).
        item.data = _validated_data(
            item.type, {k: v for k, v in merged.items() if v is not None}, strict=True
        )
        # Edited by hand: the model's certainty no longer applies to those fields.
        item.confidence = {k: v for k, v in item.confidence.items() if k not in inp.data}
        if item.result and item.result.get("error_code"):
            item.result = None  # a fixed failure can be retried
    if inp.decision is not None:
        for each in _with_contents(items, [item]) if inp.decision == "reject" else [item]:
            if each is item or not _written(each):
                each.decision = inp.decision
    await revalidate(ctx, row, items)
    # The edited item and those whose decision or issues changed with it (a rejected course
    # takes its items along; a weight fixes its course's total): a review list merges these.
    touched = {item.id} | {
        i.id for i in items if before[i.id] != (i.decision, list(i.issues or []))
    }
    return await detail(ctx, row, item_ids=touched if inp.only_touched or for_agent(ctx) else None)


def _with_contents(items: list[ImportsItem], chosen: list[ImportsItem]) -> list[ImportsItem]:
    """The chosen items and what belongs to the courses among them (their meetings,
    assessments, ...): rejecting a course leaves those out too, whichever tool rejected it.
    Accepting does not cascade: a course's items rejected one by one stay rejected."""
    courses = {f"item:{i.id}" for i in chosen if i.type == "course"}
    picked = {i.id for i in chosen}
    return chosen + [i for i in items if i.id not in picked and i.data.get("course_ref") in courses]


def _written(item: ImportsItem) -> bool:
    return bool(item.result and not item.result.get("error_code"))


def _switched(item: ImportsItem, to: str) -> dict[str, Any]:
    """The same draft as the other kind: an assessment of a course ↔ a task (M09 lets the user
    pick for each LMS assignment). Fields the other kind lacks are held, so switching back
    restores them."""
    if item.type not in ("assessment", "task"):
        raise AppError("common.validation", 422, errors=[{"loc": ["type"], "code": "invalid"}])
    data = item.data
    common = {k: data[k] for k in ("course_ref", "title", "due_date", "due_time", "due_text",
                                    "source_ref") if data.get(k) is not None}  # fmt: skip
    restored = data.get("held") or {}
    if to == "task":
        if data.get("note"):
            common["notes"] = data["note"]
        held = {k: data[k] for k in ("category_ref", "weight") if data.get(k) is not None}
        return _validated_data("task", {**restored, **common, "held": held or None})
    if not str(common.get("course_ref", "")).startswith(("course:", "item:")):
        raise AppError("import.course_ref_missing", 422)
    if data.get("notes"):
        common["note"] = str(data["notes"])[:2000]
    held = {"priority": data["priority"]} if data.get("priority", "none") != "none" else {}
    return _validated_data("assessment", {**restored, **common, "held": held or None})


def _decided(items: list[ImportsItem], inp: BulkDecideInput) -> list[ImportsItem]:
    """The items `bulk_decide` changes: those matching every filter (a rejected course takes
    its contents along), not written yet and not already decided that way."""
    chosen = [
        item
        for item in items
        if (inp.types is None or item.type in inp.types)
        and (inp.item_ids is None or item.id in inp.item_ids)
        and (inp.issue_codes is None or any(i["code"] in inp.issue_codes for i in item.issues))
    ]
    if inp.decision == "reject":
        chosen = _with_contents(items, chosen)
    return [i for i in chosen if not _written(i) and i.decision != inp.decision]


def _label(data: dict[str, Any]) -> str | None:
    found = data.get("code") or data.get("title") or data.get("name") or data.get("section_code")
    return str(found) if found else None


def _by_type(drafts: Sequence[tuple[str, dict[str, Any]]]) -> list[dict[str, Any]]:
    """How many items of each type (`import_<type>`), the courses by name."""
    changes: list[dict[str, Any]] = []
    courses = [n for t, data in drafts if t == "course" and (n := _label(data))]
    if courses:
        changes.append({"field": "import_course", "after": courses[:10], "count": len(courses)})
    counts: dict[str, int] = {}
    for t, _ in drafts:
        if t != "course":
            counts[t] = counts.get(t, 0) + 1
    return changes + [{"field": f"import_{t}", "after": n} for t, n in counts.items()]


async def preview_bulk_decide(ctx: Ctx, inp: BulkDecideInput) -> dict[str, Any]:
    """The assistant's confirmation card (M12 §3.5): how many items of each type it keeps or
    leaves out (the same selection as `bulk_decide`)."""
    row = await get_session_row(ctx, inp.session_id)
    items = _decided(await session_items(ctx, row.id), inp)
    changes = [
        {"field": "decision", "after": inp.decision},
        *_by_type([(i.type, i.data) for i in items]),
    ]
    if not items:
        changes.append({"field": "import_items", "after": 0})
    return {"target": _files(row), "changes": changes}


async def preview_update_item(ctx: Ctx, inp: ItemUpdateInput) -> dict[str, Any]:
    """The item's fields before → after (null clears one), its type and its decision."""
    row = await get_session_row(ctx, inp.session_id)
    items = await session_items(ctx, row.id)
    item = next((i for i in items if i.id == inp.item_id), None)
    if item is None:
        raise not_found()
    changes: list[dict[str, Any]] = []
    if inp.type is not None and inp.type != item.type:
        changes.append({"field": "type", "before": item.type, "after": inp.type})
    for key, value in (inp.data or {}).items():
        if key in ("source_ref", "held"):
            continue
        before = item.data.get(key)
        if key.endswith("_ref"):
            key = key.removesuffix("_ref")
            before, value = await _ref_name(ctx, items, before), await _ref_name(ctx, items, value)
        if before != value:
            changes.append({"field": key, "before": before, "after": value})
    if inp.decision is not None and inp.decision != item.decision:
        changes.append({"field": "decision", "before": item.decision, "after": inp.decision})
    return {
        "target": " · ".join(p for p in (_label(item.data), _files(row)) if p),
        "changes": changes,
    }


async def preview_add_items(ctx: Ctx, session_id: str, new: Sequence[NewItem]) -> dict[str, Any]:
    """Counts per type of what is added, new courses by name."""
    row = await get_session_row(ctx, session_id)
    return {"target": _files(row), "changes": _by_type([(n.type, n.data) for n in new])}


def _files(row: ImportsSession) -> str | None:
    return ", ".join(str(r["filename"]) for r in row.source_refs if r.get("filename")) or None


async def _ref_name(ctx: Ctx, items: Sequence[ImportsItem], ref: Any) -> str | None:
    """A `course_ref`/`category_ref` by name: an item of the session, a course or a term."""
    if not isinstance(ref, str):
        return None
    kind, _, id_ = ref.partition(":")
    with contextlib.suppress(AppError):
        if kind == "item":
            found = next((i for i in items if i.id == id_), None)
            return _label(found.data) if found is not None else None
        if kind == "course":
            course = await academics.get_course_row(ctx, id_)
            return course.code or course.title
        if kind == "term":
            return (await academics.get_term_row(ctx, id_)).name
    return None


async def bulk_decide(ctx: Ctx, inp: BulkDecideInput) -> tuple[int, ImportSessionDetail]:
    row = await get_session_row(ctx, inp.session_id)
    _require_open(row)
    items = await session_items(ctx, row.id)
    changed = 0
    for item in _decided(items, inp):
        item.decision = inp.decision
        changed += 1
    await revalidate(ctx, row, items)
    return changed, await detail(ctx, row, item_ids=set() if for_agent(ctx) else None)


async def list_sessions(
    ctx: Ctx, program_id: str, cursor: str | None, limit: int
) -> ImportSessionPage:
    await academics.get_program_row(ctx, program_id)
    rows = (
        await ctx.db.scalars(
            select(ImportsSession)
            .where(ImportsSession.user_id == ctx.user_id, ImportsSession.program_id == program_id)
            .order_by(ImportsSession.created_at.desc(), ImportsSession.id.desc())
        )
    ).all()
    offset = int(cursor) if cursor and cursor.isdigit() else 0
    page = rows[offset : offset + limit]
    more = offset + limit < len(rows)
    return ImportSessionPage(
        items=[session_out(r) for r in page], next_cursor=str(offset + limit) if more else None
    )


async def discard(ctx: Ctx, session_id: str) -> ImportSession:
    row = await get_session_row(ctx, session_id)
    if row.status == "committed":
        raise AppError("import.session_closed", 409, state=row.status)
    if row.status != "discarded":
        await _delete_uploads(ctx, await session_uploads(ctx, row.id))
        if row.job_id is not None and deps.has_capability("core.job.cancel"):
            with contextlib.suppress(AppError):
                await deps.call(ctx, "core.job.cancel", {"job_id": row.job_id})
        row.status = "discarded"
        row.text = None
        row.updated_at = ctx.now
        await ctx.db.flush()
    return session_out(row)


async def commit_preview(ctx: Ctx, session_id: str) -> dict[str, Any]:
    row = await get_session_row(ctx, session_id)
    items = await session_items(ctx, row.id)
    waiting = [
        i
        for i in items
        if i.decision == "accept" and not (i.result and not i.result.get("error_code"))
    ]
    changes = _by_type([(i.type, i.data) for i in waiting])
    rejected = sum(1 for i in items if i.decision == "reject")
    if rejected:
        changes.append({"field": "import_rejected", "after": rejected})
    pending = sum(1 for i in items if i.decision == "pending")
    if pending:
        changes.append({"field": "import_pending", "after": pending})
    issues = sum(len(i.issues) for i in waiting)
    if issues:
        changes.append({"field": "import_issues", "after": issues})
    target = target_of(row)
    into: str | None = None
    with contextlib.suppress(AppError):
        if target.course_id is not None:
            course = await academics.get_course_row(ctx, target.course_id)
            into = course.code or course.title
        elif target.term_id is not None:
            into = (await academics.get_term_row(ctx, target.term_id)).name
    target_text = " → ".join(p for p in (_files(row), into) if p)
    return {"target": target_text, "changes": changes}


# --- committing -----------------------------------------------------------------------------


class _Commit:
    """State of one commit: what each item wrote, and how refs resolve."""

    def __init__(self, ctx: Ctx, row: ImportsSession, items: Sequence[ImportsItem]) -> None:
        self.ctx = ctx
        self.row = row
        self.target = target_of(row)
        self.by_id = {i.id: i for i in items}
        self.term_id: str | None = self.target.term_id
        self.categories: dict[str, dict[str, str]] = {}  # course id → key → category id
        self.terms: dict[str, Any] = {}

    def written(self, item_id: str) -> str | None:
        item = self.by_id.get(item_id)
        if item is None or item.decision == "reject" or not item.result:
            return None
        return item.result.get("created_id") or item.result.get("updated_id")

    def course_id(self, ref: str | None) -> str | None:
        if ref is None:
            return None
        if ref.startswith("course:"):
            return ref.removeprefix("course:")
        found = self.written(ref.removeprefix("item:"))
        if found is None:
            raise AppError("import.course_ref_missing", 422)
        return found

    async def term(self, ref: str | None, course_id: str | None, day: date | None) -> str:
        if ref is not None:
            return ref.removeprefix("term:")
        course_terms: list[str] | None = None
        if course_id is not None:
            course = await academics.course_out(
                self.ctx, await academics.get_course_row(self.ctx, course_id)
            )
            course_terms = list(course.term_ids)
        spans = {t: await self.term_dates(t) for t in course_terms or []}
        found = dates.pick_term(self.term_id, course_terms, day, spans)
        if found is None:
            raise AppError("import.term_unresolved", 422)
        return found

    async def term_dates(self, term_id: str) -> dates.TermDates:
        if term_id not in self.terms:
            self.terms[term_id] = await _term_dates_of(
                self.ctx, await academics.get_term_row(self.ctx, term_id)
            )
        return self.terms[term_id]

    async def category_ids(self, course_id: str) -> dict[str, str]:
        if course_id not in self.categories:
            book = await deps.call(self.ctx, "grading.gradebook.get", {"course_id": course_id})
            self.categories[course_id] = {c["key"]: c["id"] for c in book["categories"]}
        return self.categories[course_id]


def _local_iso(day: date, at: time | None) -> str:
    return datetime.combine(day, at or time(0, 0)).isoformat()


async def _write_course(c: _Commit, item: ImportsItem) -> dict[str, Any]:
    """Creates a course in the session's Program."""
    ctx, data, program_id = c.ctx, item.data, c.row.program_id
    term_ids = data.get("term_ids") or ([c.term_id] if c.term_id else [])
    if not term_ids:
        raise AppError("import.term_unresolved", 422)
    fields = {
        k: data[k]
        for k in ("code", "title", "alias", "credits", "instructors", "description",
                  "website_url", "planned_terms")
        if data.get(k) is not None
    }  # fmt: skip
    out = await deps.call(
        ctx,
        "academics.course.create",
        {"program_id": program_id, "term_ids": term_ids, **fields},
    )
    return {"created_id": out["id"]}


async def _write_course_patch(c: _Commit, item: ImportsItem) -> dict[str, Any]:
    """Applies the accepted field changes to an existing course."""
    ctx, data = c.ctx, item.data
    changes = {
        name: change["new"] for name, change in data["changes"].items() if change.get("apply", True)
    }
    if not changes:
        return {"updated_id": data["course_id"], "reused": True}
    out = await deps.call(
        ctx, "academics.course.update", {"course_id": data["course_id"], **changes}
    )
    return {"updated_id": out["id"]}


async def _write_category(c: _Commit, item: ImportsItem) -> dict[str, Any]:
    """Creates a grading category, or reuses the course's one with the same key."""
    ctx, data = c.ctx, item.data
    course_id = c.course_id(data.get("course_ref"))
    assert course_id is not None
    key = data.get("key") or build.slug_key(data["name"])
    known = await c.category_ids(course_id)
    if key in known:
        return {"created_id": known[key], "reused": True}
    out = await deps.call(
        ctx,
        "grading.category.create",
        {"course_id": course_id, "name": data["name"], "key": key},
    )
    known[key] = out["id"]
    return {"created_id": out["id"]}


async def _write_assessment(c: _Commit, item: ImportsItem) -> dict[str, Any]:
    """Creates an assessment; its category is a written item or a built-in key."""
    ctx, data = c.ctx, item.data
    course_id = c.course_id(data.get("course_ref"))
    assert course_id is not None
    category_id: str | None = None
    ref = data.get("category_ref")
    if isinstance(ref, str) and ref.startswith("item:"):
        category_id = c.written(ref.removeprefix("item:"))
    elif isinstance(ref, str) and ref.startswith("key:"):
        key = ref.removeprefix("key:")
        known = await c.category_ids(course_id)
        category_id = known.get(key)
        if category_id is None:
            name = next((t["name"] for t in _builtin_categories() if t["key"] == key), key.title())
            out = await deps.call(
                ctx,
                "grading.category.create",
                {"course_id": course_id, "name": name, "key": key},
            )
            category_id = known[key] = out["id"]
    assessment = {
        "title": data["title"],
        "category_id": category_id,
        "weight": data.get("weight", 0),
        "due_date": data.get("due_date"),
        "due_time": data.get("due_time") if data.get("due_date") else None,
        "note": data.get("note"),
        "source_kind": "lms" if c.row.source_kind == "lms" else "syllabus",
        "source_ref": data.get("source_ref") or f"import:{item.id}",
    }
    out = await deps.call(
        ctx,
        "grading.assessment.create_many",
        {"course_id": course_id, "assessments": [assessment]},
    )
    if out["created"]:
        return {"created_id": out["created"][0]["id"]}
    return {"created_id": out["skipped"][0]["assessment_id"], "reused": True}


async def _write_meeting(c: _Commit, item: ImportsItem) -> dict[str, Any]:
    """Creates or updates a weekly meeting with its cancelled days."""
    ctx, data = c.ctx, item.data
    course_id = c.course_id(data.get("course_ref"))
    assert course_id is not None
    first = date.fromisoformat(data["first_date"]) if data.get("first_date") else None
    last = date.fromisoformat(data["last_date"]) if data.get("last_date") else None
    term_id = await c.term(data.get("term_ref"), course_id, first)
    weeks = (await c.term_dates(term_id)).weeks
    start_week, end_week, problem = dates.meeting_weeks(
        first, last, data.get("start_week"), data.get("end_week"), weeks
    )
    if problem:
        # Never placed in the term's first week instead; validation flags most of these.
        raise AppError(problem, 422, term_id=term_id)
    meeting = {
        "term_id": term_id,
        "section_code": data.get("section_code", ""),
        "type_code": data.get("type_code", "LEC"),
        "weekday": data["weekday"],
        "start_time": data["start_time"],
        "end_time": data["end_time"],
        "recurrence": data.get("recurrence", "weekly"),
        "start_week": start_week or 1,
        "end_week": end_week,
        "location": data.get("location"),
        "instructor": data.get("instructor"),
        "source_kind": c.row.source_kind,
        "source_ref": data.get("source_ref") or f"import:{item.id}",
    }
    out = await deps.call(
        ctx, "schedule.meeting.create_many", {"course_id": course_id, "meetings": [meeting]}
    )
    meeting_id = (out["created_ids"] or out["updated_ids"])[0]
    cancelled = set(data.get("exceptions") or [])
    # A repeated import takes back the cancellations it wrote before that the file no longer
    # has; the user's own changes stay.
    for exc in out["items"][0]["exceptions"]:
        day = str(exc["original_date"])
        if exc["imported"] and day not in cancelled:
            await deps.call(
                ctx,
                "schedule.exception.delete",
                {"meeting_id": meeting_id, "original_date": day},
            )
    skipped: list[dict[str, str]] = []
    for day in data.get("exceptions") or []:
        try:
            await deps.call(
                ctx,
                "schedule.exception.upsert",
                {
                    "meeting_id": meeting_id,
                    "original_date": day,
                    "kind": "cancelled",
                    "imported": True,
                },
            )
        except AppError as exc:
            # Not a class day of the meeting (a break week, outside its weeks): reported so
            # the user is told which dates were left out.
            skipped.append({"date": day, "code": exc.code})
    result: dict[str, Any] = (
        {"created_id": meeting_id} if out["created_ids"] else {"updated_id": meeting_id}
    )
    if skipped:
        result["skipped_exceptions"] = skipped
    return result


async def _write_event(c: _Commit, item: ImportsItem) -> dict[str, Any]:
    """Creates a calendar event (course or term scoped)."""
    ctx, data, program_id = c.ctx, item.data, c.row.program_id
    course_id = c.course_id(data.get("course_ref"))
    if not data.get("date"):
        raise AppError("import.date_unresolved", 422)
    day = date.fromisoformat(data["date"])
    end_day = date.fromisoformat(data["end_date"]) if data.get("end_date") else day
    all_day = bool(data.get("all_day")) or not data.get("start_time")
    start_at = _local_iso(day, None if all_day else time.fromisoformat(data["start_time"]))
    end_time = str(data.get("end_time") or data.get("start_time") or "00:00")
    # All-day: any time on the last day makes it inclusive.
    end_at = _local_iso(end_day, time(12, 0) if all_day else time.fromisoformat(end_time))
    term_ref = data.get("term_ref")
    term_id = term_ref.removeprefix("term:") if term_ref else c.term_id
    event = {
        "title": data["title"],
        "start_at": start_at,
        "end_at": end_at,
        "all_day": all_day,
        "course_id": course_id,
        "term_id": term_id if course_id is None else None,
        "type_code": data.get("type_code"),
        "location": data.get("location"),
        "source_kind": c.row.source_kind,
        "source_ref": data.get("source_ref") or f"import:{item.id}",
    }
    out = await deps.call(
        ctx, "schedule.event.create_many", {"program_id": program_id, "events": [event]}
    )
    if out["created_ids"]:
        return {"created_id": out["created_ids"][0]}
    return {"updated_id": out["updated_ids"][0]}


async def _write_patch(c: _Commit, item: ImportsItem) -> dict[str, Any]:
    """Applies the accepted changes to an existing assessment or task."""
    ctx, data = c.ctx, item.data
    kind = item.type.removesuffix("_patch")
    target_id = data[f"{kind}_id"]
    changes = {
        name: change.get("new")
        for name, change in data["changes"].items()
        if change.get("apply", True)
    }
    if not changes:
        return {"updated_id": target_id, "reused": True}
    if "due_date" in changes or "due_time" in changes:
        old = {n: ch.get("old") for n, ch in data["changes"].items()}
        changes.setdefault("due_date", old.get("due_date"))
        changes.setdefault("due_time", old.get("due_time"))
        if not changes["due_date"]:
            changes["due_time"] = None
    if "score" in changes:  # {points_earned, points_possible}, or None to clear
        score = changes.pop("score") or {"points_earned": None, "points_possible": None}
        changes.update(score)
    name = "grading.assessment.update" if kind == "assessment" else "tasks.item.update"
    out = await deps.call(ctx, name, {f"{kind}_id": target_id, **changes})
    return {"updated_id": out.get("id", target_id)}


async def _write_task(c: _Commit, item: ImportsItem) -> dict[str, Any]:
    """Creates a task, or reuses the one with the same source."""
    ctx, data, program_id = c.ctx, item.data, c.row.program_id
    course_id = c.course_id(data.get("course_ref"))
    task = {
        "title": data["title"],
        "notes": data.get("notes") or "",
        "due_date": data.get("due_date"),
        "due_time": data.get("due_time") if data.get("due_date") else None,
        "priority": data.get("priority") if data.get("priority") != "none" else None,
        "course_id": course_id,
        "source_kind": {"lms": "lms", "agent": "agent"}.get(c.row.source_kind, "syllabus"),
        "source_ref": (data.get("source_ref") or f"import:{item.id}")[:200],
    }
    out = await deps.call(
        ctx, "tasks.item.create_many", {"program_id": program_id, "items": [task]}
    )
    if out["created"]:
        return {"created_id": out["created"][0]["id"]}
    return {"created_id": out["skipped"][0]["task_id"], "reused": True}


_WRITERS: dict[str, Callable[[_Commit, ImportsItem], Awaitable[dict[str, Any]]]] = {
    "course": _write_course,
    "course_patch": _write_course_patch,
    "category": _write_category,
    "assessment": _write_assessment,
    "meeting": _write_meeting,
    "event": _write_event,
    "assessment_patch": _write_patch,
    "task_patch": _write_patch,
    "task": _write_task,
}


async def _write(c: _Commit, item: ImportsItem) -> dict[str, Any]:
    """Writes one item through its target capability; returns the item's result."""
    writer = _WRITERS.get(item.type)
    if writer is None:
        raise AppError("common.validation", 422)
    return await writer(c, item)


def _builtin_categories() -> list[dict[str, str]]:
    from semestra.modules.grading.presets import BUILTIN_CATEGORIES

    return BUILTIN_CATEGORIES


async def commit(ctx: Ctx, inp: CommitInput) -> tuple[ImportSessionDetail, dict[str, int]]:
    row = await get_session_row(ctx, inp.session_id)
    if row.status in ("discarded", "committing"):
        raise AppError("import.session_closed", 409, state=row.status)
    if row.status in ("extracting", "failed"):
        raise AppError("import.session_not_ready", 409, state=row.status)
    # Claims the session with a conditional write: a second commit sent at the same time (a
    # double click, a repeated tool call) finds it taken instead of writing every item again.
    # It is also the write before the first SAVEPOINT: SQLite (pysqlite) would otherwise make that
    # savepoint the outer transaction and commit it on release, so a failing hook could not roll
    # back.
    claimed = await ctx.db.execute(
        update(ImportsSession)
        .where(
            ImportsSession.id == row.id,
            ImportsSession.status == row.status,
            ImportsSession.updated_at == row.updated_at,
        )
        .values(status="committing", updated_at=ctx.now)
        .execution_options(synchronize_session=False)
    )
    if claimed.rowcount != 1:  # pyright: ignore[reportAttributeAccessIssue]
        now = await ctx.db.scalar(select(ImportsSession.status).where(ImportsSession.id == row.id))
        if now != row.status:  # another commit took it (or the session was discarded)
            raise AppError("import.session_closed", 409, state=now)
        # Same status, newer version: an item was edited while this commit was sent. Nothing
        # was written; sending it again commits what the session holds now.
        raise AppError("import.session_changed", 409)
    row.status = "committing"
    row.updated_at = ctx.now
    items = await session_items(ctx, row.id)
    by_id = {i.id: i for i in items}
    c = _Commit(ctx, row, items)

    if inp.wizard_courses is not None:
        if target_of(row).kind != "term_wizard":
            raise AppError("common.validation", 422, errors=[{"loc": ["wizard_courses"]}])
        mapped = {w.item_id: w.course_id for w in inp.wizard_courses}
        for item_id, course_id in mapped.items():
            item = by_id.get(item_id)
            if item is None or item.type != "course":
                raise not_found()
            course = await academics.course_out(ctx, await academics.get_course_row(ctx, course_id))
            if course.program_id != row.program_id:
                raise not_found()
            item.result = {"created_id": course_id, "reused": True}
            item.decision = "accept"
            if c.term_id is None and course.term_ids:
                c.term_id = course.term_ids[-1]
        # Course items the wizard did not create were removed there, with what belongs to them.
        dropped = {
            f"item:{i.id}"
            for i in items
            if i.type == "course" and i.id not in mapped and not i.result
        }
        for item in items:
            if f"item:{item.id}" in dropped or item.data.get("course_ref") in dropped:
                item.decision = "reject"
        if c.term_id is not None:
            target = dict(row.target)
            target["term_id"] = c.term_id
            row.target = target
    elif target_of(row).kind == "term_wizard":
        raise AppError("import.term_unresolved", 422)

    wanted = set(inp.item_ids) if inp.item_ids is not None else None
    todo = sorted(
        (
            i
            for i in items
            if i.decision == "accept"
            and not (i.result and not i.result.get("error_code"))
            and (wanted is None or i.id in wanted)
        ),
        key=lambda i: (TYPE_ORDER[i.type], i.position),
    )
    created: dict[str, str] = {}
    counts = {"created": 0, "updated": 0, "failed": 0}
    for item in todo:
        pending = len(ctx.after_commit)
        try:
            async with ctx.db.begin_nested():
                result = await _write(c, item)
        except AppError as exc:
            del ctx.after_commit[pending:]  # events of the rolled-back write
            item.result = {"error_code": exc.code, "error_params": _jsonable(exc.params)}
            counts["failed"] += 1
            continue
        item.result = result
        target_id = result.get("created_id") or result.get("updated_id")
        if target_id:
            created[item.id] = target_id
        counts["updated" if result.get("updated_id") or result.get("reused") else "created"] += 1
    for item in items:
        if item.result and not item.result.get("error_code"):
            target_id = item.result.get("created_id") or item.result.get("updated_id")
            if target_id:
                created.setdefault(item.id, target_id)

    for hook in _commit_hooks.get(row.source_kind, []):
        await hook(ctx, row, created)
    await _file_uploads(ctx, row, c)

    row.status = "committed"
    row.committed_at = row.committed_at or ctx.now
    row.text = None
    await revalidate(ctx, row, items)
    await events.publish(ctx, "imports.session.committed", {**event_data(row), **counts})
    failed = {i.id for i in items if i.result and i.result.get("error_code")}
    return await detail(ctx, row, item_ids=failed if for_agent(ctx) else None), counts


def _jsonable(params: dict[str, Any]) -> dict[str, Any]:
    return {
        k: v for k, v in params.items() if isinstance(v, str | int | float | bool | list | dict)
    }


async def _file_uploads(ctx: Ctx, row: ImportsSession, c: _Commit) -> None:
    """A syllabus becomes a file of its course (M07), once that course exists, unless the user
    unticked "Also save to the course files" (`source_meta.keep_files: false`)."""
    if row.source_kind != "syllabus" or row.source_meta.get("keep_files") is False:
        return
    uploads = await session_uploads(ctx, row.id)
    if not uploads:
        return
    target = target_of(row)
    course_ids = [target.course_id] if target.course_id else []
    if not course_ids:
        course_ids = [
            cid
            for i in c.by_id.values()
            if i.type in ("course", "course_patch") and (cid := c.written(i.id))
        ]
    if len(course_ids) != 1:
        return  # several courses from several files: which file is whose is not tracked
    storage = get_storage(ctx)
    refs = [dict(r) for r in row.source_refs]
    for upload in uploads:
        key = upload.storage_key
        try:
            # The upload's row goes first, so the copy is not counted against the quota twice;
            # the savepoint brings it back if the copy is refused.
            async with ctx.db.begin_nested():
                await ctx.db.delete(upload)
                await ctx.db.flush()
                moved = await deps.move_to_course(
                    ctx, course_id=course_ids[0], filename=upload.filename, chunks=storage.open(key)
                )
                if moved is None:
                    raise AppError("import.target_unavailable", 422, capability="files")
        except AppError as exc:
            log.info("import_upload_not_filed", code=exc.code)
            for ref in refs:
                if ref.get("upload_id") == upload.id:
                    ref["warning_code"] = "import.upload_not_filed"
            continue
        _after_commit_delete(ctx, [key])
    row.source_refs = refs


# --- retention ------------------------------------------------------------------------------


async def cleanup(ctx: Ctx) -> None:
    """Sessions are kept 30 days after their last change (import history), whatever their state:
    one left for later and never finished must not hold its uploads (and quota) forever. Uploads
    that never joined a session go after one day."""
    old = (
        await ctx.db.scalars(
            select(ImportsSession).where(ImportsSession.updated_at < ctx.now - RETENTION)
        )
    ).all()
    keys: list[str] = []
    for row in old:
        uploads = (
            await ctx.db.scalars(select(ImportsUpload).where(ImportsUpload.session_id == row.id))
        ).all()
        keys += [u.storage_key for u in uploads]
        await ctx.db.execute(delete(ImportsUpload).where(ImportsUpload.session_id == row.id))
        await ctx.db.delete(row)
    stale = (
        await ctx.db.scalars(
            select(ImportsUpload).where(
                ImportsUpload.session_id.is_(None),
                ImportsUpload.created_at < ctx.now - UPLOAD_RETENTION,
            )
        )
    ).all()
    keys += [u.storage_key for u in stale]
    for upload in stale:
        await ctx.db.delete(upload)
    storage = get_storage(ctx)

    async def _remove() -> None:
        for key in keys:
            await storage.delete(key)

    ctx.after_commit.append(_remove)
