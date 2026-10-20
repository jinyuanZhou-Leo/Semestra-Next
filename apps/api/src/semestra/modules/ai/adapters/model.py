"""`SemestraModel`: a provider's Pydantic AI model with M06's call rules around it (§5).

Every chat request, from `complete`/`structured` and from the assistant's `Agent` (M12), goes
through this wrapper, so retries, error codes, the Responses reasoning-summary fallback and the
usage log live in one place:

- 429, 5xx and failed connections are retried with backoff until the provider starts answering;
  a stream that fails after its first event is not retried (the user already saw part of it).
- Every failure becomes an M06 `AppError` (`map_error`).
- The Responses API's `reasoning.summary` is dropped, for the endpoint and from then on, when the
  provider rejects a request that asked for it.
- `record`, when given, logs each request's usage (the assistant passes it; `calls.py` records
  its own calls).
"""

import time
from collections.abc import AsyncGenerator, Awaitable, Callable
from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import dataclass
from typing import Any, cast

from pydantic_ai.messages import ModelMessage, ModelResponse
from pydantic_ai.models import Model, ModelRequestParameters, StreamedResponse
from pydantic_ai.models.wrapper import WrapperModel
from pydantic_ai.settings import ModelSettings

from semestra.core.errors import AppError
from semestra.modules.ai.adapters.base import MAX_RETRIES, Endpoint, backoff, map_error, retryable

SUMMARY = "openai_reasoning_summary"

# Endpoints that rejected the Responses reasoning summary (OpenAI requires a verified
# organization; some compatible gateways refuse the field): later calls go without it.
_NO_SUMMARY: set[tuple[str, str | None]] = set()

# (when the request started, the response or None, the error or None)
Record = Callable[[float, ModelResponse | None, AppError | None], None]


async def retrying[T](make: Callable[[], Awaitable[T]], model: str | None = None) -> T:
    for attempt in range(MAX_RETRIES + 1):
        try:
            return await make()
        except AppError:
            raise
        except Exception as exc:
            error = map_error(exc, model)
            if retryable(error, exc) and attempt < MAX_RETRIES:
                await backoff(attempt, error)
                continue
            raise error from None
    raise AssertionError("unreachable")


@dataclass(init=False)
class SemestraModel(WrapperModel):
    endpoint: Endpoint
    defaults: ModelSettings
    record: Record | None

    def __init__(
        self,
        wrapped: Model,
        endpoint: Endpoint,
        *,
        defaults: ModelSettings | None = None,
        record: Record | None = None,
    ) -> None:
        super().__init__(wrapped)
        self.endpoint = endpoint
        self.defaults = defaults or ModelSettings()
        self.record = record

    def _key(self) -> tuple[str, str | None]:
        return (self.endpoint.base_url, self.endpoint.provider_id)

    def _merged(self, settings: ModelSettings | None, summary: bool) -> ModelSettings:
        merged: dict[str, Any] = {**self.defaults, **(settings or {})}
        if not summary:
            merged.pop(SUMMARY, None)
        return cast(ModelSettings, merged)

    async def _summary_fallback[T](
        self, settings: ModelSettings | None, call: Callable[[bool], Awaitable[T]]
    ) -> T:
        """Calls with the reasoning summary when it was asked for; if the provider rejects the
        request, tries once without it and, when that works, leaves it out for the endpoint."""
        asked = SUMMARY in self._merged(settings, True)
        if not asked or self._key() in _NO_SUMMARY:
            return await call(False)
        try:
            return await call(True)
        except AppError as exc:
            if exc.code != "ai.request_rejected":
                raise
        result = await call(False)
        _NO_SUMMARY.add(self._key())
        return result

    def _record(
        self, started: float, response: ModelResponse | None, error: AppError | None
    ) -> None:
        if self.record is not None:
            self.record(started, response, error)

    async def request(
        self,
        messages: list[ModelMessage],
        model_settings: ModelSettings | None,
        model_request_parameters: ModelRequestParameters,
    ) -> ModelResponse:
        started = time.monotonic()
        try:
            response = await self._summary_fallback(
                model_settings,
                lambda summary: retrying(
                    lambda: self.wrapped.request(
                        messages, self._merged(model_settings, summary), model_request_parameters
                    ),
                    self.model_name,
                ),
            )
        except AppError as exc:
            self._record(started, None, exc)
            raise
        self._record(started, response, None)
        return response

    @asynccontextmanager
    async def request_stream(
        self,
        messages: list[ModelMessage],
        model_settings: ModelSettings | None,
        model_request_parameters: ModelRequestParameters,
        run_context: Any = None,
    ) -> AsyncGenerator[StreamedResponse]:
        started = time.monotonic()
        async with AsyncExitStack() as stack:

            async def start(summary: bool) -> StreamedResponse:
                return await stack.enter_async_context(
                    self.wrapped.request_stream(
                        messages,
                        self._merged(model_settings, summary),
                        model_request_parameters,
                        run_context,
                    )
                )

            try:
                stream = await self._summary_fallback(
                    model_settings,
                    lambda summary: retrying(lambda: start(summary), self.model_name),
                )
            except AppError as exc:
                self._record(started, None, exc)
                raise
            try:
                yield stream
            except AppError as exc:
                self._record(started, None, exc)
                raise
            except Exception as exc:  # the provider failed mid-stream: not retried
                error = map_error(exc, self.model_name)
                self._record(started, None, error)
                raise error from None
            except BaseException:  # the task was cancelled (the client went away)
                self._record(started, None, AppError("ai.cancelled", 499))
                raise
        # Also reached when the consumer stopped reading early: what was used so far.
        self._record(started, stream.get(), None)
