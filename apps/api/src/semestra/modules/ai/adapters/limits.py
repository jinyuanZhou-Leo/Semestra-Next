"""How many requests go to one provider at a time, and how long a request waits out a rate limit
(M06 §5).

OCR pages read side by side, the parts of an extraction, a rebuild of every vector and the
assistant can all call the same provider at once. Every request to an endpoint (a base URL with
the user's key) takes a slot from its `ConcurrencyLimiter` first, `Endpoint.max_concurrency` of
them (the user's "Most requests at a time", else `DEFAULT_CONCURRENCY`). A request that has to
wait for one, or waits out a rate limit, shows that on its job (`core.jobs.waiting`).

A request made from a job (OCR, imports, vectors) waits a rate limit out for up to
`BACKGROUND_PATIENCE_SECONDS`: per-minute limits need tens of seconds, and nobody watches the
request. One the user is waiting on (the assistant, a search) gives up after a few seconds.
"""

from collections.abc import AsyncGenerator, Callable
from contextlib import AbstractAsyncContextManager, asynccontextmanager

from pydantic_ai.concurrency import ConcurrencyLimiter

from semestra.core import jobs

DEFAULT_CONCURRENCY = 4
MAX_CONCURRENCY = 32

# A slot for one request: `async with gate(): ...`.
Gate = Callable[[], AbstractAsyncContextManager[None]]


@asynccontextmanager
async def _open() -> AsyncGenerator[None]:
    yield


def no_gate() -> AbstractAsyncContextManager[None]:
    return _open()


def gate_of(limiter: ConcurrencyLimiter) -> Gate:
    @asynccontextmanager
    async def slot() -> AsyncGenerator[None]:
        if limiter.available_count > 0:
            await limiter.acquire("request")
        else:
            async with jobs.waiting("ai.provider_busy"):
                await limiter.acquire("request")
        try:
            yield
        finally:
            limiter.release()

    return slot


class Limiters:
    """The limiters of one app (`AiRuntime.limiters`), by endpoint."""

    def __init__(self) -> None:
        self._by_endpoint: dict[tuple[str, str | None], ConcurrencyLimiter] = {}

    def gate(self, base_url: str, provider_id: str | None, limit: int | None) -> Gate:
        key = (base_url, provider_id)
        size = min(max(limit or DEFAULT_CONCURRENCY, 1), MAX_CONCURRENCY)
        limiter = self._by_endpoint.get(key)
        # A changed setting takes a new limiter; requests holding the old one finish on it.
        if limiter is None or limiter.max_running != size:
            limiter = self._by_endpoint[key] = ConcurrencyLimiter(max_running=size)
        return gate_of(limiter)
