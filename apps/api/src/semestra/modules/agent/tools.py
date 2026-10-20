"""Capabilities as the model's tools (M12 §3.2).

Every capability offered to the agent is a Pydantic AI tool. The core set (`agent_core`, at most
`CORE_LIMIT`) is always visible; the rest are deferred and found with Pydantic AI's built-in
`search_tools`, or revealed by loading a skill (`load_capability`). Once found, a tool stays
visible for the rest of the conversation (derived from the history, nothing is stored).

Capability names use dots; tool names replace them with `__` because some providers reject dots.
Text the model reads (descriptions, skills) names tools by their tool name (`for_model`), so the
model never has to translate one into the other.
"""

import json
import re
from collections.abc import Awaitable, Callable
from typing import Any

from pydantic import BaseModel
from pydantic_ai import Tool
from pydantic_ai.toolsets import AbstractToolset, FunctionToolset
from pydantic_ai.toolsets.deferred_loading import DeferredLoadingToolset

from semestra.core.capability import Capability, registry
from semestra.modules.ai.calls import inline_refs

CORE_LIMIT = 20
# Longer results are cut for the model, which can read on with `read_tool_result`.
RESULT_LIMIT = 12_000
READ_RESULT = "read_tool_result"
SEARCH_TOOLS = "search_tools"
LOAD_CAPABILITY = "load_capability"

# Results that quote text other people wrote (the user's files, M07; LMS content, M09):
# wrapped as untrusted content, like attachments, so instructions inside are not the user's.
UNTRUSTED_RESULTS = frozenset(
    {
        "agent.attachment.read",
        "files.document.search",
        "files.document.read",
        "files.document.outline",
        "lms.announcement.list",
        "lms.assignment.list",
        "lms.page.get",
        "lms.syllabus.get",
    }
)

ToolFunction = Callable[..., Awaitable[Any]]


def tool_name(capability: str) -> str:
    return capability.replace(".", "__")


def capability_name(tool: str) -> str:
    return tool.replace("__", ".")


_DOTTED = re.compile(r"(?<![\w.])[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+(?!\w)")


def for_model(text: str) -> str:
    """`text` with every capability name in it written as the tool the model calls."""
    known = {c.name for c in registry.list()}
    return _DOTTED.sub(lambda m: tool_name(m[0]) if m[0] in known else m[0], text)


def description(cap: Capability) -> str:
    return for_model(f"{cap.summary}\n\n{cap.description}".strip())


def core_capabilities(available: list[Capability]) -> list[Capability]:
    return [c for c in available if c.agent_core][:CORE_LIMIT]


def input_schema(cap: Capability) -> dict[str, Any]:
    schema = _descriptions_for_model(inline_refs(cap.input_model.model_json_schema()))
    schema.pop("title", None)
    return schema


def _descriptions_for_model(node: Any) -> Any:
    if isinstance(node, dict):
        return {
            k: for_model(v)
            if k == "description" and isinstance(v, str)
            else _descriptions_for_model(v)
            for k, v in node.items()  # pyright: ignore[reportUnknownVariableType]
        }
    if isinstance(node, list):
        return [_descriptions_for_model(v) for v in node]  # pyright: ignore[reportUnknownVariableType]
    return node


def toolset(
    available: list[Capability],
    run: Callable[[Capability], ToolFunction],
    read_result: ToolFunction,
) -> AbstractToolset[Any]:
    """The core tools first, then the others in a fixed order (deferred), so the tool list is
    the same on every request (prompt caching). Arguments are validated by the capability itself
    (`registry.invoke`), which reports mistakes back to the model as a `common.validation` result.
    Writes run one at a time, after the reads of the same step."""
    core = core_capabilities(available)
    rest = sorted((c for c in available if c not in core), key=lambda c: c.name)
    tools: list[Tool[Any]] = [
        Tool.from_schema(
            run(cap),
            name=tool_name(cap.name),
            description=description(cap),
            json_schema=input_schema(cap),
            takes_ctx=True,
            sequential=cap.effect != "read",
        )
        for cap in [*core, *rest]
    ]
    tools.append(
        Tool.from_schema(
            read_result,
            name=READ_RESULT,
            description="Read more of a tool result that was cut off, from `offset` on.",
            json_schema={
                "type": "object",
                "properties": {
                    "call_id": {"type": "string", "description": "The cut-off call's id."},
                    "offset": {"type": "integer", "minimum": 0},
                },
                "required": ["call_id", "offset"],
            },
            takes_ctx=True,
        )
    )
    deferred = frozenset(tool_name(c.name) for c in rest)
    return DeferredLoadingToolset(FunctionToolset(tools), tool_names=deferred)


def serialize(result: Any) -> str:
    if isinstance(result, BaseModel):
        result = result.model_dump(mode="json")
    return json.dumps(result, ensure_ascii=False, default=str, separators=(",", ":"))


def page(text: str, call_id: str, offset: int = 0) -> str:
    """`RESULT_LIMIT` characters of a result from `offset` on, with a note on how to read on. A
    cut inside a list falls between two of its objects when one ends in the second half of the
    page, so the model does not have to piece an object together from two pages."""
    chunk = text[offset : offset + RESULT_LIMIT]
    if offset + len(chunk) < len(text):
        boundary = chunk.rfind("},{")
        if boundary >= RESULT_LIMIT // 2:
            chunk = chunk[: boundary + 1]
    end = offset + len(chunk)
    if offset == 0 and end >= len(text):
        return chunk
    note = f"\n[characters {offset}-{end} of {len(text)}"
    if end < len(text):
        note += f"; call {READ_RESULT} with call_id {json.dumps(call_id)} and offset {end} for more"
    return chunk + note + "]"


def summarize_args(args: dict[str, Any], limit: int = 160) -> str:
    """A short one-line rendering of tool arguments for the step rows in the UI."""
    text = json.dumps(args, ensure_ascii=False, default=str, separators=(", ", ": "))
    return text if len(text) <= limit else text[: limit - 1] + "…"
