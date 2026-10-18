"""Anthropic Messages API (https://docs.anthropic.com/en/api/messages)."""

import json
from collections.abc import AsyncIterator
from typing import Any

import httpx

from semestra.core.errors import AppError
from semestra.modules.ai.adapters.base import (
    DEFAULT_MAX_TOKENS,
    ChatRequest,
    Endpoint,
    ModelInfo,
    b64,
    join_url,
    open_stream,
    send,
    sse_events,
    system_text,
)
from semestra.modules.ai.llm import (
    Chunk,
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

API_VERSION = "2023-06-01"
_STOP: dict[str, StopReason] = {
    "end_turn": "end",
    "stop_sequence": "end",
    "tool_use": "tool_use",
    "max_tokens": "max_tokens",
}


def _headers(ep: Endpoint) -> dict[str, str]:
    return {"x-api-key": ep.api_key or "", "anthropic-version": API_VERSION}


def _part(part: object) -> dict[str, Any]:
    match part:
        case Text(text=text):
            return {"type": "text", "text": text}
        case Image(data=data, mime=mime):
            return {
                "type": "image",
                "source": {"type": "base64", "media_type": mime, "data": b64(data)},
            }
        case Document(data=data, mime=mime):
            return {
                "type": "document",
                "source": {"type": "base64", "media_type": mime, "data": b64(data)},
            }
        case ToolCall(id=id_, name=name, arguments=args):
            return {"type": "tool_use", "id": id_, "name": name, "input": args}
        case ToolResult(call_id=call_id, content=content, is_error=is_error):
            return {
                "type": "tool_result",
                "tool_use_id": call_id,
                "content": content,
                "is_error": is_error,
            }
        case _:
            raise TypeError(f"unsupported part {type(part).__name__}")


def convert_messages(messages: list[Message]) -> list[dict[str, Any]]:
    """Neutral messages → Anthropic's alternating user/assistant turns (tool results go in a
    user turn; consecutive turns of the same role are merged)."""
    out: list[dict[str, Any]] = []
    for msg in messages:
        if msg.role == "system":
            continue
        role = "assistant" if msg.role == "assistant" else "user"
        parts = [_part(p) for p in msg.content]
        if out and out[-1]["role"] == role:
            out[-1]["content"].extend(parts)
        else:
            out.append({"role": role, "content": parts})
    return out


def build_body(req: ChatRequest) -> dict[str, Any]:
    body: dict[str, Any] = {
        "model": req.model,
        "max_tokens": req.params.max_tokens or DEFAULT_MAX_TOKENS,
        "messages": convert_messages(req.messages),
    }
    if system := system_text(req.messages):
        body["system"] = system
    if req.params.temperature is not None:
        body["temperature"] = req.params.temperature
    tools = [
        {"name": t.name, "description": t.description, "input_schema": t.input_schema}
        for t in req.tools
    ]
    if req.json_schema is not None:
        # Structured output = one forced tool call whose input is the result.
        tools = [
            {
                "name": req.schema_name,
                "description": "Record the result. Call this exactly once.",
                "input_schema": req.json_schema,
            }
        ]
        body["tool_choice"] = {"type": "tool", "name": req.schema_name}
    if tools:
        body["tools"] = tools
    return body


def _usage(raw: dict[str, Any]) -> Usage:
    cached = int(raw.get("cache_read_input_tokens") or 0)
    created = int(raw.get("cache_creation_input_tokens") or 0)
    return Usage(
        input_tokens=int(raw.get("input_tokens") or 0) + cached + created,
        output_tokens=int(raw.get("output_tokens") or 0),
        cached_tokens=cached or None,
    )


def _completion(data: dict[str, Any], req: ChatRequest) -> Completion:
    texts: list[str] = []
    calls: list[ToolCall] = []
    for block in data.get("content") or []:
        if block.get("type") == "text":
            texts.append(block.get("text", ""))
        elif block.get("type") == "tool_use":
            calls.append(ToolCall(block["id"], block["name"], block.get("input") or {}))
    if req.json_schema is not None:
        # The forced tool call carries the structured result.
        result = next((c.arguments for c in calls if c.name == req.schema_name), None)
        return Completion(
            text=json.dumps(result) if result is not None else "".join(texts),
            stop_reason=_STOP.get(data.get("stop_reason") or "", "other"),
            usage=_usage(data.get("usage") or {}),
            model=data.get("model") or req.model,
        )
    return Completion(
        text="".join(texts),
        tool_calls=calls,
        stop_reason=_STOP.get(data.get("stop_reason") or "", "other"),
        usage=_usage(data.get("usage") or {}),
        model=data.get("model") or req.model,
    )


class AnthropicAdapter:
    async def complete(
        self, client: httpx.AsyncClient, ep: Endpoint, req: ChatRequest
    ) -> Completion:
        data = await send(
            client,
            "POST",
            join_url(ep.base_url, "/v1/messages"),
            headers=_headers(ep),
            json_body=build_body(req),
            model=req.model,
        )
        return _completion(data, req)

    async def stream(
        self, client: httpx.AsyncClient, ep: Endpoint, req: ChatRequest
    ) -> AsyncIterator[Chunk]:
        body = {**build_body(req), "stream": True}
        texts: list[str] = []
        calls: list[ToolCall] = []
        open_calls: dict[int, dict[str, Any]] = {}
        usage = Usage()
        stop: StopReason = "other"
        model = req.model
        async with open_stream(
            client,
            join_url(ep.base_url, "/v1/messages"),
            headers=_headers(ep),
            json_body=body,
            model=req.model,
        ) as response:
            async for event in sse_events(response):
                kind = event.get("type")
                if kind == "message_start":
                    message = event.get("message") or {}
                    model = message.get("model") or model
                    usage = _usage(message.get("usage") or {})
                elif kind == "content_block_start":
                    block = event.get("content_block") or {}
                    if block.get("type") == "tool_use":
                        open_calls[event["index"]] = {
                            "id": block["id"],
                            "name": block["name"],
                            "json": "",
                        }
                elif kind == "content_block_delta":
                    delta = event.get("delta") or {}
                    if delta.get("type") == "text_delta":
                        texts.append(delta.get("text", ""))
                        yield Chunk(text=delta.get("text", ""))
                    elif delta.get("type") == "input_json_delta" and event["index"] in open_calls:
                        open_calls[event["index"]]["json"] += delta.get("partial_json", "")
                elif kind == "content_block_stop" and event.get("index") in open_calls:
                    raw = open_calls.pop(event["index"])
                    call = ToolCall(raw["id"], raw["name"], json.loads(raw["json"] or "{}"))
                    calls.append(call)
                    yield Chunk(tool_call=call)
                elif kind == "message_delta":
                    stop = _STOP.get((event.get("delta") or {}).get("stop_reason") or "", "other")
                    usage.output_tokens = int((event.get("usage") or {}).get("output_tokens") or 0)
                elif kind == "error":
                    error_type = (event.get("error") or {}).get("type", "")
                    if error_type == "rate_limit_error":
                        raise AppError("ai.rate_limited", 429)
                    raise AppError("ai.provider_unreachable", 502)
        yield Chunk(
            done=Completion(
                text="".join(texts), tool_calls=calls, stop_reason=stop, usage=usage, model=model
            )
        )

    async def embed(
        self, client: httpx.AsyncClient, ep: Endpoint, model: str, texts: list[str]
    ) -> tuple[list[list[float]], Usage]:
        raise AppError("ai.capability_unsupported", 400, capability="embedding")

    async def list_models(self, client: httpx.AsyncClient, ep: Endpoint) -> list[ModelInfo]:
        data = await send(
            client, "GET", join_url(ep.base_url, "/v1/models?limit=1000"), headers=_headers(ep)
        )
        return [ModelInfo(m["id"], m.get("display_name")) for m in data.get("data") or []]
