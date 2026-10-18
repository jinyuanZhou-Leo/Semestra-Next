"""What every provider adapter shares: the request shape, HTTP with retries, error mapping."""

import asyncio
import base64
import json
from collections.abc import AsyncIterator, Mapping
from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx

from semestra.core.errors import AppError
from semestra.modules.ai.llm import Chunk, Completion, Message, ProviderCapability, Tool, Usage

# 429 and 5xx are retried this many times with exponential backoff (M06 §5).
MAX_RETRIES = 3
RETRY_BASE_SECONDS = 1.0  # tests set this to 0
MAX_RETRY_AFTER_SECONDS = 30.0
# Non-streaming calls give up after this long; a stream after this long without data.
CALL_TIMEOUT_SECONDS = 120.0
STREAM_IDLE_TIMEOUT_SECONDS = 60.0


@dataclass(frozen=True)
class Endpoint:
    """A provider ready to be called. Holds the decrypted key: never log or return it."""

    kind: str
    base_url: str
    api_key: str | None
    capabilities: tuple[ProviderCapability, ...]
    provider_id: str | None  # None = the instance-wide provider
    display_name: str

    def __repr__(self) -> str:  # keep the key out of tracebacks and logs
        return f"Endpoint(kind={self.kind!r}, base_url={self.base_url!r})"


@dataclass(frozen=True)
class ModelParams:
    temperature: float | None = None
    max_tokens: int | None = None
    reasoning_effort: str | None = None


@dataclass(frozen=True)
class ChatRequest:
    model: str
    messages: list[Message]
    tools: list[Tool] = field(default_factory=lambda: [])
    params: ModelParams = field(default_factory=ModelParams)
    # Ask for JSON matching this schema (structured output); `schema_name` names it.
    json_schema: dict[str, Any] | None = None
    schema_name: str = "result"
    # The provider has no native structured output: ask for JSON in the prompt instead.
    json_mode_fallback: bool = False


@dataclass(frozen=True)
class ModelInfo:
    id: str
    display_name: str | None = None


class Adapter(Protocol):
    async def complete(
        self, client: httpx.AsyncClient, ep: Endpoint, req: ChatRequest
    ) -> Completion: ...

    def stream(
        self, client: httpx.AsyncClient, ep: Endpoint, req: ChatRequest
    ) -> AsyncIterator[Chunk]: ...

    async def embed(
        self, client: httpx.AsyncClient, ep: Endpoint, model: str, texts: list[str]
    ) -> tuple[list[list[float]], Usage]: ...

    async def list_models(self, client: httpx.AsyncClient, ep: Endpoint) -> list[ModelInfo]: ...


DEFAULT_MAX_TOKENS = 4096


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def data_url(data: bytes, mime: str) -> str:
    return f"data:{mime};base64,{b64(data)}"


def join_url(base: str, path: str) -> str:
    return f"{base.rstrip('/')}/{path.lstrip('/')}"


# --- errors ---------------------------------------------------------------------------------

_CONTEXT_HINTS = (
    "context length",
    "context_length",
    "context window",
    "maximum context",
    "prompt is too long",
    "too many tokens",
    "input is too long",
    "exceeds the maximum",
    "token limit",
)


# Gemini answers a bad key with 400 and one of these messages.
_KEY_HINTS = ("api key not valid", "api_key_invalid", "invalid api key", "incorrect api key")


def _retry_after(response: httpx.Response) -> float | None:
    value = response.headers.get("retry-after")
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        return None


def error_for(response: httpx.Response, model: str | None = None) -> AppError:
    """Maps a provider's error response to one of M06's error codes (§8)."""
    status = response.status_code
    try:
        body = response.text.lower()
    except UnicodeDecodeError, httpx.ResponseNotRead:
        body = ""
    if status in (401, 403) or any(hint in body for hint in _KEY_HINTS):
        return AppError("ai.invalid_key", 400)
    if status == 429:
        retry_after = _retry_after(response)
        return AppError(
            "ai.rate_limited",
            429,
            **({"retry_after": round(retry_after)} if retry_after is not None else {}),
        )
    if status >= 500:
        return AppError("ai.provider_unreachable", 502, http_status=status)
    if status == 413 or any(hint in body for hint in _CONTEXT_HINTS):
        return AppError("ai.context_too_long", 400)
    if status == 404 and model:
        return AppError("ai.model_not_found", 400, model=model)
    return AppError("ai.request_rejected", 400, http_status=status)


def _retryable(status: int) -> bool:
    return status == 429 or status >= 500


async def _backoff(attempt: int, response: httpx.Response | None) -> None:
    delay = RETRY_BASE_SECONDS * (2**attempt)
    if response is not None and (after := _retry_after(response)) is not None:
        delay = min(after, MAX_RETRY_AFTER_SECONDS) if RETRY_BASE_SECONDS else 0
    await asyncio.sleep(delay)


def _transport_error(exc: httpx.HTTPError) -> AppError:
    if isinstance(exc, httpx.TimeoutException):
        return AppError("ai.timeout", 504)
    return AppError("ai.provider_unreachable", 502)


async def send(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    *,
    headers: Mapping[str, str],
    json_body: Any = None,
    model: str | None = None,
) -> Any:
    """One JSON request with retries on 429/5xx; returns the decoded JSON body."""
    for attempt in range(MAX_RETRIES + 1):
        try:
            response = await client.request(method, url, headers=headers, json=json_body)
        except httpx.HTTPError as exc:
            if attempt < MAX_RETRIES and not isinstance(exc, httpx.TimeoutException):
                await _backoff(attempt, None)
                continue
            raise _transport_error(exc) from None
        if response.is_success:
            try:
                return response.json()
            except json.JSONDecodeError:
                raise AppError("ai.provider_unreachable", 502) from None
        if _retryable(response.status_code) and attempt < MAX_RETRIES:
            await _backoff(attempt, response)
            continue
        raise error_for(response, model)
    raise AssertionError("unreachable")


@asynccontextmanager
async def open_stream(
    client: httpx.AsyncClient,
    url: str,
    *,
    headers: Mapping[str, str],
    json_body: Any,
    model: str | None = None,
) -> AsyncIterator[httpx.Response]:
    """A streaming POST; retried like `send` until the provider starts answering."""
    for attempt in range(MAX_RETRIES + 1):
        stack = AsyncExitStack()
        try:
            response = await stack.enter_async_context(
                client.stream("POST", url, headers=headers, json=json_body)
            )
        except httpx.HTTPError as exc:
            await stack.aclose()
            if attempt < MAX_RETRIES and isinstance(exc, httpx.ConnectError):
                await _backoff(attempt, None)
                continue
            raise _transport_error(exc) from None
        if response.is_success:
            async with stack:
                yield response
            return
        async with stack:
            await response.aread()
        if _retryable(response.status_code) and attempt < MAX_RETRIES:
            await _backoff(attempt, response)
            continue
        raise error_for(response, model)


async def sse_events(response: httpx.Response) -> AsyncIterator[dict[str, Any]]:
    """`data:` payloads of a server-sent event stream, decoded as JSON."""
    async for line in _lines(response):
        if not line.startswith("data:"):
            continue
        payload = line[5:].strip()
        if not payload or payload == "[DONE]":
            continue
        try:
            yield json.loads(payload)
        except json.JSONDecodeError:
            continue


async def ndjson_events(response: httpx.Response) -> AsyncIterator[dict[str, Any]]:
    async for line in _lines(response):
        line = line.strip()
        if line:
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


async def _lines(response: httpx.Response) -> AsyncIterator[str]:
    iterator = response.aiter_lines().__aiter__()
    while True:
        try:
            async with asyncio.timeout(STREAM_IDLE_TIMEOUT_SECONDS):
                line = await iterator.__anext__()
        except StopAsyncIteration:
            return
        except TimeoutError:
            raise AppError("ai.timeout", 504) from None
        except httpx.HTTPError as exc:
            raise _transport_error(exc) from None
        yield line


def json_instruction(schema: dict[str, Any]) -> str:
    """System text for providers without native structured output (JSON mode fallback)."""
    return (
        "Reply with one JSON object and nothing else (no prose, no code fence). "
        "It must validate against this JSON Schema:\n" + json.dumps(schema, ensure_ascii=False)
    )


def system_text(messages: list[Message]) -> str:
    from semestra.modules.ai.llm import Text

    return "\n\n".join(
        part.text
        for msg in messages
        if msg.role == "system"
        for part in msg.content
        if isinstance(part, Text)
    )
