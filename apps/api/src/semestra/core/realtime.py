"""Live updates over SSE (M00 §3.8).

`GET /events/stream` pushes `{"type": ..., "data": {...}, "origin"?: ...}` for every event
concerning the signed-in user; the frontend invalidates the matching TanStack Query caches. One
process, in-memory fan-out (single VM).

Every message has an SSE id (`<process epoch>-<per-user sequence>`), and the last `REPLAY_SIZE`
messages of each user are kept. A reconnecting EventSource sends `Last-Event-ID`; the stream
starts with what it missed, or with one `core.resync` (refetch everything) when that is no longer
known: too old, or sent before a restart. If a connection falls behind, its backlog is replaced
by `core.resync` too.
"""

import asyncio
import json
import uuid
from collections import defaultdict, deque
from collections.abc import AsyncIterator, Generator
from contextlib import contextmanager
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, Request
from sse_starlette import EventSourceResponse

from semestra.core.context import Ctx, get_ctx

QUEUE_SIZE = 100
REPLAY_SIZE = 200
# Streams end after this long; EventSource reconnects, which re-checks the session.
STREAM_MAX_SECONDS = 15 * 60
PING_SECONDS = 15
RESYNC_TYPE = "core.resync"

Sent = tuple[str, dict[str, Any]]  # (SSE id, message)


class Broadcaster:
    def __init__(self, queue_size: int = QUEUE_SIZE, replay_size: int = REPLAY_SIZE) -> None:
        self._queue_size = queue_size
        self._replay_size = replay_size
        self._epoch = uuid.uuid4().hex[:8]
        self._listeners: defaultdict[str, set[asyncio.Queue[Sent]]] = defaultdict(set)
        self._sequence: defaultdict[str, int] = defaultdict(int)
        self._recent: dict[str, deque[tuple[int, dict[str, Any]]]] = {}

    def _id(self, sequence: int) -> str:
        return f"{self._epoch}-{sequence}"

    def _resync(self, user_id: str) -> Sent:
        return self._id(self._sequence[user_id]), {"type": RESYNC_TYPE, "data": {}}

    def send(self, user_id: str, message: dict[str, Any]) -> None:
        self._sequence[user_id] += 1
        sequence = self._sequence[user_id]
        recent = self._recent.setdefault(user_id, deque(maxlen=self._replay_size))
        recent.append((sequence, message))
        for queue in self._listeners.get(user_id, ()):
            try:
                queue.put_nowait((self._id(sequence), message))
            except asyncio.QueueFull:
                while not queue.empty():
                    queue.get_nowait()
                queue.put_nowait(self._resync(user_id))

    def missed(self, user_id: str, last_event_id: str | None) -> list[Sent]:
        """What a client that last saw `last_event_id` missed (nothing for a new connection)."""
        if last_event_id is None:
            return []
        epoch, _, number = last_event_id.partition("-")
        current = self._sequence[user_id]
        if epoch != self._epoch or not number.isdigit() or int(number) > current:
            return [self._resync(user_id)]
        last = int(number)
        recent = self._recent.get(user_id, deque())
        oldest = recent[0][0] if recent else current + 1
        if last + 1 < oldest and last < current:
            return [self._resync(user_id)]
        return [(self._id(n), m) for n, m in recent if n > last]

    @contextmanager
    def listen(
        self, user_id: str, last_event_id: str | None = None
    ) -> Generator[asyncio.Queue[Sent]]:
        queue: asyncio.Queue[Sent] = asyncio.Queue(self._queue_size)
        backlog = self.missed(user_id, last_event_id)
        for item in backlog if len(backlog) <= self._queue_size else [self._resync(user_id)]:
            queue.put_nowait(item)
        self._listeners[user_id].add(queue)
        try:
            yield queue
        finally:
            self._listeners[user_id].discard(queue)
            if not self._listeners[user_id]:
                del self._listeners[user_id]


async def stream(
    broadcaster: Broadcaster,
    user_id: str,
    max_seconds: float = STREAM_MAX_SECONDS,
    last_event_id: str | None = None,
) -> AsyncIterator[dict[str, str]]:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + max_seconds
    with broadcaster.listen(user_id, last_event_id) as queue:
        while (remaining := deadline - loop.time()) > 0:
            try:
                event_id, message = await asyncio.wait_for(queue.get(), remaining)
            except TimeoutError:
                return
            yield {"id": event_id, "data": json.dumps(message, separators=(",", ":"))}


router = APIRouter()


# Not in the OpenAPI schema: the generated client does not cover SSE (see web `lib/api-extras.ts`).
@router.get("/events/stream", include_in_schema=False)
async def events_stream(
    request: Request,
    ctx: Annotated[Ctx, Depends(get_ctx)],
    last_event_id: Annotated[str | None, Header(max_length=100)] = None,
) -> EventSourceResponse:
    user_id = ctx.user_id
    # Release the database connection; the stream can stay open for minutes.
    await ctx.db.close()
    broadcaster: Broadcaster = request.app.state.realtime
    return EventSourceResponse(
        stream(broadcaster, user_id, STREAM_MAX_SECONDS, last_event_id), ping=PING_SECONDS
    )
