"""The assistant's turn loop (M12 §3.1) on a Pydantic AI `Agent` (see the spec's 实现说明).

    history → model → tool calls? → read: run now (≤ 4 at a time)
                                    write: auto-approved → run, else a proposal: the run ends
                                           with `DeferredToolRequests` and waits for the user
            → model → … → answer

Deciding the proposals (`decisions.decide`) resumes the run with `DeferredToolResults`. Every
message is stored as soon as it is complete (`store.Store`), so a stopped or failed turn keeps
what was said. Each step opens its own short database session; the model streams outside any
transaction.

Per user message the model gets `TOOL_CALL_LIMIT` tool calls and `REQUEST_LIMIT` requests,
counted across approvals. At the limit, or when it repeats one call `REPEAT_PAUSE` times, the
extra calls are not run, the model answers once more without tools (what is done, what is left)
and the turn pauses: the user can press Continue (`decisions.continue_turn`).
"""

import asyncio
from collections.abc import AsyncIterator, Awaitable, Sequence
from dataclasses import dataclass, replace
from typing import Any

import structlog
from pydantic_ai import Agent, AgentRun, RunContext, ToolReturn
from pydantic_ai.capabilities import AbstractCapability, Caching, ToolSearch
from pydantic_ai.capabilities import Capability as Bundle
from pydantic_ai.exceptions import ApprovalRequired, SkipToolExecution, UnexpectedModelBehavior
from pydantic_ai.messages import (
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    InstructionPart,
    ModelMessage,
    ModelRequest,
    ModelResponse,
    PartDeltaEvent,
    PartStartEvent,
    TextPart,
    TextPartDelta,
    ThinkingPart,
    ThinkingPartDelta,
    ToolAvailabilityDeltaPart,
    ToolCallPart,
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

from semestra.core.capability import Capability, registry
from semestra.core.context import Ctx, run_after_commit
from semestra.core.db import new_id
from semestra.core.errors import AppError
from semestra.core.events import events
from semestra.modules.agent import history, memory, outcome, service, skills, tools
from semestra.modules.agent.compaction import compact, compact_now
from semestra.modules.agent.context import STATIC_PROMPT, sent_note, work_context
from semestra.modules.agent.decisions import close_calls, edited, make_preview
from semestra.modules.agent.models import AgentMessage, AgentProposal, AgentSession
from semestra.modules.agent.outcome import Outcome
from semestra.modules.agent.runtime import ChatLike, agent_ctx
from semestra.modules.agent.store import (
    Answer,
    Event,
    Store,
    elapsed_ms,
    event,
    result_event,
    save_state,
    sse,
)
from semestra.modules.agent.turn import Counters, Rows, Turn
from semestra.modules.ai import Message, wrap_untrusted

log = structlog.get_logger()

TOOL_CALL_LIMIT = 30
REQUEST_LIMIT = 50
REPEAT_BLOCK = 3  # the same call with the same arguments this many times in a row: not run
REPEAT_PAUSE = 5  # ... this many times: the turn pauses as at the limit
TOOL_RETRIES = 5  # unknown tools and bad search arguments, per tool and run
TITLE_MAX_CHARS = 20

PAUSE_NOTES: dict[str, str] = {
    "tool_limit": (
        "You reached the limit of tool calls or model requests for this message, so the turn "
        "was paused. Calls whose result is agent.tool_limit_reached were not run; every other "
        "result above is what really happened. Do not call tools now. Going only by those "
        "results, tell the user in a few sentences what is saved (changes that succeeded), what "
        "is still a draft or not done, and what you are unsure of. They can press Continue to "
        "let you go on."
    ),
    "loop": (
        "You repeated the same tool call several times without progress, so the turn was paused. "
        "Calls whose result is agent.repeated_call were not run; every other result above is "
        "what really happened. Do not call tools now. Going only by those results, tell the user "
        "in a few sentences what is saved, what is left and what went wrong. They can press "
        "Continue to let you try again."
    ),
}


# --- the tools ------------------------------------------------------------------------------


def _tool_return(cap: Capability | None, call_id: str, result: Outcome, turn: Turn) -> ToolReturn:
    """The model gets the result as JSON (cut at `RESULT_LIMIT`, wrapped when it quotes other
    people's text); the UI's fields ride along in the metadata, which the model never sees."""
    name = cap.name if cap is not None else ""
    text = result.content
    shown = tools.page(text, call_id)
    meta = outcome.result_meta(cap, result)
    if shown != text:
        meta["full"] = text
        turn.full[call_id] = (name, text)
    if result.ok and result.ran and name in memory.WRITES and isinstance(result.payload, dict):
        # The chat shows "Remembered: …" with an undo link that deletes the memory this call
        # created, "Updated memory: …" with one that puts back what it replaced, or "Forgot: …".
        # A call that changed nothing shows nothing (an undo would touch an older memory).
        saved: dict[str, Any] = result.payload  # pyright: ignore[reportUnknownVariableType]
        about = {"id": saved["id"], "name": saved["name"], "description": saved["description"]}
        if name == memory.FORGET:
            meta["memory"] = {**about, "action": "forgot"}
        elif saved.get("created"):
            meta["memory"] = {**about, "action": "remembered"}
        elif saved.get("previous"):
            before: dict[str, Any] = saved["previous"]
            previous = {k: before[k] for k in ("name", "type", "description", "body")}
            meta["memory"] = {**about, "action": "updated", "previous": previous}
    if result.ok and tools.is_untrusted(name):
        shown = wrap_untrusted(shown, tools.tool_name(name))
    return ToolReturn(return_value=shown, metadata=meta)


STOPPED = "agent.stopped"


class _Stopped(Exception):
    """Stop pressed before the model request was sent (during compaction)."""


async def _unless_stopped(turn: Turn, work: Awaitable[Outcome]) -> Outcome:
    """A read gives up when the user presses Stop; it changed nothing, so nothing is lost."""
    task = asyncio.ensure_future(work)
    stop = asyncio.ensure_future(turn.cancel.wait())
    try:
        await asyncio.wait({task, stop}, return_when=asyncio.FIRST_COMPLETED)
    finally:
        stop.cancel()
    if task.done():
        return task.result()
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
    return outcome.error(STOPPED, ran=False)


def _tool(cap: Capability) -> tools.ToolFunction:
    async def run(ctx: RunContext[Turn], **args: Any) -> ToolReturn:
        turn, call_id = ctx.deps, ctx.tool_call_id or ""
        if ctx.tool_call_approved:
            # Approved cards ran when the user decided (`decide`); the run only collects them.
            result = turn.decided.get(call_id) or outcome.error("agent.interrupted")
            if call_id in turn.edited:
                # The call in the history keeps the model's arguments: say what actually ran.
                result = replace(
                    result,
                    payload={
                        "note": "The user changed the arguments on the card; it ran with these.",
                        "arguments": turn.edited[call_id],
                        "result": result.payload,
                    },
                )
        elif turn.cancel.is_set():
            # Stopped before this call started: it does not run (a write least of all).
            result = outcome.error(STOPPED, ran=False)
        elif cap.effect == "read":
            async with turn.sem:
                work = outcome.invoke(turn.state, turn.user_id, turn.scope, cap.name, args)
                result = await _unless_stopped(turn, work)
        else:
            token = memory.conversation.set(turn.session_id)
            try:
                result = await outcome.invoke(turn.state, turn.user_id, turn.scope, cap.name, args)
            finally:
                memory.conversation.reset(token)
        return _tool_return(cap, call_id, result, turn)

    return run


async def _read_result(ctx: RunContext[Turn], call_id: str, offset: int) -> str:
    turn = ctx.deps
    found = turn.full.get(call_id)
    if found is None:
        async with agent_ctx(turn.state, turn.user_id, scope=None) as c:
            rows = await service.messages(c, turn.session_id)
        block = next(  # the latest: ids can repeat across answers (`history.open_calls`)
            (
                b
                for r in reversed(rows)
                if r.role == "tool"
                for b in r.content
                if b.get("call_id") == call_id and b.get("full")
            ),
            None,
        )
        if block is not None:
            found = (str(block.get("capability", "")), str(block["full"]))
    if found is None:
        params = {"kind": "call", "id": call_id}
        return tools.serialize({"error": {"code": "common.not_found", "params": params}})
    name, text = found
    shown = tools.page(text, call_id, max(0, offset))
    return wrap_untrusted(shown, tools.tool_name(name)) if tools.is_untrusted(name) else shown


def _skipped(turn: Turn, call: ToolCallPart, code: str, **params: Any) -> SkipToolExecution:
    cap = turn.caps.get(tools.capability_name(call.tool_name))
    result = outcome.error(code, ran=False, **params)
    return SkipToolExecution(_tool_return(cap, call.tool_call_id, result, turn))


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
        if counters.pause == "loop":  # the rest of the batch that repeated itself
            raise _skipped(turn, call, "agent.repeated_call", paused=True)
        if counters.pause is not None:
            left = max(0, TOOL_CALL_LIMIT - counters.tool_calls)
            raise _skipped(turn, call, "agent.tool_limit_reached", limit=TOOL_CALL_LIMIT, left=left)
        counters.tool_calls += 1
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
        if cap.effect == "write" and (cap.name in turn.auto_approve or cap.name in memory.WRITES):
            return args
        try:
            async with agent_ctx(turn.state, turn.user_id, scope=turn.scope) as c:
                # The card keeps the arguments filled in from where the user is now (the
                # Program), so approving it later, from elsewhere, does what it showed.
                filled = await registry.with_context_args(c, cap, args)
                preview = await make_preview(c, cap, filled)
        except AppError as exc:  # wrong arguments go back to the model without a card
            result = Outcome(False, outcome.error_payload(exc), exc.code)
            raise SkipToolExecution(_tool_return(cap, call.tool_call_id, result, turn)) from None
        raise ApprovalRequired(metadata={"preview": preview, "args": filled})

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

    async def after_model_request(
        self,
        ctx: RunContext[Turn],
        *,
        request_context: ModelRequestContext,
        response: ModelResponse,
    ) -> ModelResponse:
        # A batch that does not fit in what is left of the limit runs not at all rather than in
        # part: half a batch done is hard for the model (and the user) to tell apart.
        counters = ctx.deps.counters
        batch = sum(isinstance(p, ToolCallPart) for p in response.parts)
        if counters.pause is None and counters.tool_calls + batch > TOOL_CALL_LIMIT:
            counters.pause = "tool_limit"
        return response

    async def before_model_request(
        self, ctx: RunContext[Turn], request_context: ModelRequestContext
    ) -> ModelRequestContext:
        turn = ctx.deps
        messages = [m for m in (_replayable(m, turn) for m in request_context.messages) if m]
        params = request_context.model_request_parameters
        instructions = (
            InstructionPart.join(params.instruction_parts)
            if params.instruction_parts is not None
            else next(
                (m.instructions for m in reversed(messages) if isinstance(m, ModelRequest)), None
            )
        )
        overhead = history.request_overhead(instructions, params.function_tools)
        request_context.messages = await compact(turn, messages, overhead)
        if turn.cancel.is_set():
            # Stopped while compacting: the turn ends here, before the request goes out.
            raise _Stopped
        if not _defers_tools(request_context.model):
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


def _skill(skill: skills.Skill) -> Bundle[Turn]:
    # The catalog (id and description) is in the instructions; `load_capability` returns the
    # workflow as a tool result, so loading one changes neither the prompt nor the tool list.
    return Bundle(
        id=skill.name,
        description=tools.for_model(skill.description),
        instructions=tools.for_model(skill.body),
        defer_loading=True,
    )


def _agent(
    turn: Turn, available: list[Capability], visible: list[skills.Skill]
) -> Agent[Turn, Any]:
    capabilities: list[AbstractCapability[Turn]] = [_Hooks(), Caching()]
    toolsets = []
    if turn.model.supports_tools:
        toolsets.append(tools.toolset(available, _tool, _read_result))
        capabilities = [
            ToolSearch(
                strategy=tools.search,
                max_results=tools.SEARCH_LIMIT,
                tool_description=tools.SEARCH_DESCRIPTION,
            ),
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
    ctx: Ctx,
    session: AgentSession,
    rows: Sequence[AgentMessage],
    model: ChatLike,
    tz: Any,
    marks: Rows,
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
        if isinstance(msg, ModelResponse):
            msg.metadata = {**(msg.metadata or {}), "row_id": row.id}
        elif msg is not None:
            marks.mark(msg, row.id, typed=history.is_typed(row))
        if msg is not None:
            out.append(msg)
    return out


async def _prepare(
    ctx: Ctx, session: AgentSession, model: ChatLike, cancel: asyncio.Event
) -> Prepared:
    rows = await service.messages(ctx, session.id)
    props = history.open_proposals(rows, await service.proposals(ctx, session.id))
    work = await work_context(ctx, ctx.scope)
    marks = Rows()
    messages = await _messages(ctx, session, rows, model, work.timezone, marks)
    resume: DeferredToolResults | None = None
    changed: dict[str, dict[str, Any]] = {}
    calls = history.open_calls(messages)
    if any(
        props.get(c.tool_call_id) is None or props[c.tool_call_id].status == "pending"
        for c in calls
    ):
        # Not resumable (a card still waits, or the stream was cut before the tools ran):
        # every call gets its result now, so the model can go on.
        request, row_id = close_calls(ctx, session, calls, props)
        marks.mark(request, row_id)
        messages.append(request)
    elif calls:
        resume = DeferredToolResults()
        for c in calls:
            prop = props[c.tool_call_id]
            if prop.status in ("executed", "failed"):
                resume.approvals[c.tool_call_id] = ToolApproved(override_args=prop.args)
                if edited(prop, history.args_of(c)):
                    changed[c.tool_call_id] = prop.args
            else:
                text = outcome.proposal_outcome(prop).content
                resume.approvals[c.tool_call_id] = ToolDenied(text)
        _keep_callable(messages, calls)
    remembered = await memory.snapshot(ctx, session, work.timezone)
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
            p.call_id: outcome.proposal_outcome(p)
            for p in props.values()
            if p.status in ("executed", "failed")
        },
        edited=changed,
        rows=marks,
        cancel=cancel,
    )
    return Prepared(turn, _agent(turn, available, visible), messages, resume)


def _keep_callable(messages: list[ModelMessage], calls: Sequence[ToolCallPart]) -> None:
    """The cards being resumed already ran (`decide`), so their tools must still count as
    shown, or Pydantic AI refuses the calls and the model never sees what they did. A history
    stored before the reveals were kept lacks them: say they were shown just before the calls.
    Only the resumed cards are covered: in such a history the next message or Continue still
    misses the reveals, which costs the model one "not available yet" and a reload, as nothing
    has run."""
    shown = set(history.revealed_tools(messages))
    missing = sorted({c.tool_name for c in calls} - shown)
    at = next(
        (i for i in reversed(range(len(messages))) if isinstance(messages[i], ModelResponse)), 0
    )
    if not missing or not at or not isinstance(before := messages[at - 1], ModelRequest):
        return
    before.parts = [*before.parts, ToolAvailabilityDeltaPart(tools_added=missing)]


# --- one run --------------------------------------------------------------------------------


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


def _delta(item: Any, answer: Answer) -> Event | None:
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
            answer.thinking_ms = elapsed_ms(answer.started)
        return event("text_delta", message_id=answer.message_id, text=text)
    if thought:
        answer.thought += thought
        return event("reasoning_delta", message_id=answer.message_id, text=thought)
    return None


async def generate(
    state: State, user_id: str, session_id: str, cancel: asyncio.Event
) -> AsyncIterator[Event]:
    """Runs the model until it answers, pauses on proposals or at the limit, or is stopped. A
    history ending in decided proposals is resumed first."""
    try:
        async with agent_ctx(state, user_id, scope=None) as ctx:
            session = await service.get_session_row(ctx, session_id)
            if not session.title:
                # Alongside the first answer, not after it: the chat is free as soon as the
                # answer is; the title reaches the list as an event whenever it is ready.
                state.agent.background(
                    _title(state, user_id, session_id), key=f"title:{session_id}"
                )
            ctx.scope = service.scope_ref(session)
            async with state.agent.chat_model(ctx) as model:
                prepared = await _prepare(ctx, session, model, cancel)
                await ctx.db.commit()
                async for item in _run(prepared):
                    yield item
    except AppError as exc:
        yield event("error", code=exc.code, params=exc.params)


async def compact_session(
    state: State, user_id: str, session_id: str, cancel: asyncio.Event, focus: str
) -> AsyncIterator[Event]:
    """Compaction the user asked for: the conversation before their last message is
    summarized now. Its events come from `compaction` (running, done); skipped when there is
    nothing to compact or the user stopped it."""
    async with agent_ctx(state, user_id, scope=None) as ctx:
        session = await service.get_session_row(ctx, session_id)
        ctx.scope = service.scope_ref(session)
        async with state.agent.chat_model(ctx) as model:
            rows = await service.messages(ctx, session.id)
            work = await work_context(ctx, ctx.scope)
            marks = Rows()
            messages = await _messages(ctx, session, rows, model, work.timezone, marks)
            memo = dict(session.state or {})
            await ctx.db.commit()  # no transaction open during the call
            done = await compact_now(
                state, user_id, session_id, cancel, messages, marks, model, memo, focus
            )
    if done == "nothing":
        yield event("compaction", status="skipped")
    if done != "done":
        return  # when stopped, compaction announced it
    async with agent_ctx(state, user_id, scope=None) as ctx:
        session = await service.get_session_row(ctx, session_id)
        keys = ("summary", "summarized_until", "revealed", "cleared_until", "context")
        st = {k: v for k, v in (session.state or {}).items() if k not in keys}
        session.state = {**st, **{k: memo[k] for k in keys if k in memo}}
        await ctx.db.commit()


async def _run(prepared: Prepared) -> AsyncIterator[Event]:
    turn, agent = prepared.turn, prepared.agent
    cancel = turn.cancel
    store = Store(turn, prepared.messages)
    answer: Answer | None = None
    reported = set(prepared.resume.approvals) if prepared.resume else set()
    current: AgentRun[Turn, Any] | None = None
    try:
        async with agent.iter(
            None,
            message_history=prepared.messages,
            deferred_tool_results=prepared.resume,
            deps=turn,
            instructions=turn.work,
            usage_limits=UsageLimits(request_limit=None),
        ) as run:
            current = run
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
                    answer = Answer(new_id())
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
                    message_id = turn.rows.row_id(response) or ""
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
                                for out in result_event(message_id, item.part):
                                    yield out
                    # Stopped while the tools ran: their results sit in the next request,
                    # which the next node stores before it sees the stop.
            else:
                # The run ended: an answer, or proposals waiting for the user.
                await store.sync(run.all_messages())
                output = run.result.output if run.result is not None else None
                if isinstance(output, DeferredToolRequests):
                    for item in await _propose(turn, run.all_messages(), output):
                        yield item
                    return
                return
            messages = run.all_messages()
            pending = node.request if Agent.is_model_request_node(node) else None
        # Paused at the limit: one more answer, without tools.
        history_ = [*messages, *([pending] if pending is not None else [])]
        async for item in _close(prepared, history_):
            yield item
    except _Stopped:
        await _keep(store, answer, current)
        if answer is not None:
            yield event("message_end", message_id=answer.message_id, stopped=True)
    except AppError as exc:
        await _keep(store, answer, current)
        yield event("error", code=exc.code, params=exc.params)
    except UnexpectedModelBehavior as exc:
        log.warning("agent_model_misbehaved", error=type(exc).__name__)
        await _keep(store, answer, current)
        yield event("error", code="ai.output_invalid", params={})
    except asyncio.CancelledError:  # the server is shutting down: keep what was said and done
        await _keep(store, answer, current)
        raise
    except Exception:
        log.exception("agent_run_failed")
        await _keep(store, answer, current)
        yield event("error", code="common.internal", params={})


async def _keep(store: Store, answer: Answer | None, run: AgentRun[Turn, Any] | None) -> None:
    """After a stop or an error: the words streamed so far and the result of every tool that
    finished (Pydantic AI adds them to the run as an interrupted request), so a write that went
    through is never reported as interrupted later."""
    if answer is not None:
        await asyncio.shield(store.partial(answer))
    if run is not None:
        await asyncio.shield(store.sync(run.all_messages()))


async def _close(prepared: Prepared, messages: list[ModelMessage]) -> AsyncIterator[Event]:
    turn = prepared.turn
    cancel = turn.cancel
    reason = turn.counters.pause or "tool_limit"
    async with agent_ctx(turn.state, turn.user_id, scope=None) as ctx:
        session = await service.get_session_row(ctx, turn.session_id)
        row = service.add_message(
            ctx, session, "user", [{"type": "note", "text": PAUSE_NOTES[reason]}]
        )
        save_state(session, turn)
        await ctx.db.commit()
        note = history.note_request(PAUSE_NOTES[reason])
        turn.rows.mark(note, row.id)
    answer = Answer(new_id())
    yield event("message_start", message_id=answer.message_id)
    store = Store(turn, [*messages, note])
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
        p.tool_call_id: turn.rows.row_id(m) or ""
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
                args=meta.get("args") or history.args_of(call),
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


async def _title(state: State, user_id: str, session_id: str) -> None:
    """Names a new conversation from the user's first message, with the small model, whenever it
    arrives: during the turn or after it."""
    async with agent_ctx(state, user_id, scope=None) as ctx:
        rows = await service.messages(ctx, session_id)
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
        if not first:
            return
        language = "Simplified Chinese" if ctx.locale == "zh-CN" else "English"
        await ctx.db.commit()  # no transaction open during the call
        try:
            title = await state.agent.small_complete(
                ctx,
                [
                    Message.system(
                        f"Write a title for this conversation in {language}, at most "
                        f"{TITLE_MAX_CHARS} characters, no quotes, no trailing period. Reply with "
                        "the title only."
                    ),
                    Message.user(f"User: {first[:1000]}"),
                ],
            )
        except AppError:
            title = ""
    title = title.strip().strip("\"'“”").strip()
    if not title:
        title = first.strip().splitlines()[0]
    title = title[:TITLE_MAX_CHARS]
    async with agent_ctx(state, user_id, scope=None) as ctx:
        session = await service.get_session_row(ctx, session_id)
        if session.title:  # renamed by the user meanwhile
            return
        session.title = title
        # A turn still running carries the title to the clients following it; the event tells
        # the rest (and, after the turn, the chat itself) to read the conversation again.
        live = await state.agent.announce(session_id, sse(event("title", title=title)))
        data = {"session_id": session_id, "during_turn": live}
        await events.publish(ctx, "agent.session.updated", data)
        await ctx.db.commit()
        await run_after_commit(ctx)
