"""The assistant's turn loop (M12 §3.1), written without LangGraph (see the spec's 实现说明).

    prepare context → model → tool calls? → read: run now (≤ 4 at a time)
                                            write: auto-approved → run, else proposal (pause)
                    → model → … → finish

All state lives in the database (transcript rows, proposals, `agent_sessions.state`), so a turn
paused on proposals resumes from the transcript once the user decides. Each step opens its own
short database session; the model stream runs outside any transaction.
"""

import asyncio
import json
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass, field
from typing import Any

import structlog
from pydantic import BaseModel, ValidationError
from starlette.datastructures import State

from semestra.core.capability import Capability, Surface, registry
from semestra.core.context import AuthInfo, Ctx, ScopeRef, run_after_commit
from semestra.core.db import new_id
from semestra.core.errors import AppError
from semestra.modules.agent import history, service, skills, tools
from semestra.modules.agent.context import system_prompt
from semestra.modules.agent.models import AgentProposal, AgentSession
from semestra.modules.agent.runtime import agent_ctx
from semestra.modules.ai import Completion, Message, ToolCall
from semestra.modules.ai import catalog as ai_catalog

log = structlog.get_logger()

MAX_TOOL_CALLS = 12
PARALLEL_READS = 4
COMPACT_RATIO = 0.7
TITLE_MAX_CHARS = 20

Event = dict[str, Any]


def event(name: str, /, **data: Any) -> Event:
    return {"event": name, "data": data}


# --- running one capability -----------------------------------------------------------------


@dataclass
class Outcome:
    ok: bool
    payload: Any
    error_code: str | None = None
    citations: list[dict[str, Any]] = field(default_factory=lambda: [])

    @property
    def content(self) -> str:
        return tools.serialize(self.payload)


def _citations(payload: Any) -> list[dict[str, Any]]:
    """Results that quote files carry `citations: [{id, ...}]` (M07); the UI resolves
    `[[cite:<id>]]` markers against them."""
    raw = payload.get("citations") if isinstance(payload, dict) else None
    if not isinstance(raw, list):
        return []
    return [c for c in raw if isinstance(c, dict) and isinstance(c.get("id"), str)]  # pyright: ignore[reportUnknownVariableType]


def _error_payload(exc: AppError) -> dict[str, Any]:
    return {"error": {"code": exc.code, "params": exc.params}}


async def invoke(
    state: State,
    user_id: str,
    scope: ScopeRef | None,
    name: str,
    args: dict[str, Any],
    *,
    surface: Surface = "agent",
    auth: AuthInfo | None = None,
) -> Outcome:
    """Runs a capability in its own transaction as the agent (or MCP client), then dispatches
    its events so open pages refresh."""
    async with agent_ctx(state, user_id, scope=scope, actor=surface) as ctx:
        ctx.auth = auth
        try:
            out = await registry.invoke(ctx, name, args, surface)
            await ctx.db.commit()
        except AppError as exc:
            await ctx.db.rollback()
            return Outcome(False, _error_payload(exc), exc.code)
    await run_after_commit(ctx)
    payload = out.model_dump(mode="json") if isinstance(out, BaseModel) else out
    return Outcome(True, payload, citations=_citations(payload))


# --- proposals ------------------------------------------------------------------------------


def _generic_preview(args: dict[str, Any]) -> dict[str, Any]:
    return {
        "changes": [
            {"field": key, "after": value}
            for key, value in args.items()
            if key != "id" and not key.endswith("_id") and key != "fields"
        ]
    }


def _validation_error(exc: ValidationError) -> AppError:
    errors = [{"loc": list(e["loc"]), "code": e["type"]} for e in exc.errors()]
    return AppError("common.validation", 422, errors=errors)


async def make_preview(ctx: Ctx, cap: Capability, args: dict[str, Any]) -> dict[str, Any]:
    """The capability's own `preview` (changes with before → after, a link), else the
    arguments as a list. Raises `common.validation` for arguments the model got wrong."""
    try:
        inp = cap.input_model.model_validate(args)
    except ValidationError as exc:
        raise _validation_error(exc) from exc
    if cap.preview is not None:
        preview = await cap.preview(ctx, inp)
        if isinstance(preview, BaseModel):
            return preview.model_dump(mode="json")
        if isinstance(preview, dict):
            return preview  # pyright: ignore[reportUnknownVariableType]
    return _generic_preview(args)


# --- meta tools -----------------------------------------------------------------------------


def _meta(
    name: str, raw: dict[str, Any], session: AgentSession, available: list[Capability]
) -> Outcome:
    try:
        args = tools.META_ARGS[name].model_validate(raw)
    except ValidationError as exc:
        err = _validation_error(exc)
        return Outcome(False, _error_payload(err), err.code)
    st = dict(session.state or {})
    loaded: list[str] = list(st.get("loaded_tools", []))
    by_name = {c.name: c for c in available}
    if isinstance(args, tools.ToolsSearchArgs):
        bound = {c.name for c in tools.core_capabilities(available)} | set(loaded)
        found = tools.search([c for c in available if c.name not in bound], args.query, args.limit)
        return Outcome(
            True,
            {"tools": [{"name": c.name, "summary": c.summary, "effect": c.effect} for c in found]},
        )
    if isinstance(args, tools.ToolsLoadArgs):
        names = [tools.capability_name(n) for n in args.names]
        known = [n for n in names if n in by_name]
        st["loaded_tools"] = tools.load(loaded, known)
        session.state = st
        return Outcome(True, {"loaded": known, "unknown": [n for n in names if n not in by_name]})
    visible = skills.visible_skills(available)
    if isinstance(args, tools.SkillsSearchArgs):
        found_skills = skills.search_skills(visible, args.query)
        return Outcome(
            True, {"skills": [{"name": s.name, "description": s.description} for s in found_skills]}
        )
    assert isinstance(args, tools.SkillsReadArgs)
    skill = next((s for s in visible if s.name == args.name), None)
    if skill is None:
        return Outcome(
            False, {"error": {"code": "common.not_found", "params": {}}}, "common.not_found"
        )
    st["loaded_tools"] = tools.load(loaded, [t for t in skill.tools if t in by_name])
    session.state = st
    return Outcome(
        True, {"name": skill.name, "workflow": skill.body, "tools_loaded": list(skill.tools)}
    )


# --- one model step -------------------------------------------------------------------------


@dataclass
class Prepared:
    system: str
    messages: list[Message]
    tools: list[Any] | None
    model: Any


async def _prepare(ctx: Ctx, session: AgentSession) -> Prepared:
    rt = ctx.state.agent
    rows = await service.messages(ctx, session.id)
    props = await service.proposals(ctx, session.id)
    atts = {a.id: a for a in await service.attachments(ctx, session.id)}
    status = {p.call_id: p.status for p in props}
    st = dict(session.state or {})
    model = await rt.chat_model(ctx)

    async def load(att: Any) -> bytes:
        return await service.read_attachment(ctx, att)

    def kept(rows_: Sequence[Any]) -> list[Any]:
        until = st.get("summarized_until")
        if not until:
            return list(rows_)
        ids = [r.id for r in rows_]
        return list(rows_[ids.index(until) + 1 :]) if until in ids else list(rows_)

    current = kept(rows)
    msgs = await history.build(
        current, proposal_status=status, attachments=atts, load=load, summary=st.get("summary")
    )
    window = ai_catalog.context_window(model.model)
    cut = history.compaction_cut(current)
    if history.estimate_tokens(msgs) > COMPACT_RATIO * window and cut is not None:
        older = current[:cut]
        prior = st.get("summary")
        text = history.transcript_text(older)
        try:
            summary = await rt.small_complete(
                ctx,
                [
                    Message.system(
                        "Summarize this conversation between a student and their study "
                        "assistant for the assistant's own memory: decisions, facts, ids and "
                        "numbers that later turns may need. At most 300 words."
                    ),
                    Message.user((f"Earlier summary:\n{prior}\n\n" if prior else "") + text),
                ],
            )
        except AppError:
            summary = None
        if summary:
            st["summary"] = summary.strip()
            st["summarized_until"] = older[-1].id
            session.state = st
            current = current[cut:]
            msgs = await history.build(
                current, proposal_status=status, attachments=atts, load=load, summary=st["summary"]
            )
    available = await registry.available(ctx, "agent")
    bound = (
        tools.bound_tools(available, list(st.get("loaded_tools", [])))
        if model.supports_tools
        else None
    )
    return Prepared(await system_prompt(ctx, ctx.scope), msgs, bound, model)


async def _title(state: State, user_id: str, session_id: str) -> str | None:
    async with agent_ctx(state, user_id, scope=None) as ctx:
        session = await service.get_session_row(ctx, session_id)
        if session.title:
            return None
        rows = await service.messages(ctx, session.id)
        first = next(
            (
                b["text"]
                for r in rows
                if r.role == "user"
                for b in r.content
                if b.get("type") == "text" and b.get("text")
            ),
            "",
        )
        answer = next(
            (
                b["text"]
                for r in rows
                if r.role == "assistant"
                for b in r.content
                if b.get("type") == "text" and b.get("text")
            ),
            "",
        )
        if not first:
            return None
        language = "Simplified Chinese" if ctx.locale == "zh-CN" else "English"
        try:
            title = await state.agent.small_complete(
                ctx,
                [
                    Message.system(
                        f"Write a title for this conversation in {language}, at most "
                        f"{TITLE_MAX_CHARS} characters, no quotes, no trailing period. Reply with "
                        "the title only."
                    ),
                    Message.user(f"User: {first[:1000]}\n\nAssistant: {answer[:1000]}"),
                ],
            )
        except AppError:
            title = ""
        title = title.strip().strip("\"'“”").strip()
        if not title:
            title = first.strip().splitlines()[0]
        title = title[:TITLE_MAX_CHARS]
        session.title = title
        await ctx.db.commit()
        return title


async def _stream(
    prepared: Prepared, cancel: asyncio.Event, message_id: str
) -> AsyncIterator[Event | Completion | str]:
    """Model chunks → text_delta events; yields the final Completion (or the partial text as a
    str when stopped). A stop is noticed while waiting for the next chunk, not only after it."""
    text = ""
    chunks = aiter(
        prepared.model.stream([Message.system(prepared.system), *prepared.messages], prepared.tools)
    )
    stopped = asyncio.ensure_future(cancel.wait())
    try:
        while True:
            nxt = asyncio.ensure_future(anext(chunks))
            await asyncio.wait({nxt, stopped}, return_when=asyncio.FIRST_COMPLETED)
            if not nxt.done():
                nxt.cancel()
                await asyncio.gather(nxt, return_exceptions=True)
                yield text
                return
            try:
                chunk = nxt.result()
            except StopAsyncIteration:
                break
            if chunk.text:
                text += chunk.text
                yield event("text_delta", message_id=message_id, text=chunk.text)
            if chunk.done is not None:
                yield chunk.done
                return
            if cancel.is_set():
                yield text
                return
    finally:
        stopped.cancel()
        aclose = getattr(chunks, "aclose", None)
        if aclose is not None:
            await aclose()
    yield text


def _assistant_blocks(text: str, calls: Sequence[ToolCall]) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = [{"type": "text", "text": text}] if text else []
    blocks += [
        {"type": "tool_call", "id": c.id, "name": c.name, "args": c.arguments} for c in calls
    ]
    return blocks


def _result_block(call: ToolCall, outcome: Outcome) -> dict[str, Any]:
    return {
        "type": "tool_result",
        "call_id": call.id,
        "name": call.name,
        "capability": tools.capability_name(call.name),
        "content": outcome.content,
        "is_error": not outcome.ok,
        "error_code": outcome.error_code,
        # Something changed in the user's data: the turn can no longer be regenerated.
        "changed": outcome.ok and _changes_data(call.name),
    }


def _changes_data(tool: str) -> bool:
    cap = service.capability(tools.capability_name(tool))
    return cap is not None and cap.effect != "read"


def _tool_result_event(message_id: str, call: ToolCall, outcome: Outcome) -> Event:
    return event(
        "tool_result",
        message_id=message_id,
        call_id=call.id,
        name=tools.capability_name(call.name),
        ok=outcome.ok,
        error_code=outcome.error_code,
        changed=outcome.ok and _changes_data(call.name),
    )


async def generate(
    state: State, user_id: str, session_id: str, cancel: asyncio.Event
) -> AsyncIterator[Event]:
    """Runs the model until it answers without tool calls, pauses on proposals, is stopped, or
    hits the per-turn tool call limit."""
    used = 0
    for _ in range(MAX_TOOL_CALLS + 2):
        async with agent_ctx(state, user_id, scope=None) as ctx:
            session = await service.get_session_row(ctx, session_id)
            ctx.scope = service.scope_ref(session)
            try:
                prepared = await _prepare(ctx, session)
            except AppError as exc:
                yield event("error", code=exc.code, params=exc.params)
                return
            await ctx.db.commit()
            scope = ctx.scope

        message_id = new_id()
        yield event("message_start", message_id=message_id)
        completion: Completion | None = None
        partial = ""
        try:
            async for item in _stream(prepared, cancel, message_id):
                if isinstance(item, Completion):
                    completion = item
                elif isinstance(item, str):
                    partial = item
                else:
                    if item["event"] == "text_delta":
                        partial += item["data"]["text"]
                    yield item
        except AppError as exc:
            if partial:
                await _save_assistant(
                    state, user_id, session_id, message_id, partial, [], None, None
                )
            yield event("error", code=exc.code, params=exc.params)
            return
        except asyncio.CancelledError:  # the client went away: keep what was said
            await asyncio.shield(
                _save_assistant(state, user_id, session_id, message_id, partial, [], None, None)
            )
            raise

        if completion is None:  # stopped
            await _save_assistant(state, user_id, session_id, message_id, partial, [], None, None)
            yield event("message_end", message_id=message_id, stopped=True)
            return

        calls = list(completion.tool_calls)
        await _save_assistant(
            state,
            user_id,
            session_id,
            message_id,
            completion.text,
            calls,
            prepared.model.model,
            completion.usage,
        )
        yield event(
            "message_end",
            message_id=message_id,
            input_tokens=completion.usage.input_tokens,
            output_tokens=completion.usage.output_tokens,
        )
        if not calls:
            title = await _title(state, user_id, session_id)
            if title:
                yield event("title", title=title)
            return

        allowed = max(0, MAX_TOOL_CALLS - used)
        used += len(calls)
        paused = False
        async for item in _handle_calls(
            state, user_id, session_id, scope, message_id, calls[:allowed], calls[allowed:]
        ):
            if item["event"] == "proposal" and item["data"]["status"] == "pending":
                paused = True
            yield item
        if len(calls) > allowed:
            yield event("error", code="agent.tool_limit_reached", params={"limit": MAX_TOOL_CALLS})
            return
        if paused:
            return
        if cancel.is_set():
            return


async def _save_assistant(
    state: State,
    user_id: str,
    session_id: str,
    message_id: str,
    text: str,
    calls: Sequence[ToolCall],
    model: str | None,
    usage: Any,
) -> None:
    if not text and not calls:
        return
    async with agent_ctx(state, user_id, scope=None) as ctx:
        session = await service.get_session_row(ctx, session_id)
        service.add_message(
            ctx,
            session,
            "assistant",
            _assistant_blocks(text, calls),
            message_id=message_id,
            model=model,
            input_tokens=usage.input_tokens if usage else None,
            output_tokens=usage.output_tokens if usage else None,
        )
        await ctx.db.commit()


async def _handle_calls(
    state: State,
    user_id: str,
    session_id: str,
    scope: ScopeRef | None,
    message_id: str,
    calls: Sequence[ToolCall],
    over_limit: Sequence[ToolCall],
) -> AsyncIterator[Event]:
    async with agent_ctx(state, user_id, scope=scope) as ctx:
        available = await registry.available(ctx, "agent")
        prefs = await service.get_preferences(ctx)
    by_name = {c.name: c for c in available}

    for call in [*calls, *over_limit]:
        name = tools.capability_name(call.name)
        yield event(
            "tool_call",
            message_id=message_id,
            call_id=call.id,
            name=name if call.name not in tools.META_TOOLS else call.name,
            args=tools.summarize_args(call.arguments),
        )

    outcomes: dict[str, Outcome] = {}
    proposals: list[AgentProposal] = []
    sem = asyncio.Semaphore(PARALLEL_READS)

    async def run_read(call: ToolCall, cap_name: str) -> None:
        async with sem:
            outcomes[call.id] = await invoke(state, user_id, scope, cap_name, call.arguments)

    reads: list[Any] = []
    writes: list[tuple[ToolCall, Capability]] = []
    meta: list[ToolCall] = []
    for call in calls:
        if call.name in tools.META_TOOLS:
            meta.append(call)
            continue
        cap = by_name.get(tools.capability_name(call.name))
        if cap is None:
            outcomes[call.id] = Outcome(
                False,
                {"error": {"code": "common.not_found", "params": {"tool": call.name}}},
                "common.not_found",
            )
        elif cap.effect == "read":
            reads.append(run_read(call, cap.name))
        else:
            writes.append((call, cap))
    for call in over_limit:
        outcomes[call.id] = Outcome(
            False,
            {"error": {"code": "agent.tool_limit_reached", "params": {"limit": MAX_TOOL_CALLS}}},
            "agent.tool_limit_reached",
        )
    await asyncio.gather(*reads)

    for call, cap in writes:
        if cap.effect == "write" and cap.name in prefs.auto_approve:
            outcomes[call.id] = await invoke(state, user_id, scope, cap.name, call.arguments)

    async with agent_ctx(state, user_id, scope=scope) as ctx:
        session = await service.get_session_row(ctx, session_id)
        for call in meta:
            outcomes[call.id] = _meta(call.name, call.arguments, session, available)
        for call, cap in writes:
            if call.id in outcomes:
                continue
            try:
                preview = await make_preview(ctx, cap, call.arguments)
            except AppError as exc:
                outcomes[call.id] = Outcome(False, _error_payload(exc), exc.code)
                continue
            row = AgentProposal(
                user_id=ctx.user_id,
                session_id=session.id,
                message_id=message_id,
                call_id=call.id,
                capability=cap.name,
                args=call.arguments,
                preview=preview,
                status="pending",
                created_at=ctx.now,
            )
            ctx.db.add(row)
            proposals.append(row)
        for call in [*calls, *over_limit]:
            outcome = outcomes.get(call.id)
            if outcome is None:
                continue
            blocks = [_result_block(call, outcome)]
            blocks += [{"type": "citation", **c} for c in outcome.citations]
            service.add_message(ctx, session, "tool", blocks)
        await ctx.db.commit()
        proposal_events = [service.proposal_out(p).model_dump(mode="json") for p in proposals]

    for call in [*calls, *over_limit]:
        outcome = outcomes.get(call.id)
        if outcome is None:
            continue
        yield _tool_result_event(message_id, call, outcome)
        for citation in outcome.citations:
            yield event("citation", **citation)
    for data in proposal_events:
        yield {"event": "proposal", "data": data}


# --- decisions ------------------------------------------------------------------------------


async def decide(
    state: State, user_id: str, session_id: str, decisions: Sequence[Any]
) -> tuple[list[Event], bool]:
    """Applies the user's decisions. Returns the events to send and whether the model should
    continue (no proposal of that assistant message is still pending)."""
    out: list[Event] = []
    async with agent_ctx(state, user_id, scope=None) as ctx:
        session = await service.get_session_row(ctx, session_id)
        scope = service.scope_ref(session)
        rows = [await service.get_proposal(ctx, session.id, d.proposal_id) for d in decisions]
        for row in rows:
            if row.status == "expired":
                await ctx.db.commit()
            service.check_pending(row)
        cap_by_id = {r.id: registry.get(r.capability) for r in rows}
        for d, row in zip(decisions, rows, strict=True):
            cap = cap_by_id[row.id]
            if d.decision == "edit":
                if d.args is None:
                    raise AppError(
                        "common.validation", 422, errors=[{"loc": ["args"], "code": "missing"}]
                    )
                await make_preview(ctx, cap, d.args)  # validates
        await ctx.db.commit()
        message_ids = {r.message_id for r in rows}

    results: list[tuple[AgentProposal, Outcome, str]] = []
    for d, row in zip(decisions, rows, strict=True):
        cap = cap_by_id[row.id]
        if d.decision == "reject":
            text = "The user rejected this action; it was not executed."
            if d.reason:
                text += f" Their reason: {d.reason}"
            results.append((row, Outcome(True, {"rejected": True, "message": text}), "rejected"))
            continue
        args = d.args if d.decision == "edit" and d.args is not None else row.args
        outcome = await invoke(state, user_id, scope, row.capability, args)
        row.args = args
        results.append((row, outcome, "executed" if outcome.ok else "failed"))
        if d.remember and cap.effect == "write" and outcome.ok:
            async with agent_ctx(state, user_id, scope=None) as ctx:
                await service.remember_auto_approve(ctx, cap.name)
                await ctx.db.commit()

    async with agent_ctx(state, user_id, scope=None) as ctx:
        session = await service.get_session_row(ctx, session_id)
        for row, outcome, status in results:
            fresh = await service.get_proposal(ctx, session.id, row.id)
            fresh.status = status
            fresh.args = row.args
            fresh.decided_at = ctx.now
            if status != "rejected":
                fresh.executed_at = ctx.now
            fresh.result = outcome.payload if status != "rejected" else None
            fresh.error_code = outcome.error_code
            call = ToolCall(row.call_id, tools.tool_name(row.capability), row.args)
            blocks = [_result_block(call, outcome)]
            blocks += [{"type": "citation", **c} for c in outcome.citations]
            service.add_message(ctx, session, "tool", blocks)
            out.append(_tool_result_event(row.message_id, call, outcome))
            out.append(
                {"event": "proposal", "data": service.proposal_out(fresh).model_dump(mode="json")}
            )
        await ctx.db.flush()
        still_pending = [
            p
            for p in await service.proposals(ctx, session.id)
            if p.message_id in message_ids and p.status == "pending"
        ]
        await ctx.db.commit()
    return out, not still_pending


def sse(item: Event) -> dict[str, str]:
    return {
        "event": item["event"],
        "data": json.dumps(item["data"], ensure_ascii=False, default=str),
    }
