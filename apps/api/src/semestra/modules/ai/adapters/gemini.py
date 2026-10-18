"""Google Gemini API (generativelanguage.googleapis.com, v1beta)."""

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

_STOP: dict[str, StopReason] = {"STOP": "end", "MAX_TOKENS": "max_tokens"}


def _headers(ep: Endpoint) -> dict[str, str]:
    return {"x-goog-api-key": ep.api_key or ""}


def _model_path(model: str) -> str:
    return model if model.startswith("models/") else f"models/{model}"


def _part(part: object) -> dict[str, Any]:
    match part:
        case Text(text=text):
            return {"text": text}
        case Image(data=data, mime=mime) | Document(data=data, mime=mime):
            return {"inlineData": {"mimeType": mime, "data": b64(data)}}
        case ToolCall(id=id_, name=name, arguments=args):
            return {"functionCall": {"id": id_, "name": name, "args": args}}
        case ToolResult(call_id=call_id, name=name, content=content, is_error=is_error):
            response = {"error": content} if is_error else {"content": content}
            return {"functionResponse": {"id": call_id, "name": name, "response": response}}
        case _:
            raise TypeError(f"unsupported part {type(part).__name__}")


def convert_messages(messages: list[Message]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for msg in messages:
        if msg.role == "system":
            continue
        role = "model" if msg.role == "assistant" else "user"
        parts = [_part(p) for p in msg.content]
        if out and out[-1]["role"] == role:
            out[-1]["parts"].extend(parts)
        else:
            out.append({"role": role, "parts": parts})
    return out


def build_body(req: ChatRequest) -> dict[str, Any]:
    config: dict[str, Any] = {"maxOutputTokens": req.params.max_tokens or DEFAULT_MAX_TOKENS * 2}
    if req.params.temperature is not None:
        config["temperature"] = req.params.temperature
    if req.json_schema is not None:
        config["responseMimeType"] = "application/json"
        config["responseJsonSchema"] = req.json_schema
    body: dict[str, Any] = {"contents": convert_messages(req.messages), "generationConfig": config}
    if system := system_text(req.messages):
        body["systemInstruction"] = {"parts": [{"text": system}]}
    if req.tools:
        body["tools"] = [
            {
                "functionDeclarations": [
                    {
                        "name": t.name,
                        "description": t.description,
                        "parametersJsonSchema": t.input_schema,
                    }
                    for t in req.tools
                ]
            }
        ]
    return body


def _usage(raw: dict[str, Any] | None) -> Usage:
    raw = raw or {}
    cached = raw.get("cachedContentTokenCount")
    return Usage(
        input_tokens=int(raw.get("promptTokenCount") or 0),
        output_tokens=int(raw.get("candidatesTokenCount") or 0)
        + int(raw.get("thoughtsTokenCount") or 0),
        cached_tokens=int(cached) if cached else None,
    )


def _parse_parts(parts: list[dict[str, Any]], offset: int = 0) -> tuple[str, list[ToolCall]]:
    texts: list[str] = []
    calls: list[ToolCall] = []
    for part in parts:
        if part.get("thought"):
            continue
        if "text" in part:
            texts.append(part["text"])
        elif call := part.get("functionCall"):
            call_id = call.get("id") or f"call_{offset + len(calls) + 1}"
            calls.append(ToolCall(call_id, call["name"], call.get("args") or {}))
    return "".join(texts), calls


def _blocked(data: dict[str, Any]) -> None:
    if (data.get("promptFeedback") or {}).get("blockReason"):
        raise AppError("ai.request_rejected", 400, http_status=400)


class GeminiAdapter:
    async def complete(
        self, client: httpx.AsyncClient, ep: Endpoint, req: ChatRequest
    ) -> Completion:
        data = await send(
            client,
            "POST",
            join_url(ep.base_url, f"{_model_path(req.model)}:generateContent"),
            headers=_headers(ep),
            json_body=build_body(req),
            model=req.model,
        )
        _blocked(data)
        candidate = (data.get("candidates") or [{}])[0]
        text, calls = _parse_parts((candidate.get("content") or {}).get("parts") or [])
        stop = "tool_use" if calls else _STOP.get(candidate.get("finishReason") or "", "other")
        return Completion(
            text=text,
            tool_calls=calls,
            stop_reason=stop,
            usage=_usage(data.get("usageMetadata")),
            model=data.get("modelVersion") or req.model,
        )

    async def stream(
        self, client: httpx.AsyncClient, ep: Endpoint, req: ChatRequest
    ) -> AsyncIterator[Chunk]:
        texts: list[str] = []
        calls: list[ToolCall] = []
        usage = Usage()
        stop: StopReason = "other"
        model = req.model
        async with open_stream(
            client,
            join_url(ep.base_url, f"{_model_path(req.model)}:streamGenerateContent?alt=sse"),
            headers=_headers(ep),
            json_body=build_body(req),
            model=req.model,
        ) as response:
            async for event in sse_events(response):
                _blocked(event)
                model = event.get("modelVersion") or model
                if event.get("usageMetadata"):
                    usage = _usage(event["usageMetadata"])
                for candidate in event.get("candidates") or []:
                    text, new_calls = _parse_parts(
                        (candidate.get("content") or {}).get("parts") or [], len(calls)
                    )
                    if text:
                        texts.append(text)
                        yield Chunk(text=text)
                    for call in new_calls:
                        calls.append(call)
                        yield Chunk(tool_call=call)
                    if candidate.get("finishReason"):
                        stop = _STOP.get(candidate["finishReason"], "other")
        if calls:
            stop = "tool_use"
        yield Chunk(
            done=Completion(
                text="".join(texts), tool_calls=calls, stop_reason=stop, usage=usage, model=model
            )
        )

    async def embed(
        self, client: httpx.AsyncClient, ep: Endpoint, model: str, texts: list[str]
    ) -> tuple[list[list[float]], Usage]:
        path = _model_path(model)
        data = await send(
            client,
            "POST",
            join_url(ep.base_url, f"{path}:batchEmbedContents"),
            headers=_headers(ep),
            json_body={
                "requests": [{"model": path, "content": {"parts": [{"text": t}]}} for t in texts]
            },
            model=model,
        )
        vectors = [e.get("values") or [] for e in data.get("embeddings") or []]
        if len(vectors) != len(texts):
            raise AppError("ai.output_invalid", 502)
        # The batch endpoint reports no token counts: estimate them for the usage log.
        return vectors, Usage(input_tokens=sum(len(t) for t in texts) // 4)

    async def list_models(self, client: httpx.AsyncClient, ep: Endpoint) -> list[ModelInfo]:
        data = await send(
            client, "GET", join_url(ep.base_url, "models?pageSize=1000"), headers=_headers(ep)
        )
        return [
            ModelInfo(m["name"].removeprefix("models/"), m.get("displayName"))
            for m in data.get("models") or []
            if m.get("name")
        ]
