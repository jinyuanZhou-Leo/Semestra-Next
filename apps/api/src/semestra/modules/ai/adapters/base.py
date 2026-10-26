"""What every provider kind shares: the request shape, retries and error mapping."""

import asyncio
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx
import structlog

from semestra.core.errors import AppError
from semestra.modules.ai.llm import ProviderCapability, Usage

log = structlog.get_logger()

# 429, 5xx and failed connections are retried this many times with exponential backoff (M06 §5).
MAX_RETRIES = 3
RETRY_BASE_SECONDS = 1.0  # tests set this to 0
MAX_RETRY_AFTER_SECONDS = 30.0
# A call gives up after this long; a stream after this long without data.
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
class ModelInfo:
    id: str
    display_name: str | None = None


class Adapter(Protocol):
    """What the providers' own SDKs do (chat goes through `SemestraModel`)."""

    async def embed(
        self, client: httpx.AsyncClient, ep: Endpoint, model: str, texts: list[str]
    ) -> tuple[list[list[float]], Usage]: ...

    async def list_models(self, client: httpx.AsyncClient, ep: Endpoint) -> list[ModelInfo]: ...


# The output cap where the API needs one and the user set none. Long structured answers (a
# syllabus with evidence for every field) and thinking count against it; 4096 cut them off. It
# stays below the Anthropic SDK's limit for a request that is not streamed (about 21k).
DEFAULT_MAX_TOKENS = 16_384


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

# An account without money: 402 (DeepSeek), or 429/400 with one of these (OpenAI's
# `insufficient_quota`, Anthropic's "credit balance is too low"). Waiting does not help.
_CREDIT_HINTS = (
    "insufficient balance",
    "insufficient_balance",
    "insufficient_quota",
    "credit balance is too low",
    "exceeded your current quota",
)


class HttpResponse(Protocol):
    """An `httpx` or `httpx2` response (the SDKs use either)."""

    @property
    def status_code(self) -> int: ...

    @property
    def headers(self) -> Any: ...

    @property
    def text(self) -> str: ...


@dataclass(frozen=True)
class _Bare:
    """A response rebuilt from an error that kept only its status and body."""

    status_code: int
    text: str
    headers: dict[str, str] = field(default_factory=lambda: {})


def _retry_after(response: HttpResponse) -> float | None:
    value = response.headers.get("retry-after")
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        return None


def error_for(response: HttpResponse, model: str | None = None) -> AppError:
    """Maps a provider's error response to one of M06's error codes (§8)."""
    status = response.status_code
    try:
        body = response.text.lower()
    except Exception:
        body = ""
    if status in (401, 403) or any(hint in body for hint in _KEY_HINTS):
        return AppError("ai.invalid_key", 400)
    if status == 402 or any(hint in body for hint in _CREDIT_HINTS):
        return AppError("ai.out_of_credit", 402)
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


def _chain(exc: BaseException) -> Iterator[BaseException]:
    seen: set[int] = set()
    current: BaseException | None = exc
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        yield current
        current = current.__cause__ or current.__context__


def map_error(exc: BaseException, model: str | None = None) -> AppError:
    """The M06 error for anything an SDK or Pydantic AI raised: from the HTTP response when there
    is one, else from the transport failure. An `AppError` underneath (the egress guard) wins."""
    chain = list(_chain(exc))
    for e in chain:
        if isinstance(e, AppError):
            return e
    for e in chain:
        response = getattr(e, "response", None)
        status = getattr(response, "status_code", None)
        if isinstance(status, int) and status >= 400:
            return error_for(response, model)  # pyright: ignore[reportArgumentType]
    for e in chain:
        if isinstance(e, TimeoutError) or "timeout" in type(e).__name__.lower():
            return AppError("ai.timeout", 504)
    for e in chain:
        status = getattr(e, "status_code", None)  # Pydantic AI's ModelHTTPError
        if isinstance(status, int) and status >= 400:
            return error_for(_Bare(status, str(getattr(e, "body", "") or "")), model)
    # Only the exception types: their messages may quote the prompt or the reply.
    log.warning("ai_provider_failure", errors=[type(e).__name__ for e in chain])
    return AppError("ai.provider_unreachable", 502)


def retryable(error: AppError, exc: BaseException) -> bool:
    """429, 5xx and failed connections; not timeouts, and not a request the SDK refused to send."""
    if error.code == "ai.rate_limited":
        return True
    if error.code != "ai.provider_unreachable":
        return False
    return "http_status" in error.params or any(
        "connect" in type(e).__name__.lower() for e in _chain(exc)
    )


async def backoff(attempt: int, error: AppError) -> None:
    delay = RETRY_BASE_SECONDS * (2**attempt)
    if (after := error.params.get("retry_after")) is not None:
        delay = min(float(after), MAX_RETRY_AFTER_SECONDS) if RETRY_BASE_SECONDS else 0
    await asyncio.sleep(delay)
