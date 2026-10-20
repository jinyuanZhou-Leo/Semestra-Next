"""Model calls for every provider kind, through Pydantic AI's model layer (M06 §2).

Pydantic AI turns the neutral request (`llm.py`, converted in `convert.py`) into each provider's
API; `model.SemestraModel` adds M06's retries, error codes and usage hook on top. Embeddings
and model lists come from the providers' official SDKs (Pydantic AI has no model listing). Every
request goes through the `safe_client` the caller passes in (`bridge.py`).
"""

from collections.abc import AsyncIterator

import httpx
from pydantic_ai.direct import model_request, model_request_stream
from pydantic_ai.messages import (
    PartDeltaEvent,
    PartStartEvent,
    TextPart,
    TextPartDelta,
    ThinkingPart,
    ThinkingPartDelta,
)

from semestra.core.errors import AppError
from semestra.modules.ai.adapters import convert
from semestra.modules.ai.adapters.base import Adapter, ChatRequest, Endpoint, ModelInfo, ModelParams
from semestra.modules.ai.adapters.model import Record, SemestraModel, retrying
from semestra.modules.ai.adapters.sdk import (
    ANTHROPIC_KINDS,
    anthropic_client,
    chat_model,
    google_client,
    openai_client,
)
from semestra.modules.ai.llm import Chunk, Completion, Usage


def _chunk(event: object) -> Chunk | None:
    """A streamed text or reasoning delta; other events (tool call parts) wait for the end."""
    if isinstance(event, PartStartEvent):
        if isinstance(event.part, TextPart) and event.part.content:
            return Chunk(text=event.part.content)
        if isinstance(event.part, ThinkingPart) and event.part.content:
            return Chunk(thinking=event.part.content)
    elif isinstance(event, PartDeltaEvent):
        if isinstance(event.delta, TextPartDelta) and event.delta.content_delta:
            return Chunk(text=event.delta.content_delta)
        if isinstance(event.delta, ThinkingPartDelta) and event.delta.content_delta:
            return Chunk(thinking=event.delta.content_delta)
    return None


# Compatible endpoints often have no model listing: the user types the model name instead.
_LISTING_OPTIONAL = frozenset(("anthropic_compatible", "openai_compatible", "openai_responses"))


def semestra_model(
    client: httpx.AsyncClient,
    ep: Endpoint,
    model: str,
    params: ModelParams,
    record: Record | None = None,
) -> SemestraModel:
    """The provider's Pydantic AI model wrapped with M06's retries, errors and usage hook."""
    return SemestraModel(
        chat_model(client, ep, model),
        ep,
        defaults=convert.settings_for(ep.kind, params),
        record=record,
    )


class ProviderAdapter:
    def __init__(self, kind: str) -> None:
        self.kind = kind

    async def complete(
        self, client: httpx.AsyncClient, ep: Endpoint, req: ChatRequest
    ) -> Completion:
        model = semestra_model(client, ep, req.model, req.params)
        source = convert.source(ep, req)
        response = await model_request(
            model,
            convert.to_messages(req, source),
            model_request_parameters=convert.parameters(self.kind, model, req),
            instrument=False,
        )
        return convert.completion(response, req, source)

    async def stream(
        self, client: httpx.AsyncClient, ep: Endpoint, req: ChatRequest
    ) -> AsyncIterator[Chunk]:
        model = semestra_model(client, ep, req.model, req.params)
        source = convert.source(ep, req)
        async with model_request_stream(
            model,
            convert.to_messages(req, source),
            model_request_parameters=convert.parameters(self.kind, model, req),
            instrument=False,
        ) as stream:
            async for event in stream:
                chunk = _chunk(event)
                if chunk is not None:
                    yield chunk
            response = stream.get()
        done = convert.completion(response, req, source)
        for call in done.tool_calls:
            yield Chunk(tool_call=call)
        yield Chunk(done=done)

    async def embed(
        self, client: httpx.AsyncClient, ep: Endpoint, model: str, texts: list[str]
    ) -> tuple[list[list[float]], Usage]:
        if self.kind in ANTHROPIC_KINDS:
            raise AppError("ai.capability_unsupported", 400, capability="embedding")
        if self.kind == "gemini":
            google = google_client(client, ep)
            result = await retrying(
                lambda: google.aio.models.embed_content(model=model, contents=list(texts)), model
            )
            vectors = [list(e.values or []) for e in result.embeddings or []]
            # The Gemini API reports no token counts: estimate them for the usage log.
            used = Usage(input_tokens=sum(len(t) for t in texts) // 4)
        else:
            oai = openai_client(client, ep)
            result = await retrying(lambda: oai.embeddings.create(model=model, input=texts), model)
            vectors = [list(r.embedding) for r in sorted(result.data, key=lambda r: r.index)]
            used = Usage(input_tokens=result.usage.prompt_tokens if result.usage else 0)
        if len(vectors) != len(texts):
            raise AppError("ai.output_invalid", 502)
        return vectors, used

    async def list_models(self, client: httpx.AsyncClient, ep: Endpoint) -> list[ModelInfo]:
        try:
            return await retrying(lambda: self._list(client, ep))
        except AppError as exc:
            if self.kind in _LISTING_OPTIONAL and exc.code in (
                "ai.request_rejected",
                "ai.model_not_found",
            ):
                return []
            raise

    async def _list(self, client: httpx.AsyncClient, ep: Endpoint) -> list[ModelInfo]:
        if self.kind in ANTHROPIC_KINDS:
            page = await anthropic_client(client, ep).models.list(limit=1000)
            return [ModelInfo(m.id, m.display_name) for m in page.data]
        if self.kind == "gemini":
            pager = await google_client(client, ep).aio.models.list(config={"page_size": 1000})
            return [
                ModelInfo(m.name.removeprefix("models/"), m.display_name)
                async for m in pager
                if m.name
            ]
        page = await openai_client(client, ep).models.list()
        return [ModelInfo(m.id) for m in page.data if m.id]


KINDS = (
    "anthropic",
    "anthropic_compatible",
    "openai",
    "openai_compatible",
    "openai_responses",
    "gemini",
    "ollama",
)
ADAPTERS: dict[str, Adapter] = {kind: ProviderAdapter(kind) for kind in KINDS}


def adapter_for(kind: str) -> Adapter:
    return ADAPTERS[kind]
