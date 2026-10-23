"""Storing a run as it goes (M12 §3.1): each model response, each batch of tool results and
what was streamed before a stop, as transcript rows; and the events the chat gets for them."""

import json
import time
from collections.abc import Sequence
from dataclasses import asdict, dataclass, field, replace
from typing import TYPE_CHECKING, Any

from pydantic_ai.messages import (
    SYNTHESIZED_TOOL_RETURN_METADATA_KEY,
    ModelMessage,
    ModelRequest,
    ModelResponse,
    RetryPromptPart,
    TextPart,
    ThinkingPart,
    ToolAvailabilityDeltaPart,
    ToolCallPart,
    ToolReturnPart,
)

from semestra.modules.agent import history, service
from semestra.modules.agent.models import AgentSession
from semestra.modules.agent.runtime import agent_ctx

if TYPE_CHECKING:
    from semestra.modules.agent.turn import Turn

Event = dict[str, Any]


def event(name: str, /, **data: Any) -> Event:
    return {"event": name, "data": data}


def sse(item: Event) -> dict[str, str]:
    return {
        "event": item["event"],
        "data": json.dumps(item["data"], ensure_ascii=False, default=str),
    }


def elapsed_ms(started: float) -> int:
    return round((time.monotonic() - started) * 1000)


@dataclass
class Answer:
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
            return elapsed_ms(self.started)
        return self.thinking_ms


def save_state(session: AgentSession, turn: Turn) -> None:
    session.state = {**turn.memo, "turn": asdict(turn.counters)}


class Store:
    """Writes the run's messages as they complete. Tool results are told apart by the part object,
    not by position: Pydantic AI merges every run of consecutive requests in the history (a tool
    row followed by a note, say), so indexes into the stored history do not hold, while the merge
    keeps the part objects. Not by call id either: some OpenAI-compatible servers reuse ids across
    turns."""

    def __init__(self, turn: Turn, messages: Sequence[ModelMessage]) -> None:
        self.turn = turn
        # `id()` of every result part already stored; the parts stay alive in the run's history.
        self.answered: set[int] = {
            id(p)
            for m in messages
            if isinstance(m, ModelRequest)
            for p in m.parts
            if isinstance(p, ToolReturnPart | RetryPromptPart)
        }

    async def answer(
        self, response: ModelResponse, answer: Answer, *, paused: str | None = None
    ) -> None:
        """An assistant row with the id announced in `message_start`."""
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
            save_state(session, self.turn)
            await ctx.db.commit()

    async def partial(self, answer: Answer) -> None:
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
            {"type": "timing", "thinking_ms": answer.thinking_ms or elapsed_ms(answer.started)}
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
            save_state(session, self.turn)
            await ctx.db.commit()

    def _new_results(self, message: ModelRequest) -> list[ToolReturnPart | RetryPromptPart]:
        """Results in `message` not stored yet. Returns Pydantic AI made up for calls an earlier
        interruption left unanswered are not stored: it makes them again on every run."""
        return [
            p
            for p in message.parts
            if isinstance(p, ToolReturnPart | RetryPromptPart)
            and id(p) not in self.answered
            and not (
                isinstance(p, ToolReturnPart)
                and isinstance(p.metadata, dict)
                and p.metadata.get(SYNTHESIZED_TOOL_RETURN_METADATA_KEY)
            )
        ]

    async def sync(self, messages: Sequence[ModelMessage]) -> None:
        """New tool results become tool rows."""
        new = [
            (m, parts)
            for m in messages
            if isinstance(m, ModelRequest) and (parts := self._new_results(m))
        ]
        if not new:
            return
        async with agent_ctx(self.turn.state, self.turn.user_id, scope=None) as ctx:
            session = await service.get_session_row(ctx, self.turn.session_id)
            for m, parts in new:
                self.answered.update(id(p) for p in parts)
                kept = [*parts, *reveals(m, parts)]
                request = replace(m, parts=kept) if len(kept) != len(m.parts) else m
                blocks = history.request_blocks(request)
                history.strip_full(request)
                row = service.add_message(
                    ctx, session, "tool", blocks, model_parts=history.dump(request)
                )
                self.turn.rows.mark(request, row.id)
            save_state(session, self.turn)
            await ctx.db.commit()


def reveals(
    message: ModelRequest, results: Sequence[ToolReturnPart | RetryPromptPart]
) -> list[ToolAvailabilityDeltaPart]:
    """The tools these results revealed (a loaded skill's, say). Pydantic AI keeps them next to
    the result in the same request; without them a history loaded back from the rows no longer
    shows those tools and refuses calls to them."""
    ids = {r.tool_call_id for r in results}
    return [
        p
        for p in message.parts
        if isinstance(p, ToolAvailabilityDeltaPart) and p.tool_call_id in ids
    ]


def result_event(message_id: str, part: ToolReturnPart | RetryPromptPart) -> list[Event]:
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
            **({"display": block["display"]} if "display" in block else {}),
        )
    ]
    meta = part.metadata if isinstance(part, ToolReturnPart) else None
    if isinstance(meta, dict):
        out += [event("citation", **c) for c in meta.get("citations", [])]
    return out
