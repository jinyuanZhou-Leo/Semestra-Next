"""Sessions, transcript rows, proposals, attachments and preferences (M12 §2, §4)."""

from collections.abc import Sequence
from datetime import timedelta
from typing import Any

from sqlalchemy import delete, func, select

from semestra.core.capability import Capability, registry
from semestra.core.context import Ctx, ScopeRef
from semestra.core.errors import AppError, not_found
from semestra.core.storage import get_storage, storage_usage_provider
from semestra.modules.agent.models import (
    AgentAttachment,
    AgentMessage,
    AgentPreferences,
    AgentProposal,
    AgentSession,
)
from semestra.modules.agent.schemas import (
    AttachmentOut,
    MessageOut,
    Preferences,
    PreferencesUpdateInput,
    ProposalOut,
    ScopeIn,
    SessionDetail,
    SessionListInput,
    SessionOut,
    SessionUpdateInput,
)

PROPOSAL_TTL = timedelta(hours=24)


# --- sessions -------------------------------------------------------------------------------


def session_out(row: AgentSession) -> SessionOut:
    return SessionOut(
        id=row.id,
        title=row.title,
        program_id=row.program_id,
        scope=ScopeIn.model_validate(row.scope) if row.scope else None,
        pinned=row.pinned,
        created_at=row.created_at,
        updated_at=row.updated_at,
        archived_at=row.archived_at,
    )


def scope_ref(row: AgentSession) -> ScopeRef | None:
    if not row.scope:
        return None
    return ScopeRef(row.scope["program_id"], row.scope.get("term_id"), row.scope.get("course_id"))


async def _check_scope(ctx: Ctx, scope: ScopeIn | None) -> None:
    """The scope must be the user's own Program, term and course."""
    if scope is None:
        return
    from semestra.modules.academics import service as academics

    await academics.get_program_row(ctx, scope.program_id)
    if scope.term_id:
        term = await academics.get_term_row(ctx, scope.term_id)
        if term.program_id != scope.program_id:
            raise not_found()
    if scope.course_id:
        course = await academics.get_course_row(ctx, scope.course_id)
        if course.program_id != scope.program_id:
            raise not_found()


async def get_session_row(ctx: Ctx, session_id: str) -> AgentSession:
    row = await ctx.db.get(AgentSession, session_id)
    if row is None or row.user_id != ctx.user_id:
        raise not_found()
    return row


async def list_sessions(ctx: Ctx, inp: SessionListInput) -> list[SessionOut]:
    stmt = select(AgentSession).where(AgentSession.user_id == ctx.user_id)
    stmt = stmt.where(
        AgentSession.archived_at.is_not(None)
        if inp.archived
        else AgentSession.archived_at.is_(None)
    )
    if inp.query:
        stmt = stmt.where(func.lower(AgentSession.title).contains(inp.query.lower()))
    stmt = stmt.order_by(AgentSession.updated_at.desc()).limit(inp.limit)
    return [session_out(r) for r in (await ctx.db.scalars(stmt)).all()]


async def create_session(ctx: Ctx, scope: ScopeIn | None) -> AgentSession:
    await _check_scope(ctx, scope)
    row = AgentSession(
        user_id=ctx.user_id,
        program_id=scope.program_id if scope else None,
        scope=scope.model_dump() if scope else None,
        state={},
        created_at=ctx.now,
        updated_at=ctx.now,
    )
    ctx.db.add(row)
    await ctx.db.flush()
    return row


async def update_session(ctx: Ctx, inp: SessionUpdateInput) -> AgentSession:
    row = await get_session_row(ctx, inp.id)
    fields = inp.model_fields_set
    if "title" in fields:
        row.title = (inp.title or "").strip() or None
    if "pinned" in fields and inp.pinned is not None:
        row.pinned = inp.pinned
    if "archived" in fields and inp.archived is not None:
        row.archived_at = ctx.now if inp.archived else None
    if "scope" in fields:
        await _check_scope(ctx, inp.scope)
        row.scope = inp.scope.model_dump() if inp.scope else None
        row.program_id = inp.scope.program_id if inp.scope else None
    await ctx.db.flush()
    return row


async def delete_session(ctx: Ctx, session_id: str) -> None:
    row = await get_session_row(ctx, session_id)
    if ctx.state.agent.generating(row.id):
        raise AppError("agent.busy", 429)
    atts = (
        await ctx.db.scalars(select(AgentAttachment).where(AgentAttachment.session_id == row.id))
    ).all()
    storage = get_storage(ctx)
    keys = [a.storage_key for a in atts]
    await ctx.db.execute(delete(AgentProposal).where(AgentProposal.session_id == row.id))
    await ctx.db.execute(delete(AgentAttachment).where(AgentAttachment.session_id == row.id))
    await ctx.db.execute(delete(AgentMessage).where(AgentMessage.session_id == row.id))
    await ctx.db.delete(row)

    async def _remove_files() -> None:
        for key in keys:
            await storage.delete(key)

    ctx.after_commit.append(_remove_files)


async def touch(ctx: Ctx, session: AgentSession) -> None:
    session.updated_at = ctx.now


# --- transcript ----------------------------------------------------------------------------


async def messages(ctx: Ctx, session_id: str) -> list[AgentMessage]:
    stmt = (
        select(AgentMessage)
        .where(AgentMessage.session_id == session_id, AgentMessage.user_id == ctx.user_id)
        .order_by(AgentMessage.created_at, AgentMessage.id)
    )
    return list((await ctx.db.scalars(stmt)).all())


def add_message(
    ctx: Ctx,
    session: AgentSession,
    role: str,
    content: list[dict[str, Any]],
    *,
    message_id: str | None = None,
    model: str | None = None,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
) -> AgentMessage:
    row = AgentMessage(
        user_id=ctx.user_id,
        session_id=session.id,
        role=role,
        content=content,
        model=model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        created_at=ctx.now,
    )
    if message_id is not None:
        row.id = message_id
    ctx.db.add(row)
    session.updated_at = ctx.now
    return row


def message_out(row: AgentMessage) -> MessageOut:
    return MessageOut(
        id=row.id,
        role=row.role,  # pyright: ignore[reportArgumentType]
        content=row.content,
        model=row.model,
        input_tokens=row.input_tokens,
        output_tokens=row.output_tokens,
        created_at=row.created_at,
    )


# --- proposals -----------------------------------------------------------------------------


def _capability(name: str) -> Capability | None:
    try:
        return registry.get(name)
    except AppError:
        return None


def proposal_out(row: AgentProposal) -> ProposalOut:
    cap = _capability(row.capability)
    return ProposalOut(
        id=row.id,
        session_id=row.session_id,
        message_id=row.message_id,
        call_id=row.call_id,
        capability=row.capability,
        effect=cap.effect if cap else "write",
        args=row.args,
        input_schema=cap.input_model.model_json_schema() if cap else {},
        preview=row.preview,
        status=row.status,  # pyright: ignore[reportArgumentType]
        result=row.result,
        error_code=row.error_code,
        created_at=row.created_at,
        decided_at=row.decided_at,
        executed_at=row.executed_at,
    )


async def proposals(ctx: Ctx, session_id: str) -> list[AgentProposal]:
    stmt = (
        select(AgentProposal)
        .where(AgentProposal.session_id == session_id, AgentProposal.user_id == ctx.user_id)
        .order_by(AgentProposal.created_at, AgentProposal.id)
    )
    rows = list((await ctx.db.scalars(stmt)).all())
    for row in rows:
        expire_if_stale(ctx, row)
    return rows


def expire_if_stale(ctx: Ctx, row: AgentProposal) -> None:
    if row.status == "pending" and row.created_at + PROPOSAL_TTL <= ctx.now:
        row.status = "expired"


async def get_proposal(ctx: Ctx, session_id: str, proposal_id: str) -> AgentProposal:
    row = await ctx.db.get(AgentProposal, proposal_id)
    if row is None or row.user_id != ctx.user_id or row.session_id != session_id:
        raise not_found()
    expire_if_stale(ctx, row)
    return row


def check_pending(row: AgentProposal) -> None:
    if row.status == "expired":
        raise AppError("agent.proposal_expired", 410)
    if row.status != "pending":
        raise AppError("agent.proposal_not_pending", 409, current=row.status)


# --- attachments ---------------------------------------------------------------------------


def attachment_out(row: AgentAttachment) -> AttachmentOut:
    return AttachmentOut(
        id=row.id,
        session_id=row.session_id,
        kind=row.kind,  # pyright: ignore[reportArgumentType]
        name=row.name,
        mime=row.mime,
        size=row.size,
        created_at=row.created_at,
    )


async def attachments(ctx: Ctx, session_id: str) -> list[AgentAttachment]:
    stmt = select(AgentAttachment).where(
        AgentAttachment.session_id == session_id, AgentAttachment.user_id == ctx.user_id
    )
    return list((await ctx.db.scalars(stmt)).all())


async def read_attachment(ctx: Ctx, row: AgentAttachment) -> bytes:
    chunks = [chunk async for chunk in get_storage(ctx).open(row.storage_key)]
    return b"".join(chunks)


@storage_usage_provider("agent")
async def _storage_used(ctx: Ctx) -> int:
    total = await ctx.db.scalar(
        select(func.coalesce(func.sum(AgentAttachment.size), 0)).where(
            AgentAttachment.user_id == ctx.user_id
        )
    )
    return int(total or 0)


# --- detail --------------------------------------------------------------------------------


async def detail(ctx: Ctx, session_id: str) -> SessionDetail:
    row = await get_session_row(ctx, session_id)
    return SessionDetail(
        session=session_out(row),
        messages=[message_out(m) for m in await messages(ctx, row.id)],
        proposals=[proposal_out(p) for p in await proposals(ctx, row.id)],
        attachments=[attachment_out(a) for a in await attachments(ctx, row.id)],
        generating=ctx.state.agent.generating(row.id),
    )


# --- preferences ---------------------------------------------------------------------------


async def preferences_row(ctx: Ctx) -> AgentPreferences | None:
    return await ctx.db.get(AgentPreferences, ctx.user_id)


async def get_preferences(ctx: Ctx) -> Preferences:
    row = await preferences_row(ctx)
    if row is None:
        return Preferences(auto_approve=[], mcp_allow_destructive=False)
    return Preferences(
        auto_approve=list(row.auto_approve), mcp_allow_destructive=row.mcp_allow_destructive
    )


def _check_auto_approve(names: Sequence[str]) -> list[str]:
    """Only write capabilities offered to the agent can skip the confirmation card."""
    for name in names:
        cap = _capability(name)
        if cap is None or "agent" not in cap.expose or cap.effect != "write":
            raise AppError(
                "common.validation",
                422,
                errors=[{"loc": ["auto_approve"], "code": "not_auto_approvable", "name": name}],
            )
    return sorted(set(names))


async def update_preferences(ctx: Ctx, inp: PreferencesUpdateInput) -> Preferences:
    row = await preferences_row(ctx)
    if row is None:
        row = AgentPreferences(
            user_id=ctx.user_id, auto_approve=[], mcp_allow_destructive=False, updated_at=ctx.now
        )
        ctx.db.add(row)
    if inp.auto_approve is not None:
        row.auto_approve = _check_auto_approve(inp.auto_approve)
    if inp.mcp_allow_destructive is not None:
        row.mcp_allow_destructive = inp.mcp_allow_destructive
    row.updated_at = ctx.now
    await ctx.db.flush()
    return await get_preferences(ctx)


async def remember_auto_approve(ctx: Ctx, capability: str) -> None:
    prefs = await get_preferences(ctx)
    if capability not in prefs.auto_approve:
        await update_preferences(
            ctx, PreferencesUpdateInput(auto_approve=[*prefs.auto_approve, capability])
        )
