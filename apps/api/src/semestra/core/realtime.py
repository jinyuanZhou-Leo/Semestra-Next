"""Live updates over SSE (M00 §3.8).

`GET /events/stream` pushes `{"type": ..., "data": {...}}` for every event concerning the signed-in
user; the frontend invalidates the matching TanStack Query caches. One process, in-memory
fan-out (single VM). If a connection falls behind, its backlog is replaced by one `core.resync`
message, which tells the client to refetch everything.
"""

import asyncio
import json
from collections import defaultdict
from collections.abc import AsyncIterator, Generator
from contextlib import contextmanager
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from sse_starlette import EventSourceResponse

from semestra.core.context import Ctx, get_ctx

QUEUE_SIZE = 100
# Streams end after this long; EventSource reconnects, which re-checks the session.
STREAM_MAX_SECONDS = 15 * 60
PING_SECONDS = 15
RESYNC: dict[str, Any] = {"type": "core.resync", "data": {}}


class Broadcaster:
    def __init__(self, queue_size: int = QUEUE_SIZE) -> None:
        self._queue_size = queue_size
        self._listeners: defaultdict[str, set[asyncio.Queue[dict[str, Any]]]] = defaultdict(set)

    def send(self, user_id: str, message: dict[str, Any]) -> None:
        for queue in self._listeners.get(user_id, ()):
            try:
                queue.put_nowait(message)
            except asyncio.QueueFull:
                while not queue.empty():
                    queue.get_nowait()
                queue.put_nowait(RESYNC)

    @contextmanager
    def listen(self, user_id: str) -> Generator[asyncio.Queue[dict[str, Any]]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(self._queue_size)
        self._listeners[user_id].add(queue)
        try:
            yield queue
        finally:
            self._listeners[user_id].discard(queue)
            if not self._listeners[user_id]:
                del self._listeners[user_id]


async def stream(
    broadcaster: Broadcaster, user_id: str, max_seconds: float = STREAM_MAX_SECONDS
) -> AsyncIterator[dict[str, str]]:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + max_seconds
    with broadcaster.listen(user_id) as queue:
        while (remaining := deadline - loop.time()) > 0:
            try:
                message = await asyncio.wait_for(queue.get(), remaining)
            except TimeoutError:
                return
            yield {"data": json.dumps(message, separators=(",", ":"))}


router = APIRouter()


# Not in the OpenAPI schema: the generated client does not cover SSE (see web `lib/api-extras.ts`).
@router.get("/events/stream", include_in_schema=False)
async def events_stream(
    request: Request, ctx: Annotated[Ctx, Depends(get_ctx)]
) -> EventSourceResponse:
    user_id = ctx.user_id
    # Release the database connection; the stream can stay open for minutes.
    await ctx.db.close()
    broadcaster: Broadcaster = request.app.state.realtime
    return EventSourceResponse(stream(broadcaster, user_id, STREAM_MAX_SECONDS), ping=PING_SECONDS)
