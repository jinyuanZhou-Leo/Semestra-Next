"""Streaming routes (M12 §4): sending a message, deciding proposals and regenerating answer
with server-sent events, plus attachment upload. The SSE routes are left out of the OpenAPI
schema; the web client reads them with `fetch` (see web `modules/assistant/stream.ts`)."""

from collections.abc import AsyncIterator, Sequence
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Form, Request, UploadFile
from sqlalchemy import delete
from sse_starlette import EventSourceResponse
from starlette.datastructures import State

from semestra.core.capability import registry
from semestra.core.context import Ctx, get_ctx
from semestra.core.db import new_id
from semestra.core.errors import AppError, not_found
from semestra.core.storage import get_storage, remaining_quota, user_key
from semestra.modules.agent import loop, service, skills
from semestra.modules.agent.models import AgentAttachment, AgentMessage, AgentProposal
from semestra.modules.agent.runtime import AgentRuntime
from semestra.modules.agent.schemas import (
    AgentAttachmentOut,
    DecideBody,
    DecideManyBody,
    Decision,
    SendMessageBody,
)

router = APIRouter(tags=["agent"])

MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
TEXT_TYPES = {"application/json", "application/xml"}
PING_SECONDS = 15


def _runtime(request: Request) -> AgentRuntime:
    return request.app.state.agent


async def _check_ai(ctx: Ctx, rt: AgentRuntime) -> None:
    if not await rt.chat_available(ctx):
        raise AppError("ai.not_configured", 409, purpose="chat")


def _check_free(rt: AgentRuntime, user_id: str, session_id: str) -> None:
    with rt.slot(user_id, session_id):
        pass


async def _events(
    state: State,
    user_id: str,
    session_id: str,
    before: Sequence[loop.Event] = (),
    run_model: bool = True,
) -> AsyncIterator[dict[str, str]]:
    rt: AgentRuntime = state.agent
    for item in before:
        yield loop.sse(item)
    if not run_model:
        return
    try:
        slot = rt.slot(user_id, session_id)
        cancel = slot.__enter__()
    except AppError as exc:
        yield loop.sse(loop.event("error", code=exc.code, params=exc.params))
        return
    try:
        async for item in loop.generate(state, user_id, session_id, cancel):
            yield loop.sse(item)
    finally:
        slot.__exit__(None, None, None)


def _respond(stream: AsyncIterator[dict[str, str]]) -> EventSourceResponse:
    return EventSourceResponse(stream, ping=PING_SECONDS, headers={"Cache-Control": "no-store"})


@router.post("/agent/sessions/{session_id}/messages", include_in_schema=False)
async def send_message(
    session_id: str,
    body: SendMessageBody,
    request: Request,
    ctx: Annotated[Ctx, Depends(get_ctx)],
) -> EventSourceResponse:
    rt = _runtime(request)
    session = await service.get_session_row(ctx, session_id)
    text = body.text.strip()
    if not text and not body.attachment_ids and not body.skill:
        raise AppError("common.validation", 422, errors=[{"loc": ["text"], "code": "missing"}])
    await _check_ai(ctx, rt)
    _check_free(rt, ctx.user_id, session.id)
    if body.scope is not None and body.scope.model_dump() != session.scope:
        await service._check_scope(ctx, body.scope)  # pyright: ignore[reportPrivateUsage]
        session.scope = body.scope.model_dump()
        session.program_id = body.scope.program_id

    blocks: list[dict[str, Any]] = []
    if body.skill:
        visible = skills.visible_skills(await registry.available(ctx, "agent"))
        skill = next((s for s in visible if s.name == body.skill), None)
        if skill is None:
            raise not_found()
        blocks.append(
            {"type": "skill", "name": skill.name, "title": skill.title, "body": skill.body}
        )
        st = dict(session.state or {})
        from semestra.modules.agent import tools

        names = {c.name for c in await registry.available(ctx, "agent")}
        st["loaded_tools"] = tools.load(
            list(st.get("loaded_tools", [])), [t for t in skill.tools if t in names]
        )
        session.state = st
    if text:
        blocks.append({"type": "text", "text": text})
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
    service.add_message(ctx, session, "user", blocks, message_id=new_id())
    await ctx.db.commit()
    user_id, state = ctx.user_id, request.app.state
    await ctx.db.close()
    return _respond(_events(state, user_id, session.id))


async def _decide(
    request: Request, ctx: Ctx, session_id: str, decisions: list[Decision]
) -> EventSourceResponse:
    rt = _runtime(request)
    session = await service.get_session_row(ctx, session_id)
    _check_free(rt, ctx.user_id, session.id)
    user_id, state = ctx.user_id, request.app.state
    await ctx.db.close()
    events, resume = await loop.decide(state, user_id, session.id, decisions)
    if resume:
        async with loop.agent_ctx(state, user_id, scope=None) as check:
            resume = await rt.chat_available(check)
    return _respond(_events(state, user_id, session.id, events, resume))


@router.post("/agent/sessions/{session_id}/proposals/{proposal_id}:decide", include_in_schema=False)
async def decide_one(
    session_id: str,
    proposal_id: str,
    body: DecideBody,
    request: Request,
    ctx: Annotated[Ctx, Depends(get_ctx)],
) -> EventSourceResponse:
    decision = Decision(proposal_id=proposal_id, **body.model_dump())
    return await _decide(request, ctx, session_id, [decision])


@router.post("/agent/sessions/{session_id}/proposals:decide", include_in_schema=False)
async def decide_many(
    session_id: str,
    body: DecideManyBody,
    request: Request,
    ctx: Annotated[Ctx, Depends(get_ctx)],
) -> EventSourceResponse:
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
) -> EventSourceResponse:
    """Drops the last answer (everything after the last user message) and answers again.
    Refused when that answer already changed data (`agent.cannot_regenerate`)."""
    rt = _runtime(request)
    session = await service.get_session_row(ctx, session_id)
    await _check_ai(ctx, rt)
    _check_free(rt, ctx.user_id, session.id)
    rows = await service.messages(ctx, session.id)
    last_user = max(
        (
            i
            for i, r in enumerate(rows)
            if r.role == "user" and any(b.get("type") != "note" for b in r.content)
        ),
        default=None,
    )
    if last_user is None:
        raise not_found()
    after = rows[last_user + 1 :]
    if message_id not in {r.id for r in after if r.role == "assistant"}:
        raise not_found()
    ids = [r.id for r in after]
    props = [p for p in await service.proposals(ctx, session.id) if p.message_id in ids]
    if any(p.status in ("executed", "failed") for p in props):
        raise AppError("agent.cannot_regenerate", 409)
    await ctx.db.execute(delete(AgentProposal).where(AgentProposal.message_id.in_(ids)))
    await ctx.db.execute(delete(AgentMessage).where(AgentMessage.id.in_(ids)))
    await ctx.db.commit()
    user_id, state = ctx.user_id, request.app.state
    await ctx.db.close()
    return _respond(_events(state, user_id, session.id))


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
    mime = (file.content_type or "application/octet-stream").split(";")[0].strip().lower()
    if mime in IMAGE_TYPES:
        kind = "image"
    elif mime == "application/pdf" or mime.startswith("text/") or mime in TEXT_TYPES:
        kind = "file"
    else:
        raise AppError("agent.attachment_unsupported", 415, mime=mime)
    data = await file.read(MAX_ATTACHMENT_BYTES + 1)
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise AppError("agent.attachment_too_large", 413, limit_bytes=MAX_ATTACHMENT_BYTES)
    left = await remaining_quota(ctx)
    if left is not None and len(data) > left:
        raise AppError("common.quota_exceeded", 413, limit_bytes=left)

    async def chunks() -> AsyncIterator[bytes]:
        yield data

    key = user_key(ctx.user_id, "agent")
    stored = await get_storage(ctx).put(key, chunks(), mime)
    row = AgentAttachment(
        user_id=ctx.user_id,
        session_id=session.id,
        kind=kind,
        name=(file.filename or "file")[:200],
        storage_key=stored.key,
        mime=mime,
        size=stored.size,
        created_at=ctx.now,
    )
    ctx.db.add(row)
    await ctx.db.commit()
    return service.attachment_out(row)
