"""Where a file's bytes come from (M07 §2.3).

A file is usually stored here (`storage_key`). A file another module keeps track of elsewhere
(M09's LMS files and pages) may be stored nowhere: its `source_ref` names the module's content
source, which reads the bytes when they are needed (download, preview, processing). Such a file
takes no storage quota; its text, page images and search index are kept here like any other's.

A source registers once per `source_ref` prefix (`register_content_source("lms:", open)`).
"""

from collections.abc import AsyncIterator, Awaitable, Callable

from sqlalchemy import select
from starlette.datastructures import State

from semestra.core.context import Ctx, run_as_system
from semestra.core.errors import AppError, not_found
from semestra.core.storage import get_storage
from semestra.modules.files.models import FilesItem

# Opens an unstored file's bytes. Whatever it needs from the database it reads (and writes,
# say renewed credentials) before it returns; the stream itself needs no session.
ContentOpener = Callable[[Ctx, FilesItem], Awaitable[AsyncIterator[bytes]]]

_sources: dict[str, ContentOpener] = {}


def register_content_source(prefix: str, opener: ContentOpener) -> None:
    if prefix in _sources:
        raise ValueError(f"duplicate content source {prefix!r}")
    _sources[prefix] = opener


def _source(row: FilesItem) -> ContentOpener | None:
    ref = row.source_ref or ""
    return next((open_ for prefix, open_ in _sources.items() if ref.startswith(prefix)), None)


def remote(row: FilesItem) -> bool:
    """A file whose bytes are read from its source, not from storage."""
    return row.kind == "file" and not row.storage_key and _source(row) is not None


def follows_source(row: FilesItem) -> bool:
    """A file its source keeps in step (updates, removes), with a local copy or not: not one
    the user made their own (`sources.make_own`)."""
    return row.kind == "file" and _source(row) is not None


def has_content(row: FilesItem) -> bool:
    return row.kind == "file" and (bool(row.storage_key) or remote(row))


async def open_content(
    ctx: Ctx, row: FilesItem, *, start: int = 0, length: int | None = None
) -> AsyncIterator[bytes]:
    """The file's bytes. A byte range is honoured for stored files only (`remote` ones come
    whole). Not found: a link, or a file whose source is gone."""
    if row.storage_key:
        return get_storage(ctx).open(row.storage_key, start=start, length=length)
    opener = _source(row) if row.kind == "file" else None
    if opener is None:
        raise not_found()
    return await opener(ctx, row)


async def read_all(state: State, user_id: str, row: FilesItem, limit: int) -> bytes:
    """All of a file's bytes, at most `limit` (more is `files.too_large`). An unstored file's
    source is opened in a transaction of its own (it may write, say renewed credentials), which
    commits before the bytes are read: a slow download holds no database lock."""
    data = bytearray()

    async def read(stream: AsyncIterator[bytes]) -> None:
        try:
            async for chunk in stream:
                data.extend(chunk)
                if len(data) > limit:
                    raise AppError("files.too_large", 413, max=limit)
        finally:
            await stream.aclose()  # pyright: ignore[reportAttributeAccessIssue]

    if row.storage_key:
        await read(state.storage.open(row.storage_key))
        return bytes(data)

    await read(await open_detached(state, user_id, row.id))
    return bytes(data)


async def open_detached(state: State, user_id: str, item_id: str) -> AsyncIterator[bytes]:
    """A file's bytes outside a request's transaction (a stream that outlives it): the file is
    opened in a transaction of its own, which commits (what its source wrote on the way) before
    the bytes are read."""
    opened: list[AsyncIterator[bytes]] = []

    async def open_(ctx: Ctx) -> None:
        row = await ctx.db.scalar(
            select(FilesItem).where(FilesItem.id == item_id, FilesItem.user_id == user_id)
        )
        if row is None:
            raise not_found()
        opened.append(await open_content(ctx, row))

    await run_as_system(state, user_id, open_)
    return opened[0]
