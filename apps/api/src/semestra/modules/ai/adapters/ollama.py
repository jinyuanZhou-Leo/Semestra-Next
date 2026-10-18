"""Ollama's native API (/api/chat, /api/embed, /api/tags)."""

from collections.abc import AsyncIterator
from typing import Any

import httpx

from semestra.core.errors import AppError
from semestra.modules.ai.adapters.base import (
    ChatRequest,
    Endpoint,
    ModelInfo,
    b64,
    join_url,
    ndjson_events,
    open_stream,
    send,
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

_STOP: dict[str, StopReason] = {"stop": "end", "length": "max_tokens"}


def _headers(ep: Endpoint) -> dict[str, str]:
    return {"Authorization": f"Bearer {ep.api_key}"} if ep.api_key else {}


def convert_messages(messages: list[Message]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if system := system_text(messages):
        out.append({"role": "system", "content": system})
    for msg in messages:
        if msg.role == "system":
            continue
        for result in (p for p in msg.content if isinstance(p, ToolResult)):
            out.append({"role": "tool", "content": result.content, "tool_name": result.name})
        texts = [p.text for p in msg.content if isinstance(p, Text)]
        images = [b64(p.data) for p in msg.content if isinstance(p, Image)]
        calls = [p for p in msg.content if isinstance(p, ToolCall)]
        if any(isinstance(p, Document) for p in msg.content):
            raise AppError("ai.capability_unsupported", 400, capability="pdf")
        if not (texts or images or calls):
            continue
        entry: dict[str, Any] = {
            "role": "assistant" if msg.role == "assistant" else "user",
            "content": "\n\n".join(texts),
        }
        if images:
            entry["images"] = images
        if calls:
            entry["tool_calls"] = [
                {"function": {"name": c.name, "arguments": c.arguments}} for c in calls
            ]
        out.append(entry)
    return out


def build_body(req: ChatRequest) -> dict[str, Any]:
    body: dict[str, Any] = {"model": req.model, "messages": convert_messages(req.messages)}
    options: dict[str, Any] = {}
    if req.params.temperature is not None:
        options["temperature"] = req.params.temperature
    if req.params.max_tokens is not None:
        options["num_predict"] = req.params.max_tokens
    if options:
        body["options"] = options
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
    if req.json_schema is not None:
        body["format"] = req.json_schema if not req.json_mode_fallback else "json"
    return body


def _calls(raw: list[dict[str, Any]] | None, offset: int = 0) -> list[ToolCall]:
    return [
        ToolCall(
            c.get("id") or f"call_{offset + i + 1}",
            c["function"]["name"],
            c["function"].get("arguments") or {},
        )
        for i, c in enumerate(raw or [])
    ]


def _usage(data: dict[str, Any]) -> Usage:
    return Usage(
        input_tokens=int(data.get("prompt_eval_count") or 0),
        output_tokens=int(data.get("eval_count") or 0),
    )


class OllamaAdapter:
    async def complete(
        self, client: httpx.AsyncClient, ep: Endpoint, req: ChatRequest
    ) -> Completion:
        data = await send(
            client,
            "POST",
            join_url(ep.base_url, "/api/chat"),
            headers=_headers(ep),
            json_body={**build_body(req), "stream": False},
            model=req.model,
        )
        message = data.get("message") or {}
        calls = _calls(message.get("tool_calls"))
        stop = "tool_use" if calls else _STOP.get(data.get("done_reason") or "", "other")
        return Completion(
            text=message.get("content") or "",
            tool_calls=calls,
            stop_reason=stop,
            usage=_usage(data),
            model=data.get("model") or req.model,
        )

    async def stream(
        self, client: httpx.AsyncClient, ep: Endpoint, req: ChatRequest
    ) -> AsyncIterator[Chunk]:
        texts: list[str] = []
        calls: list[ToolCall] = []
        usage = Usage()
        stop: StopReason = "other"
        async with open_stream(
            client,
            join_url(ep.base_url, "/api/chat"),
            headers=_headers(ep),
            json_body={**build_body(req), "stream": True},
            model=req.model,
        ) as response:
            async for event in ndjson_events(response):
                if event.get("error"):
                    raise AppError("ai.provider_unreachable", 502)
                message = event.get("message") or {}
                if text := message.get("content"):
                    texts.append(text)
                    yield Chunk(text=text)
                for call in _calls(message.get("tool_calls"), len(calls)):
                    calls.append(call)
                    yield Chunk(tool_call=call)
                if event.get("done"):
                    usage = _usage(event)
                    stop = _STOP.get(event.get("done_reason") or "", "other")
        yield Chunk(
            done=Completion(
                text="".join(texts),
                tool_calls=calls,
                stop_reason="tool_use" if calls else stop,
                usage=usage,
                model=req.model,
            )
        )

    async def embed(
        self, client: httpx.AsyncClient, ep: Endpoint, model: str, texts: list[str]
    ) -> tuple[list[list[float]], Usage]:
        data = await send(
            client,
            "POST",
            join_url(ep.base_url, "/api/embed"),
            headers=_headers(ep),
            json_body={"model": model, "input": texts},
            model=model,
        )
        vectors: list[list[float]] = data.get("embeddings") or []
        if len(vectors) != len(texts):
            raise AppError("ai.output_invalid", 502)
        return vectors, Usage(input_tokens=int(data.get("prompt_eval_count") or 0))

    async def list_models(self, client: httpx.AsyncClient, ep: Endpoint) -> list[ModelInfo]:
        data = await send(client, "GET", join_url(ep.base_url, "/api/tags"), headers=_headers(ep))
        return [ModelInfo(m["name"]) for m in data.get("models") or [] if m.get("name")]
