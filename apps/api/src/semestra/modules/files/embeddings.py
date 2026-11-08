"""Embedding texts through M06 and naming the vector space the result lives in."""

import asyncio
from collections.abc import Sequence

from cachetools import TTLCache

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules import ai
from semestra.modules.files.vectors import fingerprint

BATCH_SIZE = 64
# A search waits this long for its query's vector, then answers by keyword. The vector still
# arrives in the background (a local model loading, a slow provider), so the next search has it.
QUERY_SECONDS = 5.0


def embedding_text(heading_path: Sequence[str], text: str) -> str:
    """What is embedded for a chunk: its text with the section titles in front."""
    return f"{' > '.join(heading_path)}\n{text}" if heading_path else text


async def embed_texts(ctx: Ctx, texts: Sequence[str]) -> tuple[str, int, list[list[float]]]:
    """`(space, dim, vectors)` of document texts with the user's embedding model. Raises `ai.*`
    errors."""
    result = await ai.embed(ctx, list(texts), source_module="files")
    return fingerprint(result.provider_kind, result.model, result.dim), result.dim, result.vectors


# Search queries repeat (typing, paging, the assistant retrying): the last few hundred are kept
# for a few minutes, per user and model, so the same query is not paid for twice.
type _Key = tuple[str, str, str, str]  # user, provider kind, model, query
_queries = TTLCache[_Key, tuple[str, list[float]], float](maxsize=512, ttl=600)
# Queries being embedded: a search that stops waiting leaves its query to finish here, into the
# cache, and the same query asked meanwhile waits for it instead of embedding it again.
_pending: dict[_Key, asyncio.Task[tuple[str, list[float]]]] = {}


async def embed_query(ctx: Ctx, query: str) -> tuple[str, list[float]]:
    """`(space, vector)` of a search query. Raises `ai.*` errors."""
    assert ctx.user_id is not None
    kind, model = await ai.embedding_model(ctx)
    key = (ctx.user_id, kind, model, query)
    if (cached := _queries.get(key)) is not None:
        return cached
    task = _pending.get(key)
    if task is None or task.get_loop() is not asyncio.get_running_loop():
        task = _pending[key] = asyncio.create_task(_embed_query(ctx, key))
        task.add_done_callback(lambda done: _settled(key, done))
    try:
        # Shielded: giving up on the wait does not stop the embedding.
        async with asyncio.timeout(QUERY_SECONDS):
            return await asyncio.shield(task)
    except TimeoutError:
        raise AppError("ai.timeout", 504) from None


async def _embed_query(ctx: Ctx, key: _Key) -> tuple[str, list[float]]:
    # One attempt: a provider that is slow or rate limited gets keyword search.
    result = await ai.embed(ctx, [key[3]], source_module="files", query=True, retry=False)
    return fingerprint(result.provider_kind, result.model, result.dim), result.vectors[0]


def _settled(key: _Key, task: asyncio.Task[tuple[str, list[float]]]) -> None:
    if _pending.get(key) is task:
        del _pending[key]
    if not task.cancelled() and task.exception() is None:
        _queries[key] = task.result()
