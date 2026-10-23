"""Compaction (M12 §3.4): when a request would fill more than `COMPACT_RATIO` of the context
window, the turns before the last `KEEP_USER_TURNS` are summarized by the small model. Only the
request changes; the stored history stays as it is. The summary is kept in the session and
reused until the next compaction."""

from typing import TYPE_CHECKING

from pydantic_ai.messages import ModelMessage

from semestra.core.errors import AppError
from semestra.modules.agent import history
from semestra.modules.agent.runtime import agent_ctx
from semestra.modules.ai import Message

if TYPE_CHECKING:
    from semestra.modules.agent.turn import Turn

COMPACT_RATIO = 0.7
KEEP_USER_TURNS = 2

SUMMARY_PROMPT = (
    "Summarize this conversation between a student and their study assistant for the "
    "assistant's own memory: decisions, facts, ids and numbers that later turns may need. "
    "At most 300 words."
)


async def compact(turn: Turn, messages: list[ModelMessage]) -> list[ModelMessage]:
    memo, rows = turn.memo, turn.rows
    until = memo.get("summarized_until")
    if memo.get("summary") and until:
        at = next((i for i, m in enumerate(messages) if rows.holds(m, until)), None)
        if at is not None:
            summary = history.summary_request(memo["summary"], list(memo.get("revealed", [])))
            messages = [summary, *messages[at + 1 :]]
    if history.prompt_tokens(messages) <= COMPACT_RATIO * turn.model.context_window:
        return messages
    starts = [i for i, m in enumerate(messages) if rows.typed(m)]
    if len(starts) <= KEEP_USER_TURNS:
        return messages
    cut = starts[-KEEP_USER_TURNS]
    older = messages[:cut]
    last = next((r for r in map(rows.row_id, reversed(older)) if r), None)
    if last is None:
        return messages
    prior = memo.get("summary") if until else None
    text = history.transcript_text([m for m in older if rows.row_id(m)])
    try:
        async with agent_ctx(turn.state, turn.user_id, scope=None) as ctx:
            summary = await turn.state.agent.small_complete(
                ctx,
                [
                    Message.system(SUMMARY_PROMPT),
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
