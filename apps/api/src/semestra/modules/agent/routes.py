"""Streaming routes (M12 §4): sending, editing a message, deciding proposals, regenerating an
answer and continuing after a pause, with server-sent events, plus attachment upload. The SSE
routes are left out of the OpenAPI schema; the web client reads them with `fetch` (see web
`modules/assistant/stream.ts`).

Each of them starts the turn as a background generation (`AgentRuntime.start`) and follows it:
a client that goes away does not stop the turn, and `GET /agent/sessions/{id}/events` follows it
again, after `Last-Event-ID` or from its start."""

import asyncio
from collections.abc import AsyncIterator
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Form, Header, Request, Response, UploadFile
from sqlalchemy import delete
from sse_starlette import EventSourceResponse
from starlette.datastructures import State

from semestra.core.capability import registry
from semestra.core.context import Ctx, get_ctx, run_after_commit
from semestra.core.db import new_id
from semestra.core.errors import AppError, not_found
from semestra.core.storage import get_storage, remaining_quota, user_key
from semestra.modules.agent import attachments, decisions, loop, service, skills, store
from semestra.modules.agent.models import (
    AgentAttachment,
    AgentMessage,
    AgentProposal,
    AgentSession,
)
from semestra.modules.agent.runtime import AgentRuntime, Claim, agent_ctx
from semestra.modules.agent.schemas import (
    AgentAttachmentOut,
    CompactBody,
    DecideBody,
    DecideManyBody,
    Decision,
    EditMessageBody,
    SendMessageBody,
)
from semestra.modules.files.parse import detect

router = APIRouter(tags=["agent"])
_upload_locks: dict[str, asyncio.Lock] = {}

MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
PING_SECONDS = 15


def _runtime(request: Request) -> AgentRuntime:
    return request.app.state.agent


async def _check_ai(ctx: Ctx, rt: AgentRuntime) -> None:
    if not await rt.chat_available(ctx):
        raise AppError("ai.not_configured", 409, purpose="chat")


async def _events(
    state: State, claim: Claim, decided: decisions.Claimed | None = None
) -> AsyncIterator[dict[str, str]]:
    """The turn's events. The first, `start`, names the last row stored before the turn: a
    client following from the start drops what it has after that row, as the events rebuild it.
    Decided cards run first, as part of the turn: a client that reloads meanwhile follows it."""
    async with agent_ctx(state, claim.user_id, scope=None) as ctx:
        after = await service.last_message_id(ctx, claim.session_id)
    yield store.sse(store.event("start", after=after))
    if decided is not None:
        before, resume = await decisions.run(state, claim.user_id, claim.session_id, decided)
        for item in before:
            yield store.sse(item)
        if resume:
            async with agent_ctx(state, claim.user_id, scope=None) as check:
                resume = await state.agent.chat_available(check)
        if not resume:
            return
    async for item in loop.generate(state, claim.user_id, claim.session_id, claim.cancel):
        yield store.sse(item)


def _follow(items: AsyncIterator[dict[str, str]]) -> Response:
    return EventSourceResponse(items, ping=PING_SECONDS, headers={"Cache-Control": "no-store"})


def _respond(rt: AgentRuntime, stream: AsyncIterator[dict[str, str]], claim: Claim) -> Response:
    """Starts the turn in the background (it holds the claimed slot until it ends) and follows
    it."""
    return _follow(rt.start(claim, stream).follow())


@router.get("/agent/sessions/{session_id}/events", include_in_schema=False)
async def follow_events(
    session_id: str,
    request: Request,
    ctx: Annotated[Ctx, Depends(get_ctx)],
    last_event_id: Annotated[str | None, Header()] = None,
) -> Response:
    """Follows the session's turn (another tab, a reload, a lost connection): after
    `Last-Event-ID` when it names this turn, else from its start. 204 when no turn is running or
    just ended."""
    session = await service.get_session_row(ctx, session_id)
    await ctx.db.close()
    gen = _runtime(request).generation(session.id)
    if gen is None:
        return Response(status_code=204)
    return _follow(gen.follow(gen.position(last_event_id)))


@router.post("/agent/sessions/{session_id}/messages", include_in_schema=False)
async def send_message(
    session_id: str,
    body: SendMessageBody,
    request: Request,
    ctx: Annotated[Ctx, Depends(get_ctx)],
) -> Response:
    rt = _runtime(request)
    session = await service.get_session_row(ctx, session_id)
    text = body.text.strip()
    if not text and not body.attachment_ids and not body.skill:
        raise AppError("common.validation", 422, errors=[{"loc": ["text"], "code": "missing"}])
    await _check_ai(ctx, rt)
    claim = rt.claim(ctx.user_id, session.id)
    try:
        await _store_message(ctx, session, body)
    except BaseException:
        claim.release()
        raise
    state = request.app.state
    await ctx.db.close()
    return _respond(rt, _events(state, claim), claim)


async def _store_message(ctx: Ctx, session: AgentSession, body: SendMessageBody) -> None:
    text = body.text.strip()
    if body.scope is not None and body.scope.model_dump() != session.scope:
        await service.check_scope(ctx, body.scope)
        session.scope = body.scope.model_dump()
        session.program_id = body.scope.program_id

    blocks: list[dict[str, Any]] = []
    if body.skill:
        visible = skills.visible_skills(await registry.available(ctx, "agent"))
        skill = next((s for s in visible if s.name == body.skill), None)
        if skill is None:
            raise not_found()
        blocks.append(
            {
                "type": "skill",
                "name": skill.name,
                "title": skill.title,
                "body": skill.body,
                "tools": list(skill.tools),
            }
        )
    if text:
        blocks.append({"type": "text", "text": text})
    blocks += await service.reference_blocks(ctx, body.references)
    owned = {a.id: a for a in await service.attachments(ctx, session.id)}
    for att_id in dict.fromkeys(body.attachment_ids):
        att = owned.get(att_id)
        if att is None:
            raise not_found()
        blocks.append(
            {
                "type": "image_ref" if att.kind == "image" else "file_ref",
                "attachment_id": att.id,
                "name": att.name,
                "mime": att.mime,
            }
        )
    # Cards still waiting get a placeholder result first: the history stays append-only.
    await decisions.close_open_calls(ctx, session)
    service.reset_turn(session)
    service.add_message(ctx, session, "user", blocks, message_id=new_id())
    await ctx.db.commit()


async def _decide(request: Request, ctx: Ctx, session_id: str, chosen: list[Decision]) -> Response:
    rt = _runtime(request)
    session = await service.get_session_row(ctx, session_id)
    user_id, state = ctx.user_id, request.app.state
    await ctx.db.close()
    # Held from before the pending check until the turn ends: two decisions on the same
    # proposal (two tabs, "approve all" and a card, a retry) can never both execute it.
    claim = rt.claim(user_id, session.id)
    try:
        decided = await decisions.claim(state, user_id, session.id, chosen)
    except BaseException:
        claim.release()
        raise
    return _respond(rt, _events(state, claim, decided), claim)


@router.post("/agent/sessions/{session_id}/proposals/{proposal_id}:decide", include_in_schema=False)
async def decide_one(
    session_id: str,
    proposal_id: str,
    body: DecideBody,
    request: Request,
    ctx: Annotated[Ctx, Depends(get_ctx)],
) -> Response:
    decision = Decision(proposal_id=proposal_id, **body.model_dump())
    return await _decide(request, ctx, session_id, [decision])


@router.post("/agent/sessions/{session_id}:compact", include_in_schema=False)
async def compact_session(
    session_id: str,
    body: CompactBody,
    request: Request,
    ctx: Annotated[Ctx, Depends(get_ctx)],
) -> Response:
    """Summarizes the conversation before the user's last message now (the user asked); runs as
    a turn, so Stop ends it and other tabs follow it."""
    rt = _runtime(request)
    session = await service.get_session_row(ctx, session_id)
    await _check_ai(ctx, rt)
    user_id, state = ctx.user_id, request.app.state
    await ctx.db.close()
    claim = rt.claim(user_id, session.id)
    return _respond(rt, _compaction_events(state, claim, body.focus.strip()), claim)


async def _compaction_events(
    state: State, claim: Claim, focus: str
) -> AsyncIterator[dict[str, str]]:
    async with agent_ctx(state, claim.user_id, scope=None) as ctx:
        after = await service.last_message_id(ctx, claim.session_id)
    yield store.sse(store.event("start", after=after))
    async for item in loop.compact_session(
        state, claim.user_id, claim.session_id, claim.cancel, focus
    ):
        yield store.sse(item)


@router.post("/agent/sessions/{session_id}/proposals:decide", include_in_schema=False)
async def decide_many(
    session_id: str,
    body: DecideManyBody,
    request: Request,
    ctx: Annotated[Ctx, Depends(get_ctx)],
) -> Response:
    """ "Approve all" on the proposals of one answer."""
    return await _decide(request, ctx, session_id, body.decisions)


@router.post(
    "/agent/sessions/{session_id}/messages/{message_id}:regenerate", include_in_schema=False
)
async def regenerate(
    session_id: str,
    message_id: str,
    request: Request,
    ctx: Annotated[Ctx, Depends(get_ctx)],
) -> Response:
    """Drops the last answer (everything after the last user message) and answers again.
    Refused when that answer already changed data (`agent.cannot_regenerate`)."""
    rt = _runtime(request)
    session = await service.get_session_row(ctx, session_id)
    await _check_ai(ctx, rt)
    claim = rt.claim(ctx.user_id, session.id)
    try:
        await _drop_last_answer(ctx, session, message_id)
    except BaseException:
        claim.release()
        raise
    state = request.app.state
    await ctx.db.close()
    return _respond(rt, _events(state, claim), claim)


@router.post("/agent/sessions/{session_id}/messages/{message_id}:edit", include_in_schema=False)
async def edit_message(
    session_id: str,
    message_id: str,
    body: EditMessageBody,
    request: Request,
    ctx: Annotated[Ctx, Depends(get_ctx)],
) -> Response:
    """Replaces the text of one of the user's messages, drops everything after it (messages and
    proposals) and answers again. The slot is held from the edit to the end of the answer."""
    rt = _runtime(request)
    session = await service.get_session_row(ctx, session_id)
    await _check_ai(ctx, rt)
    claim = rt.claim(ctx.user_id, session.id)
    try:
        await service.edit_message(ctx, session, message_id, body.text, body.references)
        await ctx.db.commit()
    except BaseException:
        claim.release()
        raise
    await run_after_commit(ctx)  # removes the files of dropped attachments
    state = request.app.state
    await ctx.db.close()
    return _respond(rt, _events(state, claim), claim)


@router.post("/agent/sessions/{session_id}:continue", include_in_schema=False)
async def continue_turn(
    session_id: str,
    request: Request,
    ctx: Annotated[Ctx, Depends(get_ctx)],
) -> Response:
    """Goes on after the turn paused at the tool-call limit (the answer ends with a `paused`
    block): the counts start afresh."""
    rt = _runtime(request)
    session = await service.get_session_row(ctx, session_id)
    await _check_ai(ctx, rt)
    user_id, state = ctx.user_id, request.app.state
    await ctx.db.close()
    claim = rt.claim(user_id, session.id)
    try:
        await decisions.continue_turn(state, user_id, session.id)
    except BaseException:
        claim.release()
        raise
    return _respond(rt, _events(state, claim), claim)


async def _drop_last_answer(ctx: Ctx, session: AgentSession, message_id: str) -> None:
    rows = await service.messages(ctx, session.id)
    after = service.last_answer(rows)
    if after is None or message_id not in {r.id for r in after if r.role == "assistant"}:
        raise not_found()
    ids = [r.id for r in after]
    props = [p for p in await service.proposals(ctx, session.id) if p.message_id in ids]
    if service.changed_data(after, props):
        raise AppError("agent.cannot_regenerate", 409)
    await ctx.db.execute(delete(AgentProposal).where(AgentProposal.message_id.in_(ids)))
    await ctx.db.execute(delete(AgentMessage).where(AgentMessage.id.in_(ids)))
    service.reset_turn(session)
    await ctx.db.commit()


@router.post(
    "/agent/attachments",
    operation_id="agentAttachmentUpload",
    response_model=AgentAttachmentOut,
    summary="Upload a file or image for the assistant.",
)
async def upload_attachment(
    session_id: Annotated[str, Form()],
    file: UploadFile,
    ctx: Annotated[Ctx, Depends(get_ctx)],
) -> AgentAttachmentOut:
    session = await service.get_session_row(ctx, session_id)
    data = await file.read(MAX_ATTACHMENT_BYTES + 1)
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise AppError("agent.attachment_too_large", 413, limit_bytes=MAX_ATTACHMENT_BYTES)
    # The type comes from the content, not the browser's claim (Windows often sends
    # application/octet-stream for .ics and .md).
    name = file.filename or "file"
    detected = detect(data, name)
    if detected.mime in IMAGE_TYPES:
        kind = "image"
    elif detected.kind in attachments.DOCUMENT_KINDS:
        kind = "file"
    else:
        raise AppError("agent.attachment_unsupported", 415, mime=detected.mime)
    # A cheap quota check before the (up to a minute) parse; checked again under the lock.
    left = await remaining_quota(ctx)
    if left is not None and len(data) > left:
        raise AppError("common.quota_exceeded", 413, limit_bytes=left)
    reading = await attachments.read_upload(ctx, data, detected)
    # One upload at a time per user, so parallel uploads cannot each pass the quota check.
    async with _upload_locks.setdefault(ctx.user_id, asyncio.Lock()):
        left = await remaining_quota(ctx)
        if left is not None and len(data) > left:
            raise AppError("common.quota_exceeded", 413, limit_bytes=left)

        async def chunks() -> AsyncIterator[bytes]:
            yield data

        key = user_key(ctx.user_id, "agent")
        stored = await get_storage(ctx).put(key, chunks(), detected.mime)
        row = AgentAttachment(
            id=new_id(),
            user_id=ctx.user_id,
            session_id=session.id,
            kind=kind,
            name=name[:200],
            storage_key=stored.key,
            mime=detected.mime,
            size=stored.size,
            created_at=ctx.now,
        )
        ctx.db.add(row)
        attachments.store_reading(ctx, row, reading)
        await ctx.db.commit()
    return service.attachment_out(row)
