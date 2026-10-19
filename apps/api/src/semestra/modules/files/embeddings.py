"""Embedding texts through M06 and naming the vector space the result lives in."""

from collections.abc import Sequence

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
