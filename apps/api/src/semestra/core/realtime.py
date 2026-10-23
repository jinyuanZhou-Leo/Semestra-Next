"""Live updates over SSE (M00 §3.8).

`GET /events/stream` pushes `{"type": ..., "data": {...}, "origin"?: ...}` for every event
concerning the signed-in user; the frontend invalidates the matching TanStack Query caches. One
process, in-memory fan-out (single VM).

Every message has an SSE id (`<log key>-<sequence>`), and the last `REPLAY_SIZE` messages of each
user are kept. A stream opens with the current id, so even a connection that received nothing
knows where it stands. A reconnecting EventSource sends `Last-Event-ID`; the stream starts with
what it missed, or with one `core.resync` (refetch everything) when that is no longer known: too
old, sent before a restart, or before the user's log was dropped for having no connection for
`KEEP_IDLE_SECONDS`. If a connection falls behind, its backlog is replaced by `core.resync` too.
"""

import asyncio
import itertools
import json
import time
import uuid
from collections import deque
from collections.abc import AsyncGenerator, Callable, Generator
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, Request
from sse_starlette import EventSourceResponse

from semestra.core.context import Ctx, get_ctx

QUEUE_SIZE = 100
REPLAY_SIZE = 200
KEEP_IDLE_SECONDS = 10 * 60
# Streams end after this long; EventSource reconnects, which re-checks the session.
STREAM_MAX_SECONDS = 15 * 60
PING_SECONDS = 15
RESYNC_TYPE = "core.resync"
# Messages that report a state: a replay needs only the latest one per value of this data field.
LATEST_ONLY = {"core.job.progress": "job_id"}

Sent = tuple[str, dict[str, Any]]  # (SSE id, message)


@dataclass
class _Log:
    """One user's messages: the open connections, and the last few for a reconnect."""

    key: str  # new for each log, so ids from a dropped one resync
    recent: deque[tuple[int, dict[str, Any]]]
    sequence: int = 0
    floor: int = 0  # the newest sequence no longer kept
    listeners: set[asyncio.Queue[Sent]] = field(default_factory=set[asyncio.Queue[Sent]])
    idle_since: float | None = None


class Broadcaster:
    def __init__(
        self,
        queue_size: int = QUEUE_SIZE,
        replay_size: int = REPLAY_SIZE,
        keep_idle_seconds: float = KEEP_IDLE_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._queue_size = queue_size
        self._replay_size = replay_size
        self._keep_idle = keep_idle_seconds
        self._clock = clock
        self._epoch = uuid.uuid4().hex[:8]
        self._generations = itertools.count(1)
        self._logs: dict[str, _Log] = {}
        self._next_prune = 0.0

    def _log(self, user_id: str) -> _Log:
        log = self._logs.get(user_id)
        if log is None:
            key = f"{self._epoch}.{next(self._generations)}"
            log = _Log(key, deque(maxlen=self._replay_size), idle_since=self._clock())
            self._logs[user_id] = log
        return log

    def _prune(self) -> None:
        """Drops the logs of users without a connection for `KEEP_IDLE_SECONDS`."""
        now = self._clock()
        if now < self._next_prune:
            return
        self._next_prune = now + self._keep_idle / 10
        cutoff = now - self._keep_idle
        for user_id, log in list(self._logs.items()):
            if log.idle_since is not None and log.idle_since < cutoff:
                del self._logs[user_id]

    @staticmethod
    def _id(log: _Log, sequence: int) -> str:
        return f"{log.key}-{sequence}"

    def _resync(self, log: _Log) -> Sent:
        return self._id(log, log.sequence), {"type": RESYNC_TYPE, "data": {}}

    def current_id(self, user_id: str) -> str:
        log = self._log(user_id)
        return self._id(log, log.sequence)

    def send(self, user_id: str, message: dict[str, Any]) -> None:
        self._prune()
        log = self._log(user_id)
        log.sequence += 1
        if (field_name := LATEST_ONLY.get(message["type"])) is not None:
            value = message["data"].get(field_name)
            for item in [
                i
                for i in log.recent
                if i[1]["type"] == message["type"] and i[1]["data"].get(field_name) == value
            ]:
                log.recent.remove(item)
        if len(log.recent) == log.recent.maxlen:
            log.floor = log.recent[0][0]
        log.recent.append((log.sequence, message))
        for queue in log.listeners:
            try:
                queue.put_nowait((self._id(log, log.sequence), message))
            except asyncio.QueueFull:
                while not queue.empty():
                    queue.get_nowait()
                queue.put_nowait(self._resync(log))

    def missed(self, user_id: str, last_event_id: str | None) -> list[Sent]:
        """What a client that last saw `last_event_id` missed (nothing for a new connection)."""
        if last_event_id is None:
            return []
        log = self._log(user_id)
        key, _, number = last_event_id.rpartition("-")
        if key != log.key or not number.isdigit() or not log.floor <= int(number) <= log.sequence:
            return [self._resync(log)]
        last = int(number)
        return [(self._id(log, n), m) for n, m in log.recent if n > last]

    @contextmanager
    def listen(
        self, user_id: str, last_event_id: str | None = None
    ) -> Generator[asyncio.Queue[Sent]]:
        self._prune()
        log = self._log(user_id)
        queue: asyncio.Queue[Sent] = asyncio.Queue(self._queue_size)
        backlog = self.missed(user_id, last_event_id)
        for item in backlog if len(backlog) <= self._queue_size else [self._resync(log)]:
            queue.put_nowait(item)
        log.listeners.add(queue)
        log.idle_since = None
        try:
            yield queue
        finally:
            log.listeners.discard(queue)
            if not log.listeners:
                log.idle_since = self._clock()


async def stream(
    broadcaster: Broadcaster,
    user_id: str,
    max_seconds: float = STREAM_MAX_SECONDS,
    last_event_id: str | None = None,
) -> AsyncGenerator[dict[str, str]]:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + max_seconds
    with broadcaster.listen(user_id, last_event_id) as queue:
        if queue.empty():
            # An id without data sets the EventSource's last id without firing a message.
            yield {"id": broadcaster.current_id(user_id)}
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
