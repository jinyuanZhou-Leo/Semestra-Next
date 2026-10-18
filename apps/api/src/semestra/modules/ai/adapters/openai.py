"""OpenAI Chat Completions, also used for OpenAI-compatible endpoints (DeepSeek, OpenRouter, vLLM,
...). `compatible=True` sticks to the widely supported subset of the API."""

import json
from collections.abc import AsyncIterator, Sequence
from typing import Any

import httpx

from semestra.core.errors import AppError
from semestra.modules.ai.adapters.base import (
    ChatRequest,
    Endpoint,
    ModelInfo,
    data_url,
    join_url,
    json_instruction,
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

_STOP: dict[str, StopReason] = {
    "stop": "end",
    "tool_calls": "tool_use",
    "function_call": "tool_use",
    "length": "max_tokens",
}


def _headers(ep: Endpoint) -> dict[str, str]:
    return {"Authorization": f"Bearer {ep.api_key}"} if ep.api_key else {}


def _user_content(parts: Sequence[object]) -> str | list[dict[str, Any]]:
    if all(isinstance(p, Text) for p in parts):
        return "\n\n".join(p.text for p in parts if isinstance(p, Text))
    out: list[dict[str, Any]] = []
    for i, part in enumerate(parts):
        match part:
            case Text(text=text):
                out.append({"type": "text", "text": text})
            case Image(data=data, mime=mime):
                out.append({"type": "image_url", "image_url": {"url": data_url(data, mime)}})
            case Document(data=data, mime=mime):
                out.append(
                    {
                        "type": "file",
                        "file": {
                            "filename": f"document-{i + 1}.pdf",
                            "file_data": data_url(data, mime),
                        },
                    }
                )
            case _:
                raise TypeError(f"unsupported part {type(part).__name__}")
    return out


def convert_messages(messages: list[Message], system: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if system:
        out.append({"role": "system", "content": system})
    for msg in messages:
        if msg.role == "system":
            continue
        if msg.role == "assistant":
            text = "".join(p.text for p in msg.content if isinstance(p, Text))
            calls = [p for p in msg.content if isinstance(p, ToolCall)]
            entry: dict[str, Any] = {"role": "assistant", "content": text or None}
            if calls:
                entry["tool_calls"] = [
                    {
                        "id": c.id,
                        "type": "function",
                        "function": {"name": c.name, "arguments": json.dumps(c.arguments)},
                    }
                    for c in calls
                ]
            out.append(entry)
            continue
        results = [p for p in msg.content if isinstance(p, ToolResult)]
        for r in results:
            out.append({"role": "tool", "tool_call_id": r.call_id, "content": r.content})
        rest = [p for p in msg.content if not isinstance(p, ToolResult)]
        if rest:
            out.append({"role": "user", "content": _user_content(rest)})
    return out


def build_body(req: ChatRequest, *, compatible: bool) -> dict[str, Any]:
    system = system_text(req.messages)
    if req.json_schema is not None and req.json_mode_fallback:
        system = f"{system}\n\n{json_instruction(req.json_schema)}".strip()
    body: dict[str, Any] = {"model": req.model, "messages": convert_messages(req.messages, system)}
    if req.params.temperature is not None:
        body["temperature"] = req.params.temperature
    if req.params.max_tokens is not None:
        body["max_tokens" if compatible else "max_completion_tokens"] = req.params.max_tokens
    if req.params.reasoning_effort is not None and not compatible:
        body["reasoning_effort"] = req.params.reasoning_effort
    if req.tools:
        body["tools"] = [
            {
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.input_schema,
                },
            }
            for t in req.tools
        ]
    if req.json_schema is not None and not req.json_mode_fallback:
        body["response_format"] = {
            "type": "json_schema",
            "json_schema": {"name": req.schema_name, "schema": req.json_schema, "strict": False},
        }
    return body


def _usage(raw: dict[str, Any] | None) -> Usage:
    raw = raw or {}
    cached = (raw.get("prompt_tokens_details") or {}).get("cached_tokens")
    return Usage(
        input_tokens=int(raw.get("prompt_tokens") or 0),
        output_tokens=int(raw.get("completion_tokens") or 0),
        cached_tokens=int(cached) if cached else None,
    )


def _arguments(raw: str | None) -> dict[str, Any]:
    try:
        value = json.loads(raw or "{}")
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}


class OpenAIAdapter:
    def __init__(self, *, compatible: bool = False) -> None:
        self.compatible = compatible

    async def complete(
        self, client: httpx.AsyncClient, ep: Endpoint, req: ChatRequest
    ) -> Completion:
        data = await send(
            client,
            "POST",
            join_url(ep.base_url, "/chat/completions"),
            headers=_headers(ep),
            json_body=build_body(req, compatible=self.compatible),
            model=req.model,
        )
        choice = (data.get("choices") or [{}])[0]
        message = choice.get("message") or {}
        calls = [
            ToolCall(c["id"], c["function"]["name"], _arguments(c["function"].get("arguments")))
            for c in message.get("tool_calls") or []
        ]
        return Completion(
            text=message.get("content") or "",
            tool_calls=calls,
            stop_reason=_STOP.get(choice.get("finish_reason") or "", "other"),
            usage=_usage(data.get("usage")),
            model=data.get("model") or req.model,
        )

    async def stream(
        self, client: httpx.AsyncClient, ep: Endpoint, req: ChatRequest
    ) -> AsyncIterator[Chunk]:
        body = {**build_body(req, compatible=self.compatible), "stream": True}
        if not self.compatible:
            body["stream_options"] = {"include_usage": True}
        texts: list[str] = []
        pending: dict[int, dict[str, str]] = {}
        usage = Usage()
        stop: StopReason = "other"
        model = req.model
        async with open_stream(
            client,
            join_url(ep.base_url, "/chat/completions"),
            headers=_headers(ep),
            json_body=body,
            model=req.model,
        ) as response:
            async for event in sse_events(response):
                model = event.get("model") or model
                if event.get("usage"):
                    usage = _usage(event["usage"])
                for choice in event.get("choices") or []:
                    delta = choice.get("delta") or {}
                    if text := delta.get("content"):
                        texts.append(text)
                        yield Chunk(text=text)
                    for call in delta.get("tool_calls") or []:
                        slot = pending.setdefault(
                            call.get("index", 0), {"id": "", "name": "", "args": ""}
                        )
                        fn = call.get("function") or {}
                        slot["id"] = call.get("id") or slot["id"]
                        slot["name"] = fn.get("name") or slot["name"]
                        slot["args"] += fn.get("arguments") or ""
                    if choice.get("finish_reason"):
                        stop = _STOP.get(choice["finish_reason"], "other")
        calls = [
            ToolCall(slot["id"], slot["name"], _arguments(slot["args"]))
            for _, slot in sorted(pending.items())
        ]
        for call in calls:
            yield Chunk(tool_call=call)
        yield Chunk(
            done=Completion(
                text="".join(texts), tool_calls=calls, stop_reason=stop, usage=usage, model=model
            )
        )

    async def embed(
        self, client: httpx.AsyncClient, ep: Endpoint, model: str, texts: list[str]
    ) -> tuple[list[list[float]], Usage]:
        data = await send(
            client,
            "POST",
            join_url(ep.base_url, "/embeddings"),
            headers=_headers(ep),
            json_body={"model": model, "input": texts},
            model=model,
        )
        rows = sorted(data.get("data") or [], key=lambda r: r.get("index", 0))
        if len(rows) != len(texts):
            raise AppError("ai.output_invalid", 502)
        return [r["embedding"] for r in rows], _usage(data.get("usage"))

    async def list_models(self, client: httpx.AsyncClient, ep: Endpoint) -> list[ModelInfo]:
        try:
            data = await send(client, "GET", join_url(ep.base_url, "/models"), headers=_headers(ep))
        except AppError as exc:
            # Many compatible endpoints have no model listing: the user types the model name.
            if self.compatible and exc.code in ("ai.request_rejected", "ai.model_not_found"):
                return []
            raise
        return [ModelInfo(m["id"]) for m in data.get("data") or [] if m.get("id")]
