"""What every provider kind shares: the request shape, retries and error mapping."""

import asyncio
import re
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

import httpx
import structlog

from semestra.core import jobs
from semestra.core.errors import AppError
from semestra.modules.ai.adapters.limits import Gate, no_gate
from semestra.modules.ai.llm import ProviderCapability, Usage

log = structlog.get_logger()

# 429, 5xx and failed connections are retried this many times with exponential backoff (M06 §5).
MAX_RETRIES = 3
RETRY_BASE_SECONDS = 1.0  # tests set this to 0
MAX_RETRY_AFTER_SECONDS = 30.0
# A request made from a job waits a rate limit out for this long in all (per-minute limits need
# tens of seconds), each wait up to BACKGROUND_MAX_WAIT_SECONDS, at most BACKGROUND_RETRIES times.
BACKGROUND_PATIENCE_SECONDS = 300.0
BACKGROUND_MAX_WAIT_SECONDS = 90.0
BACKGROUND_RETRIES = 10
# A request gives up after this long; a stream after this long without data.
CALL_TIMEOUT_SECONDS = 120.0
STREAM_IDLE_TIMEOUT_SECONDS = 60.0
# A structured answer may be long: its request gets CALL_TIMEOUT_SECONDS to read the input and
# start, plus the time the model's output limit takes at a slow MIN_TOKENS_PER_SECOND. Without a
# limit from the user, DEFAULT_OUTPUT_TOKENS is assumed (Pydantic AI's cap for models it does
# not know).
MIN_TOKENS_PER_SECOND = 25
DEFAULT_OUTPUT_TOKENS = 16_384


def answer_timeout(max_tokens: int | None) -> float:
    return CALL_TIMEOUT_SECONDS + (max_tokens or DEFAULT_OUTPUT_TOKENS) / MIN_TOKENS_PER_SECOND


@dataclass(frozen=True)
class Endpoint:
    """A provider ready to be called. Holds the decrypted key: never log or return it."""

    kind: str
    base_url: str
    api_key: str | None
    capabilities: tuple[ProviderCapability, ...]
    provider_id: str | None  # None = the instance-wide provider
    display_name: str
    # Most requests sent at once (`limits`); None = the default.
    max_concurrency: int | None = None

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
        self,
        client: httpx.AsyncClient,
        ep: Endpoint,
        model: str,
        texts: list[str],
        *,
        query: bool = False,
        retry: bool = True,
        gate: Gate = no_gate,
    ) -> tuple[list[list[float]], Usage]: ...

    async def list_models(self, client: httpx.AsyncClient, ep: Endpoint) -> list[ModelInfo]: ...


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

# An account without money: 402 (DeepSeek, OpenRouter), or 429/400 with one of these (OpenAI's
# `insufficient_quota`, Anthropic's "credit balance is too low"). Waiting does not help. Not
# "exceeded your current quota": Gemini says that for an ordinary per-minute 429.
_CREDIT_HINTS = (
    "insufficient balance",
    "insufficient_balance",
    "insufficient_quota",
    "credit balance is too low",
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


# Gemini puts the wait in the body (`RetryInfo.retryDelay`, e.g. "37s"), not in a header.
_RETRY_DELAY = re.compile(r'retrydelay"?\s*[:=]\s*"?(\d+(?:\.\d+)?)s')
# How many inputs an embeddings endpoint takes, when its refusal says so (Alibaba Cloud Model
# Studio: "batch size is invalid, it should not be larger than 10").
_BATCH_LIMIT = re.compile(
    r"(?:batch|inputs?|texts?)\b[^.\n]{0,60}?(?:larger than|more than|at most|maximum(?: is| of)?"
    r"|exceeds?(?: the)?(?: limit(?: of)?)?|limit(?: is| of)?|<=)\s*(\d+)"
)


def _retry_after(response: HttpResponse, body: str) -> float | None:
    value = response.headers.get("retry-after")
    if not value and (found := _RETRY_DELAY.search(body)):
        value = found.group(1)
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
        retry_after = _retry_after(response, body)
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
    if (found := _BATCH_LIMIT.search(body)) and int(found.group(1)) > 0:
        return AppError(
            "ai.request_rejected", 400, http_status=status, batch_limit=int(found.group(1))
        )
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


def retry_delay(attempt: int, error: AppError, waited: float) -> float | None:
    """How long to wait before trying again after `attempt` failed tries (and `waited` seconds of
    waiting so far), or None to give up. A job waits longer for a rate limit (see the limits
    above); everything else gets MAX_RETRIES tries with a short backoff."""
    patient = error.code == "ai.rate_limited" and jobs.in_job()
    if attempt >= (BACKGROUND_RETRIES if patient else MAX_RETRIES):
        return None
    cap = BACKGROUND_MAX_WAIT_SECONDS if patient else MAX_RETRY_AFTER_SECONDS
    delay = min(RETRY_BASE_SECONDS * (2**attempt), cap)
    if (after := error.params.get("retry_after")) is not None:
        delay = min(float(after), cap) if RETRY_BASE_SECONDS else 0
    if patient and waited + delay > BACKGROUND_PATIENCE_SECONDS:
        return None
    return delay


async def backoff(delay: float, error: AppError) -> None:
    """Waits `delay` seconds; a job shows it is waiting out a rate limit."""
    if error.code != "ai.rate_limited":
        await asyncio.sleep(delay)
        return
    until = datetime.now(UTC) + timedelta(seconds=delay)
    async with jobs.waiting("ai.rate_limited", until=until):
        await asyncio.sleep(delay)
