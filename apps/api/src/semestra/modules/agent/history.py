"""The stored transcript → the provider-neutral messages the model sees (M12 §3.1).

Every tool call needs a result right after it. A call still waiting for the user's decision gets
a placeholder; a result that arrives after the conversation moved on (a proposal decided later)
is told to the model as a note at the point where it happened.
"""

import json
from collections.abc import Awaitable, Callable, Sequence
from typing import Any

from semestra.modules.agent.models import AgentAttachment, AgentMessage
from semestra.modules.ai import (
    Document,
    Image,
    Message,
    Reasoning,
    Text,
    ToolCall,
    ToolResult,
    wrap_untrusted,
)

PENDING = "Waiting for the user's decision on the confirmation card; not executed yet."
EXPIRED = "The confirmation card expired without a decision; the action was not executed."
CHARS_PER_TOKEN = 4
IMAGE_TOKENS = 1_200
TEXT_ATTACHMENT_LIMIT = 60_000

LoadAttachment = Callable[[AgentAttachment], Awaitable[bytes]]


def _call_results(
    rows: Sequence[AgentMessage], start: int
) -> tuple[dict[str, dict[str, Any]], int]:
    """Tool results in the rows directly after `start`; returns them and the next index."""
    results: dict[str, dict[str, Any]] = {}
    i = start
    while i < len(rows) and rows[i].role == "tool":
        for block in rows[i].content:
            if block.get("type") == "tool_result":
                results[block["call_id"]] = block
        i += 1
    return results, i


def _late_note(block: dict[str, Any]) -> Text:
    return Text(
        f"[Update on the earlier `{block['name']}` call] "
        + ("It failed: " if block.get("is_error") else "Result: ")
        + str(block.get("content", ""))
    )


async def _user_parts(
    row: AgentMessage,
    attachments: dict[str, AgentAttachment],
    load: LoadAttachment,
    reads_pdf: bool,
) -> list[Any]:
    parts: list[Any] = []
    for block in row.content:
        kind = block.get("type")
        if kind == "text" and block.get("text"):
            parts.append(Text(block["text"]))
        elif kind == "skill":
            parts.append(
                Text(f"[The user chose the skill `{block['name']}`]\n\n{block.get('body', '')}")
            )
        elif kind == "note":
            parts.append(Text(f"[Note] {block.get('text', '')}"))
        elif kind in ("image_ref", "file_ref"):
            att = attachments.get(block.get("attachment_id", ""))
            if att is None:
                parts.append(Text(f"[Attachment {block.get('name', '')} is no longer available]"))
                continue
            if att.mime == "application/pdf" and not reads_pdf:
                # No renderer yet for providers without PDF input: say so instead of failing
                # the whole turn, so the model can ask for text or a screenshot.
                parts.append(Text(f"[PDF {att.name} cannot be read by the current model]"))
                continue
            data = await load(att)
            if att.kind == "image":
                parts.append(Image(data, att.mime))
            elif att.mime == "application/pdf":
                parts.append(Document(data))
            else:
                text = data.decode("utf-8", errors="replace")[:TEXT_ATTACHMENT_LIMIT]
                parts.append(Text(wrap_untrusted(text, att.name)))
    return parts


async def build(
    rows: Sequence[AgentMessage],
    *,
    proposal_status: dict[str, str],
    attachments: dict[str, AgentAttachment],
    load: LoadAttachment,
    reads_pdf: bool = True,
    summary: str | None = None,
) -> list[Message]:
    out: list[Message] = []
    if summary:
        out.append(Message.user(f"[Summary of the earlier conversation]\n{summary}"))
    i = 0
    while i < len(rows):
        row = rows[i]
        if row.role == "user":
            parts = await _user_parts(row, attachments, load, reads_pdf)
            if parts:
                out.append(Message("user", parts))
            i += 1
        elif row.role == "assistant":
            calls = [b for b in row.content if b.get("type") == "tool_call"]
            text = "".join(b.get("text", "") for b in row.content if b.get("type") == "text")
            parts: list[Any] = [_reasoning(b) for b in row.content if b.get("type") == "reasoning"]
            # Reasoning alone is not a message (M06 drops it for other models).
            parts += [Text(text)] if text else []
            parts += [ToolCall(c["id"], c["name"], c.get("args") or {}) for c in calls]
            if text or calls:
                out.append(Message("assistant", parts))
            results, i = _call_results(rows, i + 1)
            call_ids = {c["id"] for c in calls}
            tool_parts: list[Any] = []
            for call in calls:
                block = results.get(call["id"])
                if block is not None:
                    tool_parts.append(
                        ToolResult(
                            call["id"], call["name"], block["content"], bool(block.get("is_error"))
                        )
                    )
                else:
                    status = proposal_status.get(call["id"])
                    tool_parts.append(
                        ToolResult(
                            call["id"], call["name"], EXPIRED if status == "expired" else PENDING
                        )
                    )
            if tool_parts:
                out.append(Message("tool", tool_parts))
            late = [b for cid, b in results.items() if cid not in call_ids]
            if late:
                out.append(Message("user", [_late_note(b) for b in late]))
        else:  # a result for an assistant message further back
            late = [b for b in row.content if b.get("type") == "tool_result"]
            if late:
                out.append(Message("user", [_late_note(b) for b in late]))
            i += 1
    return out


def _reasoning(block: dict[str, Any]) -> Reasoning:
    return Reasoning(
        str(block.get("source", "")),
        str(block.get("content") or ""),
        id=block.get("id"),
        signature=block.get("signature"),
        provider_name=block.get("provider_name"),
        details=block.get("details"),
    )


def estimate_tokens(messages: Sequence[Message]) -> int:
    chars, images = 0, 0
    for msg in messages:
        for part in msg.content:
            if isinstance(part, Text):
                chars += len(part.text)
            elif isinstance(part, ToolResult):
                chars += len(part.content)
            elif isinstance(part, ToolCall):
                chars += len(json.dumps(part.arguments)) + len(part.name)
            elif isinstance(part, Image | Document):
                images += 1
    return chars // CHARS_PER_TOKEN + images * IMAGE_TOKENS


def compaction_cut(rows: Sequence[AgentMessage], keep_user_turns: int = 2) -> int | None:
    """Index of the first row to keep when compacting: the start of the last `keep_user_turns`
    user turns. None when there is nothing older to summarize."""
    starts = [
        i
        for i, r in enumerate(rows)
        if r.role == "user" and any(b.get("type") != "note" for b in r.content)
    ]
    if len(starts) <= keep_user_turns:
        return None
    return starts[-keep_user_turns]


def transcript_text(rows: Sequence[AgentMessage]) -> str:
    """Plain text of rows for the summarizer (attachments and tool payloads abbreviated)."""
    lines: list[str] = []
    for row in rows:
        for block in row.content:
            kind = block.get("type")
            if kind == "text" and block.get("text"):
                lines.append(f"{row.role}: {block['text']}")
            elif kind == "tool_call":
                lines.append(
                    f"assistant called {block['name']}({json.dumps(block.get('args'))[:300]})"
                )
            elif kind == "tool_result":
                lines.append(f"tool {block['name']}: {str(block.get('content', ''))[:500]}")
            elif kind in ("image_ref", "file_ref"):
                lines.append(f"{row.role} attached {block.get('name', 'a file')}")
    return "\n".join(lines)
