"""The model's view of the transcript (M12 §3.1): Pydantic AI messages.

Assistant and tool rows keep the Pydantic AI message they came from (`model_parts`), so what the
model saw is sent back unchanged. User rows are rendered from their blocks on every request: the
`[Sent …]` note, the text, a chosen skill and attachments (`attachment_content`). The rendering
depends only on the row, so earlier messages read the same on every request (prompt caching).

Every tool call needs a result. A call still waiting for the user's decision when they write
again gets a placeholder (`PENDING`); the real result arrives later as a note.
"""

import json
from collections.abc import Callable, Sequence
from dataclasses import replace
from datetime import datetime
from typing import Any

from pydantic_ai.messages import (
    ModelMessage,
    ModelMessagesTypeAdapter,
    ModelRequest,
    ModelRequestPart,
    ModelResponse,
    RetryPromptPart,
    TextPart,
    ThinkingPart,
    ToolAvailabilityDeltaPart,
    ToolCallPart,
    ToolReturnPart,
    UserContent,
    UserPromptPart,
)
from pydantic_ai.toolsets._tool_search import (  # pyright: ignore[reportPrivateImportUsage]
    discovered_tool_names_in_order,
)

from semestra.core.context import Ctx
from semestra.modules.agent import tools
from semestra.modules.agent.models import AgentAttachment, AgentMessage

PENDING = "Waiting for the user's decision on the confirmation card; not executed yet."
EXPIRED = "The confirmation card expired without a decision; the action was not executed."
CHARS_PER_TOKEN = 4
IMAGE_TOKENS = 1_200


# --- stored messages ------------------------------------------------------------------------


def dump(message: ModelMessage) -> list[dict[str, Any]]:
    """A message for `model_parts`. The instructions are left out: they are sent fresh with
    every request, so keeping a copy per row would only grow the table."""
    if isinstance(message, ModelRequest):
        message = replace(message, instructions=None)
    return ModelMessagesTypeAdapter.dump_python([message], mode="json")


def load(row: AgentMessage) -> ModelMessage | None:
    if not row.model_parts:
        return None
    return ModelMessagesTypeAdapter.validate_python(row.model_parts)[0]


# --- user messages --------------------------------------------------------------------------


async def attachment_content(ctx: Ctx, att: AgentAttachment, *, vision: bool) -> list[UserContent]:
    """What the model gets for one attachment of a user message. Called on every request, so it
    must give the same result each time."""
    from semestra.modules.agent import attachment_context

    return await attachment_context.render(ctx, att, vision=vision)


def is_typed(row: AgentMessage) -> bool:
    """A user row the person wrote (rows of only `note` blocks are added by Semestra)."""
    return row.role == "user" and any(b.get("type") != "note" for b in row.content)


async def user_request(
    ctx: Ctx,
    row: AgentMessage,
    *,
    attachments: dict[str, AgentAttachment],
    stamp: Callable[[datetime], str],
    vision: bool,
) -> ModelRequest | None:
    """`stamp` turns the row's stored time into the `[Sent …]` note put before what the user
    wrote. A chosen skill brings its workflow and reveals its tools."""
    content: list[UserContent] = []
    revealed: list[str] = []
    for block in row.content:
        kind = block.get("type")
        if kind == "text" and block.get("text"):
            content.append(block["text"])
        elif kind == "skill":
            content.append(
                f"[The user chose the skill `{block['name']}`]\n\n{block.get('body', '')}"
            )
            revealed += [tools.tool_name(t) for t in block.get("tools", [])]
        elif kind == "note":
            content.append(f"[Note] {block.get('text', '')}")
        elif kind in ("image_ref", "file_ref"):
            att = attachments.get(block.get("attachment_id", ""))
            if att is None:
                content.append(f"[Attachment {block.get('name', '')} is no longer available]")
            else:
                content += await attachment_content(ctx, att, vision=vision)
    if not content:
        return None
    if is_typed(row):
        content.insert(0, stamp(row.created_at))
    parts: list[ModelRequestPart] = [UserPromptPart(content, timestamp=row.created_at)]
    if revealed:
        parts.append(ToolAvailabilityDeltaPart(tools_added=revealed))
    return ModelRequest(parts=parts, timestamp=row.created_at)


def note_request(text: str) -> ModelRequest:
    return ModelRequest(parts=[UserPromptPart(f"[Note] {text}")])


def late_note(name: str, content: str, is_error: bool) -> str:
    """A result for a call the conversation already moved past (decided after a new message)."""
    return (
        f"[Update on the earlier `{name}` call] "
        + ("It failed: " if is_error else "Result: ")
        + content
    )


# --- what the model called and got -----------------------------------------------------------


def open_calls(messages: Sequence[ModelMessage]) -> list[ToolCallPart]:
    """Tool calls of the last response that have no result yet (proposals waiting at the end)."""
    answered = {
        p.tool_call_id
        for m in messages
        if isinstance(m, ModelRequest)
        for p in m.parts
        if isinstance(p, ToolReturnPart | RetryPromptPart)
    }
    last = next((m for m in reversed(messages) if isinstance(m, ModelResponse)), None)
    if last is None:
        return []
    return [p for p in last.parts if isinstance(p, ToolCallPart) and p.tool_call_id not in answered]


def args_of(part: ToolCallPart) -> dict[str, Any]:
    try:
        return part.args_as_dict(raise_if_invalid=True)
    except ValueError, AssertionError:
        return {}


def response_blocks(response: ModelResponse, thinking_ms: int | None) -> list[dict[str, Any]]:
    """The UI's blocks for an answer: readable reasoning, the text, the tool calls, the time the
    model worked before it started to answer."""
    blocks: list[dict[str, Any]] = []
    text = ""
    for part in response.parts:
        if isinstance(part, ThinkingPart) and part.content:
            blocks.append({"type": "reasoning", "text": part.content})
        elif isinstance(part, TextPart):
            text += part.content
    blocks += [{"type": "text", "text": text}] if text else []
    blocks += [
        {"type": "tool_call", "id": p.tool_call_id, "name": p.tool_name, "args": args_of(p)}
        for p in response.parts
        if isinstance(p, ToolCallPart)
    ]
    blocks += [{"type": "timing", "thinking_ms": thinking_ms}] if thinking_ms is not None else []
    return blocks


def result_block(part: ToolReturnPart | RetryPromptPart) -> dict[str, Any]:
    """The UI's block for one tool result. Our tools put `ok`, `error_code`, `changed` and the
    uncut text (`full`) in the return's metadata, which the model never sees."""
    name = part.tool_name or ""
    if isinstance(part, RetryPromptPart):
        content = part.model_response()
        missing = "Unknown tool" in content or "not available yet" in content
        meta: dict[str, Any] = {
            "ok": False,
            "error_code": "common.not_found" if missing else "common.validation",
        }
    else:
        content = part.model_response_str()
        meta = dict(part.metadata or {}) if isinstance(part.metadata, dict) else {}
    block: dict[str, Any] = {
        "type": "tool_result",
        "call_id": part.tool_call_id,
        "name": name,
        "capability": tools.capability_name(name),
        "content": content,
        "is_error": not meta.get("ok", True),
        "error_code": meta.get("error_code"),
        # Something changed in the user's data: the turn can no longer be regenerated.
        "changed": bool(meta.get("changed")),
    }
    if meta.get("full"):
        block["full"] = meta["full"]
    if meta.get("memory"):
        block["memory"] = meta["memory"]
    if meta.get("display"):
        block["display"] = meta["display"]
    return block


def request_blocks(request: ModelRequest) -> list[dict[str, Any]]:
    """Blocks of a tool row: one result per call, then the files those results quoted."""
    blocks: list[dict[str, Any]] = []
    citations: list[dict[str, Any]] = []
    for part in request.parts:
        if isinstance(part, ToolReturnPart | RetryPromptPart) and part.tool_name:
            blocks.append(result_block(part))
            meta = part.metadata if isinstance(part, ToolReturnPart) else None
            if isinstance(meta, dict):
                citations += [{"type": "citation", **c} for c in meta.get("citations", [])]
    return blocks + citations


def strip_full(request: ModelRequest) -> None:
    """The uncut text lives in the row's blocks only (`read_tool_result` reads it there)."""
    for part in request.parts:
        if isinstance(part, ToolReturnPart) and isinstance(part.metadata, dict):
            part.metadata.pop("full", None)


# --- size and compaction --------------------------------------------------------------------


def estimate_tokens(messages: Sequence[ModelMessage]) -> int:
    chars, images = 0, 0
    for msg in messages:
        for part in msg.parts:
            if isinstance(part, UserPromptPart):
                items = [part.content] if isinstance(part.content, str) else part.content
                for item in items:
                    if isinstance(item, str):
                        chars += len(item)
                    else:
                        images += 1
            elif isinstance(part, TextPart | ThinkingPart):
                chars += len(part.content)
            elif isinstance(part, ToolCallPart):
                chars += len(part.args_as_json_str()) + len(part.tool_name)
            elif isinstance(part, ToolReturnPart | RetryPromptPart):
                chars += len(
                    part.model_response_str()
                    if isinstance(part, ToolReturnPart)
                    else part.model_response()
                )
    return chars // CHARS_PER_TOKEN + images * IMAGE_TOKENS


def prompt_tokens(messages: Sequence[ModelMessage]) -> int:
    """How big a request is: what the provider counted for the last answer (instructions, tools
    and attachments included) plus that answer and an estimate of what came after it. Only
    the estimate before the first answer."""
    for i in range(len(messages) - 1, -1, -1):
        msg = messages[i]
        if isinstance(msg, ModelResponse) and msg.usage.input_tokens:
            return (
                msg.usage.input_tokens
                + msg.usage.output_tokens
                + estimate_tokens(messages[i + 1 :])
            )
    return estimate_tokens(messages)


def transcript_text(messages: Sequence[ModelMessage]) -> str:
    """Plain text of messages for the summarizer (attachments and tool payloads abbreviated)."""
    lines: list[str] = []
    for msg in messages:
        for part in msg.parts:
            if isinstance(part, UserPromptPart):
                items = [part.content] if isinstance(part.content, str) else part.content
                for item in items:
                    lines.append(
                        f"user: {item}" if isinstance(item, str) else "user attached a file"
                    )
            elif isinstance(part, TextPart) and part.content:
                lines.append(f"assistant: {part.content}")
            elif isinstance(part, ToolCallPart):
                lines.append(f"assistant called {part.tool_name}({part.args_as_json_str()[:300]})")
            elif isinstance(part, ToolReturnPart):
                lines.append(f"tool {part.tool_name}: {part.model_response_str()[:500]}")
    return "\n".join(lines)


def revealed_tools(messages: Sequence[ModelMessage]) -> list[str]:
    """Tools that search or a skill revealed in these messages (kept visible after compaction),
    in the order they were found. Pydantic AI's own reading of the history, so it follows the
    library's search strategies and result shapes."""
    return list(discovered_tool_names_in_order(messages))


def summary_request(summary: str, revealed: list[str]) -> ModelRequest:
    parts: list[ModelRequestPart] = [
        UserPromptPart(f"[Summary of the earlier conversation]\n{summary}")
    ]
    if revealed:
        parts.append(ToolAvailabilityDeltaPart(tools_added=revealed))
    return ModelRequest(parts=parts)


def args_json(args: dict[str, Any]) -> str:
    return json.dumps(args, ensure_ascii=False, sort_keys=True, default=str)
