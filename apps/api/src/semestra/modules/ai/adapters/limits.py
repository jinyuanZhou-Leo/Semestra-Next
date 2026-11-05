"""How many requests go to one provider at a time, and how long a request waits out a rate limit
(M06 §5).

OCR pages read side by side, the parts of an extraction, a rebuild of every vector and the
assistant can all call the same provider at once. Every request to an endpoint (a base URL with
the user's key) takes a slot from its `ConcurrencyLimiter` first, `Endpoint.max_concurrency` of
them (the user's "Most requests at a time", else `DEFAULT_CONCURRENCY`). Requests made from jobs
use at most all but one of them, so the assistant or a search never waits behind an OCR run. A
request that has to wait for one, or waits out a rate limit, shows that on its job
(`core.jobs.waiting`). The instance provider has no limit unless the server sets
`SEMESTRA_INSTANCE_AI_MAX_CONCURRENCY`: all its users share it.

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


def gate_of(limiter: ConcurrencyLimiter, background: ConcurrencyLimiter | None = None) -> Gate:
    """Slots of `limiter`; a request made from a job first takes one of `background`, which has
    one slot fewer, so a request the user is waiting on never queues behind background work."""

    @asynccontextmanager
    async def slot() -> AsyncGenerator[None]:
        lanes = [background, limiter] if background is not None and jobs.in_job() else [limiter]
        taken: list[ConcurrencyLimiter] = []
        try:
            for lane in lanes:
                if lane.available_count > 0:
                    await lane.acquire("request")
                else:
                    async with jobs.waiting("ai.provider_busy"):
                        await lane.acquire("request")
                taken.append(lane)
            yield
        finally:
            for lane in reversed(taken):
                lane.release()

    return slot


class Limiters:
    """The limiters of one app (`AiRuntime.limiters`), by endpoint."""

    def __init__(self) -> None:
        self._by_endpoint: dict[
            tuple[str, str | None], tuple[ConcurrencyLimiter, ConcurrencyLimiter | None]
        ] = {}

    def gate(self, base_url: str, provider_id: str | None, limit: int | None) -> Gate:
        key = (base_url, provider_id)
        size = min(max(limit or DEFAULT_CONCURRENCY, 1), MAX_CONCURRENCY)
        pair = self._by_endpoint.get(key)
        # A changed setting takes new limiters; requests holding the old ones finish on them.
        if pair is None or pair[0].max_running != size:
            background = ConcurrencyLimiter(max_running=size - 1) if size > 1 else None
            pair = self._by_endpoint[key] = (ConcurrencyLimiter(max_running=size), background)
        return gate_of(*pair)
