"""Neutral messages (`llm.py`) ⇄ Pydantic AI messages, and request options per provider kind."""

import json
from collections.abc import Sequence
from typing import Any, cast

from pydantic_ai.messages import (
    BinaryContent,
    ModelMessage,
    ModelRequest,
    ModelRequestPart,
    ModelResponse,
    ModelResponsePart,
    SystemPromptPart,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
    UserContent,
    UserPromptPart,
)
from pydantic_ai.models import Model, ModelRequestParameters
from pydantic_ai.output import OutputObjectDefinition
from pydantic_ai.settings import ModelSettings
from pydantic_ai.tools import ToolDefinition
from pydantic_ai.usage import RequestUsage

from semestra.modules.ai.adapters.base import DEFAULT_MAX_TOKENS, ChatRequest, json_instruction
from semestra.modules.ai.adapters.sdk import ANTHROPIC_KINDS, REASONING_KINDS
from semestra.modules.ai.llm import (
    Completion,
    Document,
    Image,
    Message,
    StopReason,
    Text,
    ToolCall,
    ToolResult,
    Usage,
)


def _user_content(parts: Sequence[object]) -> list[UserContent]:
    out: list[UserContent] = []
    for part in parts:
        match part:
            case Text(text=text):
                out.append(text)
            case Image(data=data, mime=mime) | Document(data=data, mime=mime):
                out.append(BinaryContent(data=data, media_type=mime))
            case _:
                raise TypeError(f"unsupported part {type(part).__name__}")
    return out


def _system(req: ChatRequest) -> str:
    system = "\n\n".join(
        part.text
        for msg in req.messages
        if msg.role == "system"
        for part in msg.content
        if isinstance(part, Text)
    )
    if req.json_schema is not None and req.json_mode_fallback:
        system = f"{system}\n\n{json_instruction(req.json_schema)}".strip()
    return system


def to_messages(req: ChatRequest) -> list[ModelMessage]:
    """Neutral messages → Pydantic AI requests and responses. System text goes first; consecutive
    turns of the same side are merged (tool results and the user's next words are one request)."""
    out: list[ModelMessage] = []
    requests: list[ModelRequestPart] = []
    responses: list[ModelResponsePart] = []
    if system := _system(req):
        requests.append(SystemPromptPart(system))

    def flush_requests() -> None:
        if requests:
            out.append(ModelRequest(parts=list(requests)))
            requests.clear()

    def flush_responses() -> None:
        if responses:
            out.append(ModelResponse(parts=list(responses)))
            responses.clear()

    for msg in _non_system(req.messages):
        if msg.role == "assistant":
            flush_requests()
            for part in msg.content:
                if isinstance(part, Text):
                    responses.append(TextPart(part.text))
                elif isinstance(part, ToolCall):
                    responses.append(ToolCallPart(part.name, part.arguments, tool_call_id=part.id))
            continue
        flush_responses()
        requests.extend(
            ToolReturnPart(
                p.name,
                p.content,
                tool_call_id=p.call_id,
                outcome="failed" if p.is_error else "success",
            )
            for p in msg.content
            if isinstance(p, ToolResult)
        )
        if rest := [p for p in msg.content if not isinstance(p, ToolResult)]:
            requests.append(UserPromptPart(_user_content(rest)))
    flush_responses()
    flush_requests()
    return out


def _non_system(messages: list[Message]) -> list[Message]:
    return [m for m in messages if m.role != "system"]


def _native_output(kind: str, model: Model) -> bool:
    """Structured output in the API's JSON schema mode. Anthropic models without it (older Claude,
    most compatible endpoints) get a forced tool call whose input is the result instead."""
    return kind not in ANTHROPIC_KINDS or bool(model.profile.get("supports_json_schema_output"))


def parameters(kind: str, model: Model, req: ChatRequest) -> ModelRequestParameters:
    tools = [
        ToolDefinition(
            name=t.name, description=t.description, parameters_json_schema=t.input_schema
        )
        for t in req.tools
    ]
    if req.json_schema is None or req.json_mode_fallback:
        return ModelRequestParameters(function_tools=tools)
    if _native_output(kind, model):
        return ModelRequestParameters(
            function_tools=tools,
            output_mode="native",
            output_object=OutputObjectDefinition(
                json_schema=req.json_schema,
                name=req.schema_name,
                # Claude's JSON mode is always strict (Pydantic AI adapts the schema to it).
                strict=None if kind in ANTHROPIC_KINDS else False,
            ),
        )
    return ModelRequestParameters(
        function_tools=tools,
        output_mode="tool",
        output_tools=[
            ToolDefinition(
                name=req.schema_name,
                description="Record the result. Call this exactly once.",
                parameters_json_schema=req.json_schema,
                kind="output",
            )
        ],
        allow_text_output=False,
    )


def settings(kind: str, req: ChatRequest) -> ModelSettings:
    out: dict[str, Any] = {}
    max_tokens = req.params.max_tokens
    if max_tokens is None and kind in ANTHROPIC_KINDS:
        max_tokens = DEFAULT_MAX_TOKENS  # the Messages API requires it
    if max_tokens is None and kind == "gemini":
        max_tokens = DEFAULT_MAX_TOKENS * 2  # thinking tokens count against it
    if max_tokens is not None:
        out["max_tokens"] = max_tokens
    if req.params.temperature is not None:
        out["temperature"] = req.params.temperature
    if req.params.reasoning_effort is not None and kind in REASONING_KINDS:
        out["openai_reasoning_effort"] = req.params.reasoning_effort
    if kind == "openai_responses":
        out["openai_store"] = False  # the whole conversation is sent every time
    return cast(ModelSettings, out)


def usage(raw: RequestUsage) -> Usage:
    """Input tokens include cached ones (Pydantic AI already adds cache reads and writes)."""
    return Usage(
        input_tokens=raw.input_tokens,
        output_tokens=raw.output_tokens,
        cached_tokens=raw.cache_read_tokens or None,
    )


_STOP: dict[str, StopReason] = {"stop": "end", "length": "max_tokens", "tool_call": "tool_use"}


def tool_calls(response: ModelResponse) -> list[ToolCall]:
    return [
        ToolCall(part.tool_call_id, part.tool_name, part.args_as_dict())
        for part in response.parts
        if isinstance(part, ToolCallPart)
    ]


def completion(response: ModelResponse, req: ChatRequest) -> Completion:
    text = "".join(part.content for part in response.parts if isinstance(part, TextPart))
    calls = tool_calls(response)
    stop = _STOP.get(response.finish_reason or "stop", "other")
    if req.json_schema is not None and not req.json_mode_fallback:
        # A forced output tool call carries the structured result.
        result = next((c.arguments for c in calls if c.name == req.schema_name), None)
        if result is not None:
            text, calls, stop = json.dumps(result), [], "end"
    if calls:
        stop = "tool_use"
    return Completion(
        text=text,
        tool_calls=calls,
        stop_reason=stop,
        usage=usage(response.usage),
        model=response.model_name or req.model,
    )
