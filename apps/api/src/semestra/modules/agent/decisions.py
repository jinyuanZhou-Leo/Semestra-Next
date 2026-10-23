"""Confirmation cards (M12 §3.5): what a card shows, the user's decisions, and the results of
calls the conversation moved past. A decided card runs here, before the model goes on; the loop
then hands its outcome to the model (`loop._prepare`)."""

import asyncio
from collections.abc import Sequence
from typing import Any

import structlog
from pydantic import BaseModel
from pydantic_ai.messages import ModelRequest, ToolCallPart, ToolReturnPart
from starlette.datastructures import State

from semestra.core.capability import Capability, registry
from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules.agent import display, history, outcome, service, tools
from semestra.modules.agent.models import AgentProposal, AgentSession
from semestra.modules.agent.outcome import Outcome
from semestra.modules.agent.runtime import agent_ctx
from semestra.modules.agent.store import Event, result_event

log = structlog.get_logger()

CONTINUE_NOTE = "The user pressed Continue: carry on from where you stopped."


# --- what a card shows ------------------------------------------------------------------------


async def _generic_preview(ctx: Ctx, cap: Capability, args: dict[str, Any]) -> dict[str, Any]:
    """Each argument as a change, before → after for an update, ids by name (agent/display).
    A failure here leaves the card without details, never without the card."""
    try:
        return await display.preview(ctx, cap.name, args)
    except Exception:
        log.exception("agent_display_failed", capability=cap.name)
        return {"changes": []}


async def make_preview(ctx: Ctx, cap: Capability, args: dict[str, Any]) -> dict[str, Any]:
    """The capability's own `preview` (changes with before → after, a link), else the
    arguments as a list. Raises `common.validation` for arguments the model got wrong, and the
    capability's own `check` errors, before the card is shown."""
    inp = await registry.validate(ctx, cap, args, "agent")
    out: dict[str, Any] = {"changes": []}
    if cap.preview is not None:
        preview = await cap.preview(ctx, inp)
        if isinstance(preview, BaseModel):
            out = preview.model_dump(mode="json")
        elif isinstance(preview, dict):
            out = dict(preview)  # pyright: ignore[reportUnknownArgumentType]
    else:
        out = await _generic_preview(ctx, cap, args)
    if not out.get("target"):
        # What the card is about, by name: the ids in the arguments are never shown.
        try:
            names = await display.labels(ctx, cap.name, args)
        except Exception:
            log.exception("agent_display_failed", capability=cap.name)
            names = []
        if names:
            out["target"] = " · ".join(names)
    return out


def edited(prop: AgentProposal, called: dict[str, Any]) -> bool:
    """Whether the user changed the arguments on the card; the ones filled in from the
    conversation (the Program) do not count."""
    try:
        filled = registry.context_args(registry.get(prop.capability))
    except AppError:
        filled = {}
    return any(
        called.get(k) != v for k, v in prop.args.items() if k in called or k not in filled
    ) or any(k not in prop.args for k in called)


# --- calls the conversation moved past -----------------------------------------------------------


def close_calls(
    ctx: Ctx,
    session: AgentSession,
    calls: Sequence[ToolCallPart],
    props: dict[str, AgentProposal],
) -> tuple[ModelRequest, str]:
    """Stores a result for each open call, so the history stays valid when the conversation
    moves on: a decided card's outcome, else a placeholder (its decision arrives as a note).
    Returns the request and its row's id."""
    parts: list[ToolReturnPart] = []
    blocks: list[dict[str, Any]] = []
    for c in calls:
        prop = props.get(c.tool_call_id)
        if prop is None:
            result = outcome.error("agent.interrupted")
        else:
            result = outcome.proposal_outcome(prop)
        part = ToolReturnPart(c.tool_name, result.content, tool_call_id=c.tool_call_id)
        parts.append(part)
        if prop is None or prop.status not in ("pending", "expired"):
            cap = service.capability(tools.capability_name(c.tool_name))
            part.metadata = outcome.result_meta(cap, result)
            blocks.append(history.result_block(part))
    request = ModelRequest(parts=parts)
    row = service.add_message(ctx, session, "tool", blocks, model_parts=history.dump(request))
    return request, row.id


async def close_open_calls(ctx: Ctx, session: AgentSession) -> None:
    """Before a new user message: the calls of the last answer that still wait get a result."""
    rows = await service.messages(ctx, session.id)
    stored = [m for m in map(history.load, rows) if m is not None]
    calls = history.open_calls(stored)
    if calls:
        props = {p.call_id: p for p in await service.proposals(ctx, session.id)}
        close_calls(ctx, session, calls, props)


# --- decisions ------------------------------------------------------------------------------


async def decide(
    state: State, user_id: str, session_id: str, decisions: Sequence[Any]
) -> tuple[list[Event], bool]:
    """Applies the user's decisions: an approved card runs now, so it shows its result at once.
    Returns the events to send and whether the model should go on (no card of the answer still
    waits). The model then gets the outcomes through `DeferredToolResults`, or as a note when the
    conversation had moved on before the decision."""
    out: list[Event] = []
    async with agent_ctx(state, user_id, scope=None) as ctx:
        session = await service.get_session_row(ctx, session_id)
        scope = service.scope_ref(session)
        ids = [d.proposal_id for d in decisions]
        if len(set(ids)) != len(ids):
            raise AppError(
                "common.validation", 422, errors=[{"loc": ["decisions"], "code": "duplicate"}]
            )
        rows = [await service.get_proposal(ctx, session.id, i) for i in ids]
        for row in rows:
            if row.status == "expired":
                await ctx.db.commit()
            service.check_pending(row)
        cap_by_id = {r.id: registry.get(r.capability) for r in rows}
        # Edited arguments get a fresh preview, so the card shows what actually ran.
        edited_preview: dict[str, dict[str, Any]] = {}
        for d, row in zip(decisions, rows, strict=True):
            cap = cap_by_id[row.id]
            if d.decision == "edit":
                if d.args is None:
                    raise AppError(
                        "common.validation", 422, errors=[{"loc": ["args"], "code": "missing"}]
                    )
                edited_preview[row.id] = await make_preview(ctx, cap, d.args)  # validates
        for d, row in zip(decisions, rows, strict=True):
            await service.claim_proposal(ctx, row, reject=d.decision == "reject")
        await ctx.db.commit()
        message_ids = {r.message_id for r in rows}

    results: list[tuple[AgentProposal, Outcome]] = []
    for d, row in zip(decisions, rows, strict=True):
        cap = cap_by_id[row.id]
        if d.decision == "reject":
            text = outcome.REJECTED
            if d.reason:
                text += f" Their reason: {d.reason}"
            result = Outcome(True, {"rejected": True, "message": text}, ran=False)
            results.append((row, result))
            await asyncio.shield(_record(state, user_id, session_id, row, result, "rejected", None))
            continue
        args = d.args if d.decision == "edit" and d.args is not None else row.args
        result = await outcome.invoke(state, user_id, scope, row.capability, args)
        row.args = args
        status = "executed" if result.ok else "failed"
        results.append((row, result))
        # Stored at once: if anything stops the rest, this card still shows what it did.
        # The write is committed: a client leaving now must not leave the card "interrupted".
        await asyncio.shield(
            _record(state, user_id, session_id, row, result, status, edited_preview.get(row.id))
        )
        if d.remember and cap.effect == "write" and result.ok:
            async with agent_ctx(state, user_id, scope=None) as ctx:
                await service.remember_auto_approve(ctx, cap.name)
                await ctx.db.commit()

    async with agent_ctx(state, user_id, scope=None) as ctx:
        session = await service.get_session_row(ctx, session_id)
        stored = [history.load(r) for r in await service.messages(ctx, session.id)]
        open_ids = {c.tool_call_id for c in history.open_calls([m for m in stored if m])}
        for row, result in results:
            fresh = await service.get_proposal(ctx, session.id, row.id)
            part = ToolReturnPart(
                tools.tool_name(row.capability),
                result.content,
                tool_call_id=row.call_id,
                metadata=outcome.result_meta(cap_by_id[row.id], result),
            )
            out += result_event(row.message_id, part)
            out.append(
                {"event": "proposal", "data": service.proposal_out(fresh).model_dump(mode="json")}
            )
            if row.call_id not in open_ids:
                # The conversation moved on before this decision: the model hears it as a note.
                note = history.late_note(row.capability, result.content, not result.ok)
                service.add_message(ctx, session, "user", [{"type": "note", "text": note}])
        await ctx.db.flush()
        still_pending = [
            p
            for p in await service.proposals(ctx, session.id)
            if p.message_id in message_ids and p.status == "pending" and p.call_id in open_ids
        ]
        await ctx.db.commit()
    return out, not still_pending


async def _record(
    state: State,
    user_id: str,
    session_id: str,
    row: AgentProposal,
    result: Outcome,
    status: str,
    preview: dict[str, Any] | None,
) -> None:
    """Stores a decided card's outcome in its own transaction."""
    async with agent_ctx(state, user_id, scope=None) as ctx:
        fresh = await service.get_proposal(ctx, session_id, row.id)
        fresh.status = status
        fresh.args = row.args
        if preview is not None:
            fresh.preview = preview
        fresh.decided_at = ctx.now
        if status != "rejected":
            fresh.executed_at = ctx.now
        fresh.result = result.payload
        fresh.error_code = result.error_code
        fresh.display = result.display or None
        await ctx.db.commit()


async def continue_turn(state: State, user_id: str, session_id: str) -> None:
    """Continue after a pause: the counts start afresh and the model is told to go on."""
    async with agent_ctx(state, user_id, scope=None) as ctx:
        session = await service.get_session_row(ctx, session_id)
        rows = await service.messages(ctx, session.id)
        last = rows[-1] if rows else None
        if last is None or not any(b.get("type") == "paused" for b in last.content):
            raise AppError("agent.not_paused", 409)
        service.reset_turn(session)
        service.add_message(ctx, session, "user", [{"type": "note", "text": CONTINUE_NOTE}])
        await ctx.db.commit()
