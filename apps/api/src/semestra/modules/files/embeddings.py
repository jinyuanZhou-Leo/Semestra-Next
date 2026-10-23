"""Embedding texts through M06 and naming the vector space the result lives in."""

from collections.abc import Sequence

from cachetools import TTLCache

from semestra.core.context import Ctx
from semestra.modules import ai
from semestra.modules.files.vectors import fingerprint

BATCH_SIZE = 64


def embedding_text(heading_path: Sequence[str], text: str) -> str:
    """What is embedded for a chunk: its text with the section titles in front."""
    return f"{' > '.join(heading_path)}\n{text}" if heading_path else text


async def embed_texts(ctx: Ctx, texts: Sequence[str]) -> tuple[str, int, list[list[float]]]:
    """`(space, dim, vectors)` for the user's embedding model. Raises `ai.*` errors."""
    resolved = await ai.resolve_provider(ctx, "embedding")
    result = await ai.embed(ctx, list(texts), source_module="files")
    return fingerprint(resolved.endpoint.kind, result.model, result.dim), result.dim, result.vectors


# Search queries repeat (typing, paging, the assistant retrying): the last few hundred are kept
# for a few minutes, per user and model, so the same query is not paid for twice.
type _Key = tuple[str, str, str, str]  # user, provider kind, model, query
_queries = TTLCache[_Key, tuple[str, list[float]], float](maxsize=512, ttl=600)


async def embed_query(ctx: Ctx, query: str) -> tuple[str, list[float]]:
    """`(space, vector)` of a search query. Raises `ai.*` errors."""
    assert ctx.user_id is not None
    resolved = await ai.resolve_provider(ctx, "embedding")
    key = (ctx.user_id, resolved.endpoint.kind, resolved.model, query)
    cached = _queries.get(key)
    if cached is None:
        space, _, vectors = await embed_texts(ctx, [query])
        cached = _queries[key] = (space, vectors[0])
    return cached
