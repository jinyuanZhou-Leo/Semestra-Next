"""The assistant's turn loop (M12 §3.1) on a Pydantic AI `Agent` (see the spec's 实现说明).

    history → model → tool calls? → read: run now (≤ 4 at a time)
                                    write: auto-approved → run, else a proposal: the run ends
                                           with `DeferredToolRequests` and waits for the user
            → model → … → answer

Deciding the proposals resumes the run with `DeferredToolResults`. Every message is stored as
soon as it is complete (`agent_messages.model_parts`), so a stopped or failed turn keeps what was
said. Each step opens its own short database session; the model streams outside any transaction.

Per user message the model gets `TOOL_CALL_LIMIT` tool calls and `REQUEST_LIMIT` requests,
counted across approvals. At the limit, or when it repeats one call `REPEAT_PAUSE` times, the
extra calls are not run, the model answers once more without tools (what is done, what is left)
and the turn pauses: the user can press Continue (`continue_turn`).
"""

import asyncio
import json
import time
from collections.abc import AsyncIterator, Sequence
from dataclasses import asdict, dataclass, field, fields, replace
from typing import Any, Literal

import structlog
from pydantic import BaseModel, ValidationError
from pydantic_ai import Agent, RunContext, ToolReturn
from pydantic_ai.capabilities import AbstractCapability, Caching, ToolSearch
from pydantic_ai.capabilities import Capability as Bundle
from pydantic_ai.exceptions import ApprovalRequired, SkipToolExecution, UnexpectedModelBehavior
from pydantic_ai.messages import (
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    ModelMessage,
    ModelRequest,
    ModelResponse,
    PartDeltaEvent,
    PartStartEvent,
    RetryPromptPart,
    TextPart,
    TextPartDelta,
    ThinkingPart,
    ThinkingPartDelta,
    ToolCallPart,
    ToolReturnPart,
)
from pydantic_ai.models import Model, ModelRequestContext
from pydantic_ai.native_tools import SUPPORTED_NATIVE_TOOLS
from pydantic_ai.native_tools._tool_search import ToolSearchTool
from pydantic_ai.settings import ModelSettings
from pydantic_ai.tools import (
    DeferredToolRequests,
    DeferredToolResults,
    ToolApproved,
    ToolDefinition,
    ToolDenied,
)
from pydantic_ai.usage import UsageLimits
from starlette.datastructures import State

from semestra.core.capability import Capability, Surface, registry
from semestra.core.context import AuthInfo, Ctx, ScopeRef, run_after_commit
from semestra.core.db import new_id
from semestra.core.errors import AppError
from semestra.modules.agent import history, memory, service, skills, tools
from semestra.modules.agent.context import STATIC_PROMPT, sent_note, work_context
from semestra.modules.agent.models import AgentMessage, AgentProposal, AgentSession
from semestra.modules.agent.runtime import ChatLike, agent_ctx
from semestra.modules.ai import Message, wrap_untrusted

log = structlog.get_logger()

TOOL_CALL_LIMIT = 30
REQUEST_LIMIT = 50
REPEAT_BLOCK = 3  # the same call with the same arguments this many times in a row: not run
REPEAT_PAUSE = 5  # ... this many times: the turn pauses as at the limit
PARALLEL_READS = 4
TOOL_RETRIES = 5  # unknown tools and bad search arguments, per tool and run
COMPACT_RATIO = 0.7
KEEP_USER_TURNS = 2
TITLE_MAX_CHARS = 20

PauseReason = Literal["tool_limit", "loop"]
PAUSE_NOTES: dict[str, str] = {
    "tool_limit": (
        "You reached the limit of tool calls for this message; the calls after it were not run. "
        "Do not call tools now. Tell the user in a few sentences what is done and what is left. "
        "They can press Continue to let you go on."
    ),
    "loop": (
        "You repeated the same tool call several times without progress, so the turn was paused. "
        "Do not call tools now. Tell the user in a few sentences what is done, what is left and "
        "what went wrong. They can press Continue to let you try again."
    ),
}
CONTINUE_NOTE = "The user pressed Continue: carry on from where you stopped."

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
    ran: bool = True  # False for a rejected proposal: nothing was executed

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


def _error(code: str, **params: Any) -> Outcome:
    return Outcome(False, {"error": {"code": code, "params": params}}, code)


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


def _proposal_outcome(row: AgentProposal) -> Outcome:
    """What a decided proposal gave, as the tool's result."""
    if row.status == "executed":
        return Outcome(True, row.result, citations=_citations(row.result))
    if row.status == "failed":
        code = row.error_code or "agent.interrupted"
        payload = row.result if row.result is not None else {"error": {"code": code, "params": {}}}
        return Outcome(False, payload, code)
    if row.status == "rejected":
        message = (row.result or {}).get("message") if isinstance(row.result, dict) else None
        return Outcome(True, {"rejected": True, "message": message or REJECTED}, ran=False)
    return Outcome(True, history.EXPIRED if row.status == "expired" else history.PENDING, ran=False)


REJECTED = "The user rejected this action; it was not executed."


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


# --- what one run shares ----------------------------------------------------------------------


@dataclass
class Counters:
    """Per user message, kept in `session.state["turn"]` across approvals; Continue resets it."""

    tool_calls: int = 0
    requests: int = 0
    last_call: str | None = None
    repeats: int = 0
    # Set at the limit or on a loop: a run resumed after approvals goes straight to the answer.
    pause: PauseReason | None = None

    @classmethod
    def load(cls, raw: Any) -> Counters:
        if not isinstance(raw, dict):
            return cls()
        names = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in raw.items() if k in names})  # pyright: ignore[reportUnknownArgumentType]


@dataclass
class Turn:
    """Pydantic AI's `deps` for one run: what the tools and the hooks below share."""

    state: State
    user_id: str
    session_id: str
    scope: ScopeRef | None
    model: ChatLike
    caps: dict[str, Capability]
    auto_approve: frozenset[str]
    skills: dict[str, skills.Skill]
    counters: Counters
    memo: dict[str, Any]  # session.state without "turn": the compaction summary
    work: str  # the work context (second part of the instructions)
    decided: dict[str, Outcome] = field(default_factory=lambda: {})  # approved, by call id
    edited: dict[str, dict[str, Any]] = field(
        default_factory=lambda: {}
    )  # args changed on the card
    full: dict[str, tuple[str, str]] = field(default_factory=lambda: {})  # uncut results
    sem: asyncio.Semaphore = field(default_factory=lambda: asyncio.Semaphore(PARALLEL_READS))


def _tool_return(cap: Capability | None, call_id: str, outcome: Outcome, turn: Turn) -> ToolReturn:
    """The model gets the result as JSON (cut at `RESULT_LIMIT`, wrapped when it quotes other
    people's text); the UI's fields ride along in the metadata, which the model never sees."""
    name = cap.name if cap is not None else ""
    text = outcome.content
    shown = tools.page(text, call_id)
    meta: dict[str, Any] = {
        "ok": outcome.ok,
        "error_code": outcome.error_code,
        "changed": bool(outcome.ok and outcome.ran and cap is not None and cap.effect != "read"),
        "citations": outcome.citations,
    }
    if shown != text:
        meta["full"] = text
        turn.full[call_id] = (name, text)
    if outcome.ok and outcome.ran and name in memory.TOOLS and isinstance(outcome.payload, dict):
        # The chat shows "Remembered: …" with an undo link (only for a memory this call created,
        # so the undo never deletes an older one), or "Forgot: …".
        saved: dict[str, Any] = outcome.payload  # pyright: ignore[reportUnknownVariableType]
        if name == memory.FORGET or saved.get("created"):
            action = "forgot" if name == memory.FORGET else "remembered"
            meta["memory"] = {"id": saved["id"], "content": saved["content"], "action": action}
    if outcome.ok and name in tools.UNTRUSTED_RESULTS:
        shown = wrap_untrusted(shown, name)
    return ToolReturn(return_value=shown, metadata=meta)


def _tool(cap: Capability) -> tools.ToolFunction:
    async def run(ctx: RunContext[Turn], **args: Any) -> ToolReturn:
        turn, call_id = ctx.deps, ctx.tool_call_id or ""
        if ctx.tool_call_approved:
            # Approved cards ran when the user decided (`decide`); the run only collects them.
            outcome = turn.decided.get(call_id) or _error("agent.interrupted")
            if call_id in turn.edited:
                # The call in the history keeps the model's arguments: say what actually ran.
                outcome = replace(
                    outcome,
                    payload={
                        "note": "The user changed the arguments on the card; it ran with these.",
                        "arguments": turn.edited[call_id],
                        "result": outcome.payload,
                    },
                )
        elif cap.effect == "read":
            async with turn.sem:
                outcome = await invoke(turn.state, turn.user_id, turn.scope, cap.name, args)
        else:
            token = memory.conversation.set(turn.session_id)
            try:
                outcome = await invoke(turn.state, turn.user_id, turn.scope, cap.name, args)
            finally:
                memory.conversation.reset(token)
        return _tool_return(cap, call_id, outcome, turn)

    return run


async def _read_result(ctx: RunContext[Turn], call_id: str, offset: int) -> str:
    turn = ctx.deps
    found = turn.full.get(call_id)
    if found is None:
        async with agent_ctx(turn.state, turn.user_id, scope=None) as c:
            rows = await service.messages(c, turn.session_id)
        block = next(
            (
                b
                for r in rows
                if r.role == "tool"
                for b in r.content
                if b.get("call_id") == call_id and b.get("full")
            ),
            None,
        )
        if block is not None:
            found = (str(block.get("capability", "")), str(block["full"]))
    if found is None:
        return tools.serialize({"error": {"code": "common.not_found", "params": {}}})
    name, text = found
    shown = tools.page(text, call_id, max(0, offset))
    return wrap_untrusted(shown, name) if name in tools.UNTRUSTED_RESULTS else shown


def _skipped(turn: Turn, call: ToolCallPart, code: str, **params: Any) -> SkipToolExecution:
    cap = turn.caps.get(tools.capability_name(call.tool_name))
    return SkipToolExecution(_tool_return(cap, call.tool_call_id, _error(code, **params), turn))


class _Hooks(AbstractCapability[Turn]):
    """Limits, confirmation cards, skill tools, which reasoning goes back, compaction."""

    async def before_tool_execute(
        self,
        ctx: RunContext[Turn],
        *,
        call: ToolCallPart,
        tool_def: ToolDefinition,
        args: dict[str, Any],
    ) -> dict[str, Any]:
        turn = ctx.deps
        if ctx.tool_call_approved:
            return args  # counted when it was proposed
        counters = turn.counters
        if counters.pause is not None:
            raise _skipped(turn, call, "agent.tool_limit_reached", limit=TOOL_CALL_LIMIT)
        counters.tool_calls += 1
        if counters.tool_calls > TOOL_CALL_LIMIT:
            counters.pause = "tool_limit"
            raise _skipped(turn, call, "agent.tool_limit_reached", limit=TOOL_CALL_LIMIT)
        key = f"{call.tool_name} {history.args_json(args)}"
        counters.repeats = counters.repeats + 1 if key == counters.last_call else 1
        counters.last_call = key
        if counters.repeats >= REPEAT_PAUSE:
            counters.pause = "loop"
            raise _skipped(turn, call, "agent.repeated_call", times=counters.repeats)
        if counters.repeats >= REPEAT_BLOCK:
            raise _skipped(turn, call, "agent.repeated_call", times=counters.repeats)
        cap = turn.caps.get(tools.capability_name(call.tool_name))
        if cap is None or cap.effect == "read":
            return args
        if cap.effect == "write" and (cap.name in turn.auto_approve or cap.name in memory.TOOLS):
            return args
        try:
            async with agent_ctx(turn.state, turn.user_id, scope=turn.scope) as c:
                preview = await make_preview(c, cap, args)
        except AppError as exc:  # wrong arguments go back to the model without a card
            outcome = Outcome(False, _error_payload(exc), exc.code)
            raise SkipToolExecution(_tool_return(cap, call.tool_call_id, outcome, turn)) from None
        raise ApprovalRequired(metadata={"preview": preview})

    async def after_tool_execute(
        self,
        ctx: RunContext[Turn],
        *,
        call: ToolCallPart,
        tool_def: ToolDefinition,
        args: dict[str, Any],
        result: Any,
    ) -> Any:
        # A loaded skill also reveals the tools its workflow uses.
        if call.tool_name == tools.LOAD_CAPABILITY and isinstance(result, ToolReturn):
            skill = ctx.deps.skills.get(str(args.get("id", "")))
            if skill is not None:
                names = [*(result.tools or []), *(tools.tool_name(t) for t in skill.tools)]
                result.tools = list(dict.fromkeys(names))
        return result

    async def before_model_request(
        self, ctx: RunContext[Turn], request_context: ModelRequestContext
    ) -> ModelRequestContext:
        turn = ctx.deps
        messages = [m for m in (_replayable(m, turn) for m in request_context.messages) if m]
        request_context.messages = await _compact(turn, messages)
        if not _defers_tools(request_context.model):
            params = request_context.model_request_parameters
            params.function_tools = _tool_order(params.function_tools, request_context.messages)
        return request_context


def _defers_tools(model: Model) -> bool:
    """Providers with native tool search (Anthropic, OpenAI Responses) get every deferred tool on
    every request, marked as deferred, and a reveal unlocks it in place: the list is already the
    same on every request, so it is left in Pydantic AI's order."""
    return ToolSearchTool in model.profile.get("supported_native_tools", SUPPORTED_NATIVE_TOOLS)


def _tool_order(defs: list[ToolDefinition], messages: list[ModelMessage]) -> list[ToolDefinition]:
    """Elsewhere a revealed tool becomes an ordinary one. Tools found later go after the ones the
    model already had, in the order they were found, so the tool list only ever grows at its end
    (prompt caching)."""
    found = {name: i for i, name in enumerate(history.revealed_tools(messages))}
    late = len(found)
    return sorted(defs, key=lambda d: found.get(d.name, late) if d.defer_loading else -1)


def _replayable(message: ModelMessage, turn: Turn) -> ModelMessage | None:
    """Reasoning goes back only to the provider and model that produced it (signatures and
    encrypted details mean nothing elsewhere). Our own requests are left as they are."""
    if not isinstance(message, ModelResponse):
        return message
    source = (message.metadata or {}).get("source", turn.model.source)
    if source == turn.model.source or not any(isinstance(p, ThinkingPart) for p in message.parts):
        return message
    parts = [p for p in message.parts if not isinstance(p, ThinkingPart)]
    return replace(message, parts=parts) if parts else None


def _typed(message: ModelMessage) -> bool:
    """A request carrying something the user wrote (marked when the history is loaded)."""
    return isinstance(message, ModelRequest) and (message.metadata or {}).get("typed") is True


def _row_id(message: ModelMessage) -> str | None:
    rid = (message.metadata or {}).get("row_id")
    return rid if isinstance(rid, str) else None


async def _compact(turn: Turn, messages: list[ModelMessage]) -> list[ModelMessage]:
    """When the request would fill more than `COMPACT_RATIO` of the context window, the turns
    before the last `KEEP_USER_TURNS` are summarized by the small model (`title` purpose). Only
    the request changes; the stored history stays as it is. The summary is kept in the session
    and reused until the next compaction."""
    memo = turn.memo
    until = memo.get("summarized_until")
    if memo.get("summary") and until:
        at = next((i for i, m in enumerate(messages) if _row_id(m) == until), None)
        if at is not None:
            summary = history.summary_request(memo["summary"], list(memo.get("revealed", [])))
            messages = [summary, *messages[at + 1 :]]
    if history.prompt_tokens(messages) <= COMPACT_RATIO * turn.model.context_window:
        return messages
    starts = [i for i, m in enumerate(messages) if _typed(m)]
    if len(starts) <= KEEP_USER_TURNS:
        return messages
    cut = starts[-KEEP_USER_TURNS]
    older = messages[:cut]
    last = next((r for r in map(_row_id, reversed(older)) if r), None)
    if last is None:
        return messages
    prior = memo.get("summary") if until else None
    text = history.transcript_text([m for m in older if _row_id(m)])
    try:
        async with agent_ctx(turn.state, turn.user_id, scope=None) as ctx:
            summary = await turn.state.agent.small_complete(
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
        return messages
    summary = (summary or "").strip()
    if not summary:
        return messages
    revealed = list(dict.fromkeys([*memo.get("revealed", []), *history.revealed_tools(older)]))
    memo.update(summary=summary, summarized_until=last, revealed=revealed)
    return [history.summary_request(summary, revealed), *messages[cut:]]


def _skill(skill: skills.Skill) -> Bundle[Turn]:
    # The catalog (id and description) is in the instructions; `load_capability` returns the
    # workflow as a tool result, so loading one changes neither the prompt nor the tool list.
    return Bundle(
        id=skill.name, description=skill.description, instructions=skill.body, defer_loading=True
    )


def _agent(
    turn: Turn, available: list[Capability], visible: list[skills.Skill]
) -> Agent[Turn, Any]:
    capabilities: list[AbstractCapability[Turn]] = [_Hooks(), Caching()]
    toolsets = []
    if turn.model.supports_tools:
        toolsets.append(tools.toolset(available, _tool, _read_result))
        capabilities = [
            ToolSearch(strategy="keywords"),
            *(_skill(s) for s in visible),
            *capabilities,
        ]
    return Agent(
        turn.model.model,
        deps_type=Turn,
        output_type=[str, DeferredToolRequests],
        instructions=STATIC_PROMPT,
        toolsets=toolsets,
        capabilities=capabilities,
        retries={"tools": TOOL_RETRIES, "output": 1},
        model_settings=ModelSettings(openai_prompt_cache_key=turn.session_id),  # pyright: ignore[reportCallIssue]
    )


# --- loading the history --------------------------------------------------------------------


@dataclass
class Prepared:
    turn: Turn
    agent: Agent[Turn, Any]
    messages: list[ModelMessage]
    resume: DeferredToolResults | None


async def _messages(
    ctx: Ctx, session: AgentSession, rows: Sequence[AgentMessage], model: ChatLike, tz: Any
) -> list[ModelMessage]:
    atts = {a.id: a for a in await service.attachments(ctx, session.id)}
    out: list[ModelMessage] = []
    for row in rows:
        if row.role == "user":
            msg = await history.user_request(
                ctx,
                row,
                attachments=atts,
                stamp=lambda at: sent_note(at, tz),
                vision=model.vision,
            )
        else:
            msg = history.load(row)
        if msg is not None:
            msg.metadata = {
                **(msg.metadata or {}),
                "row_id": row.id,
                "typed": history.is_typed(row),
            }
            out.append(msg)
    return out


async def _prepare(ctx: Ctx, session: AgentSession, model: ChatLike) -> Prepared:
    rows = await service.messages(ctx, session.id)
    props = {p.call_id: p for p in await service.proposals(ctx, session.id)}
    work = await work_context(ctx, ctx.scope)
    messages = await _messages(ctx, session, rows, model, work.timezone)
    resume: DeferredToolResults | None = None
    edited: dict[str, dict[str, Any]] = {}
    calls = history.open_calls(messages)
    if any(
        props.get(c.tool_call_id) is None or props[c.tool_call_id].status == "pending"
        for c in calls
    ):
        # Not resumable (a card still waits, or the stream was cut before the tools ran):
        # every call gets its result now, so the model can go on.
        messages.append(close_calls(ctx, session, calls, props))
    elif calls:
        resume = DeferredToolResults()
        for c in calls:
            prop = props[c.tool_call_id]
            if prop.status in ("executed", "failed"):
                resume.approvals[c.tool_call_id] = ToolApproved(override_args=prop.args)
                if prop.args != history.args_of(c):
                    edited[c.tool_call_id] = prop.args
            else:
                text = _proposal_outcome(prop).content
                resume.approvals[c.tool_call_id] = ToolDenied(text)
    remembered = await memory.snapshot(ctx, session)
    available = await registry.available(ctx, "agent")
    if not remembered:  # a temporary conversation, or memory turned off
        available = [c for c in available if c.name not in memory.TOOLS]
    prefs = await service.get_preferences(ctx)
    visible = skills.visible_skills(available)
    st = dict(session.state or {})
    turn = Turn(
        state=ctx.state,
        user_id=ctx.user_id,
        session_id=session.id,
        scope=ctx.scope,
        model=model,
        caps={c.name: c for c in available},
        auto_approve=frozenset(prefs.auto_approve),
        skills={s.name: s for s in visible},
        counters=Counters.load(st.pop("turn", None)),
        memo=st,
        work=f"{work.text}\n\n{remembered}" if remembered else work.text,
        decided={
            p.call_id: _proposal_outcome(p)
            for p in props.values()
            if p.status in ("executed", "failed")
        },
        edited=edited,
    )
    return Prepared(turn, _agent(turn, available, visible), messages, resume)


def close_calls(
    ctx: Ctx,
    session: AgentSession,
    calls: Sequence[ToolCallPart],
    props: dict[str, AgentProposal],
) -> ModelRequest:
    """Stores a result for each open call, so the history stays valid when the conversation
    moves on: a decided card's outcome, else a placeholder (its decision arrives as a note)."""
    parts: list[ToolReturnPart] = []
    blocks: list[dict[str, Any]] = []
    for c in calls:
        prop = props.get(c.tool_call_id)
        outcome = _error("agent.interrupted") if prop is None else _proposal_outcome(prop)
        part = ToolReturnPart(c.tool_name, outcome.content, tool_call_id=c.tool_call_id)
        parts.append(part)
        if prop is None or prop.status not in ("pending", "expired"):
            cap = service.capability(tools.capability_name(c.tool_name))
            meta = {
                "ok": outcome.ok,
                "error_code": outcome.error_code,
                "changed": bool(outcome.ok and outcome.ran and cap and cap.effect != "read"),
            }
            part.metadata = meta
            blocks.append(history.result_block(part))
    request = ModelRequest(parts=parts)
    row = service.add_message(ctx, session, "tool", blocks, model_parts=history.dump(request))
    request.metadata = {"row_id": row.id}
    return request


async def close_open_calls(ctx: Ctx, session: AgentSession) -> None:
    """Before a new user message: the calls of the last answer that still wait get a result."""
    rows = await service.messages(ctx, session.id)
    stored = [m for m in map(history.load, rows) if m is not None]
    calls = history.open_calls(stored)
    if calls:
        props = {p.call_id: p for p in await service.proposals(ctx, session.id)}
        close_calls(ctx, session, calls, props)


# --- one run --------------------------------------------------------------------------------


def _elapsed_ms(started: float) -> int:
    return round((time.monotonic() - started) * 1000)


async def _race[T](items: AsyncIterator[T], cancel: asyncio.Event) -> AsyncIterator[T]:
    """`items` until they end or `cancel` is set; a stop is noticed while waiting too."""
    stopped = asyncio.ensure_future(cancel.wait())
    try:
        while True:
            nxt = asyncio.ensure_future(anext(items))
            await asyncio.wait({nxt, stopped}, return_when=asyncio.FIRST_COMPLETED)
            if not nxt.done():
                nxt.cancel()
                await asyncio.gather(nxt, return_exceptions=True)
                return
            try:
                item = nxt.result()
            except StopAsyncIteration:
                return
            yield item
            if cancel.is_set():
                return
    finally:
        stopped.cancel()


@dataclass
class _Answer:
    """The model response being streamed."""

    message_id: str
    started: float = field(default_factory=time.monotonic)
    text: str = ""
    thought: str = ""
    thinking_ms: int | None = None

    def timing(self, response: ModelResponse) -> int:
        # A step that only called tools worked all the way to its end.
        calls = any(isinstance(p, ToolCallPart) for p in response.parts)
        if self.thinking_ms is None or calls:
            return _elapsed_ms(self.started)
        return self.thinking_ms


def _delta(item: Any, answer: _Answer) -> Event | None:
    text = thought = ""
    if isinstance(item, PartStartEvent):
        if isinstance(item.part, TextPart):
            text = item.part.content
        elif isinstance(item.part, ThinkingPart):
            thought = item.part.content
    elif isinstance(item, PartDeltaEvent):
        if isinstance(item.delta, TextPartDelta):
            text = item.delta.content_delta
        elif isinstance(item.delta, ThinkingPartDelta):
            thought = item.delta.content_delta or ""
    if text:
        answer.text += text
        if answer.thinking_ms is None:
            answer.thinking_ms = _elapsed_ms(answer.started)
        return event("text_delta", message_id=answer.message_id, text=text)
    if thought:
        answer.thought += thought
        return event("reasoning_delta", message_id=answer.message_id, text=thought)
    return None


class _Store:
    """Writes the run's messages as they complete. A run starts from the stored history, whose
    trailing requests Pydantic AI merges into one; everything after them is new."""

    def __init__(self, prepared: Prepared) -> None:
        self.prepared = prepared
        self.turn = prepared.turn
        messages = prepared.messages
        trailing = 0
        while trailing < len(messages) and isinstance(messages[-1 - trailing], ModelRequest):
            trailing += 1
        self.base = len(messages) - trailing + (1 if trailing else 0)
        self.saved: set[int] = set()

    async def answer(
        self, response: ModelResponse, answer: _Answer, *, paused: str | None = None
    ) -> None:
        """An assistant row with the id announced in `message_start`."""
        self.saved.add(id(response))
        blocks = history.response_blocks(response, answer.timing(response))
        if paused:
            blocks.append({"type": "paused", "reason": paused})
        response.metadata = {
            **(response.metadata or {}),
            "source": self.turn.model.source,
            "row_id": answer.message_id,
        }
        replayed = any(
            isinstance(p, TextPart | ToolCallPart | ThinkingPart) for p in response.parts
        )
        async with agent_ctx(self.turn.state, self.turn.user_id, scope=None) as ctx:
            session = await service.get_session_row(ctx, self.turn.session_id)
            service.add_message(
                ctx,
                session,
                "assistant",
                blocks,
                message_id=answer.message_id,
                model=self.turn.model.name,
                input_tokens=response.usage.input_tokens or None,
                output_tokens=response.usage.output_tokens or None,
                model_parts=history.dump(response) if replayed else None,
            )
            _save_state(session, self.turn)
            await ctx.db.commit()

    async def partial(self, answer: _Answer) -> None:
        """What was streamed before a stop or an error: the text goes back to the model, the
        unsigned partial thinking is only shown."""
        response = ModelResponse(parts=[TextPart(answer.text)] if answer.text else [])
        if not answer.text and not answer.thought:
            return
        blocks: list[dict[str, Any]] = (
            [{"type": "reasoning", "text": answer.thought}] if answer.thought else []
        )
        blocks += [{"type": "text", "text": answer.text}] if answer.text else []
        blocks.append(
            {"type": "timing", "thinking_ms": answer.thinking_ms or _elapsed_ms(answer.started)}
        )
        async with agent_ctx(self.turn.state, self.turn.user_id, scope=None) as ctx:
            session = await service.get_session_row(ctx, self.turn.session_id)
            service.add_message(
                ctx,
                session,
                "assistant",
                blocks,
                message_id=answer.message_id,
                model=self.turn.model.name,
                model_parts=history.dump(response) if answer.text else None,
            )
            _save_state(session, self.turn)
            await ctx.db.commit()

    async def sync(self, messages: Sequence[ModelMessage]) -> None:
        """New tool results become tool rows."""
        new = [
            m
            for m in messages[self.base :]
            if isinstance(m, ModelRequest)
            and id(m) not in self.saved
            and any(isinstance(p, ToolReturnPart | RetryPromptPart) for p in m.parts)
        ]
        async with agent_ctx(self.turn.state, self.turn.user_id, scope=None) as ctx:
            session = await service.get_session_row(ctx, self.turn.session_id)
            for m in new:
                self.saved.add(id(m))
                blocks = history.request_blocks(m)
                history.strip_full(m)
                row = service.add_message(ctx, session, "tool", blocks, model_parts=history.dump(m))
                m.metadata = {**(m.metadata or {}), "row_id": row.id}
            _save_state(session, self.turn)
            await ctx.db.commit()


def _save_state(session: AgentSession, turn: Turn) -> None:
    session.state = {**turn.memo, "turn": asdict(turn.counters)}


def _result_event(message_id: str, part: ToolReturnPart | RetryPromptPart) -> list[Event]:
    block = history.result_block(part)
    out = [
        event(
            "tool_result",
            message_id=message_id,
            call_id=block["call_id"],
            name=block["capability"],
            ok=not block["is_error"],
            error_code=block["error_code"],
            changed=block["changed"],
            **({"memory": block["memory"]} if "memory" in block else {}),
        )
    ]
    meta = part.metadata if isinstance(part, ToolReturnPart) else None
    if isinstance(meta, dict):
        out += [event("citation", **c) for c in meta.get("citations", [])]
    return out


async def generate(
    state: State, user_id: str, session_id: str, cancel: asyncio.Event
) -> AsyncIterator[Event]:
    """Runs the model until it answers, pauses on proposals or at the limit, or is stopped. A
    history ending in decided proposals is resumed first."""
    try:
        async with agent_ctx(state, user_id, scope=None) as ctx:
            session = await service.get_session_row(ctx, session_id)
            ctx.scope = service.scope_ref(session)
            async with state.agent.chat_model(ctx) as model:
                prepared = await _prepare(ctx, session, model)
                await ctx.db.commit()
                async for item in _run(prepared, cancel):
                    yield item
    except AppError as exc:
        yield event("error", code=exc.code, params=exc.params)


async def _run(prepared: Prepared, cancel: asyncio.Event) -> AsyncIterator[Event]:
    turn, agent = prepared.turn, prepared.agent
    store = _Store(prepared)
    answer: _Answer | None = None
    reported = set(prepared.resume.approvals) if prepared.resume else set()
    try:
        async with agent.iter(
            None,
            message_history=prepared.messages,
            deferred_tool_results=prepared.resume,
            deps=turn,
            instructions=turn.work,
            usage_limits=UsageLimits(request_limit=None),
        ) as run:
            async for node in run:
                if Agent.is_model_request_node(node):
                    await store.sync([*run.all_messages(), node.request])
                    if cancel.is_set():
                        return
                    if turn.counters.requests >= REQUEST_LIMIT:
                        turn.counters.pause = "tool_limit"
                    if turn.counters.pause is not None:
                        break
                    turn.counters.requests += 1
                    answer = _Answer(new_id())
                    yield event("message_start", message_id=answer.message_id)
                    async with node.stream(run.ctx) as stream:
                        async for item in _race(aiter(stream), cancel):
                            if (delta := _delta(item, answer)) is not None:
                                yield delta
                        if cancel.is_set():
                            await store.partial(answer)
                            yield event("message_end", message_id=answer.message_id, stopped=True)
                            return
                elif Agent.is_call_tools_node(node):
                    response = node.model_response
                    if answer is not None:
                        await store.answer(response, answer)
                        yield event(
                            "message_end",
                            message_id=answer.message_id,
                            input_tokens=response.usage.input_tokens,
                            output_tokens=response.usage.output_tokens,
                        )
                    message_id = _row_id(response) or ""
                    answer = None
                    async with node.stream(run.ctx) as stream:
                        async for item in stream:
                            if isinstance(item, FunctionToolCallEvent):
                                if item.part.tool_call_id in reported:
                                    continue
                                yield event(
                                    "tool_call",
                                    message_id=message_id,
                                    call_id=item.part.tool_call_id,
                                    name=tools.capability_name(item.part.tool_name),
                                    args=tools.summarize_args(history.args_of(item.part)),
                                )
                            elif isinstance(item, FunctionToolResultEvent):
                                if item.part.tool_call_id in reported:
                                    continue
                                for out in _result_event(message_id, item.part):
                                    yield out
                    if cancel.is_set():
                        await store.sync(run.all_messages())
                        return
            else:
                # The run ended: an answer, or proposals waiting for the user.
                await store.sync(run.all_messages())
                output = run.result.output if run.result is not None else None
                if isinstance(output, DeferredToolRequests):
                    for item in await _propose(turn, run.all_messages(), output):
                        yield item
                    return
                title = await _title(turn.state, turn.user_id, turn.session_id)
                if title:
                    yield event("title", title=title)
                return
            messages = run.all_messages()
            pending = node.request if Agent.is_model_request_node(node) else None
        # Paused at the limit: one more answer, without tools.
        history_ = [*messages, *([pending] if pending is not None else [])]
        async for item in _close(prepared, history_, cancel):
            yield item
    except AppError as exc:
        if answer is not None:
            await asyncio.shield(store.partial(answer))
        yield event("error", code=exc.code, params=exc.params)
    except UnexpectedModelBehavior as exc:
        log.warning("agent_model_misbehaved", error=type(exc).__name__)
        if answer is not None:
            await asyncio.shield(store.partial(answer))
        yield event("error", code="ai.output_invalid", params={})
    except asyncio.CancelledError:  # the client went away: keep what was said
        if answer is not None:
            await asyncio.shield(store.partial(answer))
        raise


async def _close(
    prepared: Prepared, messages: list[ModelMessage], cancel: asyncio.Event
) -> AsyncIterator[Event]:
    turn = prepared.turn
    reason = turn.counters.pause or "tool_limit"
    async with agent_ctx(turn.state, turn.user_id, scope=None) as ctx:
        session = await service.get_session_row(ctx, turn.session_id)
        row = service.add_message(
            ctx, session, "user", [{"type": "note", "text": PAUSE_NOTES[reason]}]
        )
        _save_state(session, turn)
        await ctx.db.commit()
        note = history.note_request(PAUSE_NOTES[reason])
        note.metadata = {"row_id": row.id}
    answer = _Answer(new_id())
    yield event("message_start", message_id=answer.message_id)
    store = _Store(Prepared(turn, prepared.agent, [*messages, note], None))
    response: ModelResponse | None = None
    try:
        async with prepared.agent.iter(
            None,
            message_history=[*messages, note],
            deps=turn,
            instructions=turn.work,
            model_settings=ModelSettings(tool_choice="none"),
            usage_limits=UsageLimits(request_limit=None),
        ) as run:
            async for node in run:
                if Agent.is_model_request_node(node):
                    async with node.stream(run.ctx) as stream:
                        async for item in _race(aiter(stream), cancel):
                            if (delta := _delta(item, answer)) is not None:
                                yield delta
                    if cancel.is_set():
                        await store.partial(answer)
                        yield event("message_end", message_id=answer.message_id, stopped=True)
                        return
                elif Agent.is_call_tools_node(node):
                    response = node.model_response
                    break
    except AppError:
        await asyncio.shield(store.partial(answer))
        raise
    if response is None:
        return
    # A model that calls tools anyway: only its words are kept.
    response.parts = [p for p in response.parts if not isinstance(p, ToolCallPart)]
    await store.answer(response, answer, paused=reason)
    yield event(
        "message_end",
        message_id=answer.message_id,
        input_tokens=response.usage.input_tokens,
        output_tokens=response.usage.output_tokens,
    )
    yield event("paused", message_id=answer.message_id, reason=reason)


async def _propose(
    turn: Turn, messages: Sequence[ModelMessage], requests: DeferredToolRequests
) -> list[Event]:
    """A card for each call that needs the user's decision."""
    owner = {
        p.tool_call_id: _row_id(m) or ""
        for m in messages
        if isinstance(m, ModelResponse)
        for p in m.parts
        if isinstance(p, ToolCallPart)
    }
    async with agent_ctx(turn.state, turn.user_id, scope=turn.scope) as ctx:
        session = await service.get_session_row(ctx, turn.session_id)
        rows: list[AgentProposal] = []
        for call in requests.approvals:
            meta = requests.metadata.get(call.tool_call_id) or {}
            row = AgentProposal(
                user_id=ctx.user_id,
                session_id=session.id,
                message_id=owner.get(call.tool_call_id, ""),
                call_id=call.tool_call_id,
                capability=tools.capability_name(call.tool_name),
                args=history.args_of(call),
                preview=meta.get("preview"),
                status="pending",
                created_at=ctx.now,
            )
            ctx.db.add(row)
            rows.append(row)
        await ctx.db.commit()
        return [
            {"event": "proposal", "data": service.proposal_out(p).model_dump(mode="json")}
            for p in rows
        ]


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

    results: list[tuple[AgentProposal, Outcome, str]] = []
    for d, row in zip(decisions, rows, strict=True):
        cap = cap_by_id[row.id]
        if d.decision == "reject":
            text = REJECTED
            if d.reason:
                text += f" Their reason: {d.reason}"
            results.append(
                (row, Outcome(True, {"rejected": True, "message": text}, ran=False), "rejected")
            )
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
        stored = [history.load(r) for r in await service.messages(ctx, session.id)]
        open_ids = {c.tool_call_id for c in history.open_calls([m for m in stored if m])}
        for row, outcome, status in results:
            fresh = await service.get_proposal(ctx, session.id, row.id)
            fresh.status = status
            fresh.args = row.args
            if row.id in edited_preview:
                fresh.preview = edited_preview[row.id]
            fresh.decided_at = ctx.now
            if status != "rejected":
                fresh.executed_at = ctx.now
            fresh.result = outcome.payload
            fresh.error_code = outcome.error_code
            cap = cap_by_id[row.id]
            part = ToolReturnPart(
                tools.tool_name(row.capability),
                outcome.content,
                tool_call_id=row.call_id,
                metadata={
                    "ok": outcome.ok,
                    "error_code": outcome.error_code,
                    "changed": outcome.ok and outcome.ran and cap.effect != "read",
                    "citations": outcome.citations,
                },
            )
            out += _result_event(row.message_id, part)
            out.append(
                {"event": "proposal", "data": service.proposal_out(fresh).model_dump(mode="json")}
            )
            if row.call_id not in open_ids:
                # The conversation moved on before this decision: the model hears it as a note.
                note = history.late_note(row.capability, outcome.content, not outcome.ok)
                service.add_message(ctx, session, "user", [{"type": "note", "text": note}])
        await ctx.db.flush()
        still_pending = [
            p
            for p in await service.proposals(ctx, session.id)
            if p.message_id in message_ids and p.status == "pending" and p.call_id in open_ids
        ]
        await ctx.db.commit()
    return out, not still_pending


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


def sse(item: Event) -> dict[str, str]:
    return {
        "event": item["event"],
        "data": json.dumps(item["data"], ensure_ascii=False, default=str),
    }
