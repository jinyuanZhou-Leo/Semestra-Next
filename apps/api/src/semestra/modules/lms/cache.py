"""Read cache of the live reads (M09 §2.4): in process only, 5 minutes by default. What the app
keeps of a course (assignments, announcements, calendar, materials) is in its own tables, written
by the sync; this only spares the platform repeated live reads (pages, modules, previews).

Keys are `(user, connection, method, params)`. Changing a connection's credentials or config
drops all of its entries; an entry may also carry a `scope` (`course:<external id>`), so one
course's reads can be dropped together ("Refresh" in the Canvas tab). Payloads are JSON (the
DTOs dumped).
"""

import asyncio
import hashlib
import json
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from cachetools import LRUCache
from pydantic import BaseModel
from starlette.datastructures import State

from semestra.core.context import Ctx

TTL = timedelta(minutes=5)
# The in-process level is bounded by size, not count: one file preview can be megabytes.
LRU_BYTES = 64 * 1024 * 1024


def course_scope(external_course_id: str) -> str:
    return f"course:{external_course_id}"


@dataclass(frozen=True, slots=True)
class Entry:
    connection_id: str
    scope: str | None
    expires: datetime
    payload: Any
    size: int


def _size(entry: Entry) -> int:
    return entry.size


class LmsRuntime:
    """Per-app state of the module (`app.state.lms`)."""

    def __init__(self) -> None:
        self.lru: LRUCache[str, Entry] = LRUCache(maxsize=LRU_BYTES, getsizeof=_size)
        # Renewed sign-in credentials (`service.fresh`) until they are stored, by connection,
        # with the stored credentials they replace: new ones saved by the user win.
        self._renewed: dict[str, tuple[str | None, BaseModel]] = {}
        self._renewal_locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

    def renewed(self, connection_id: str, stored: str | None) -> BaseModel | None:
        hit = self._renewed.get(connection_id)
        return hit[1] if hit is not None and hit[0] == stored else None

    def renew(self, connection_id: str, replaces: str | None, creds: BaseModel) -> None:
        self._renewed[connection_id] = (replaces, creds)

    def renewal_lock(self, connection_id: str) -> asyncio.Lock:
        """One renewal at a time per connection; the others use its result."""
        return self._renewal_locks[connection_id]

    def get(self, key: str, now: datetime) -> Any | None:
        hit = self.lru.get(key)
        if hit is None:
            return None
        if hit.expires <= now:
            del self.lru[key]
            return None
        return hit.payload

    def put(
        self, key: str, connection_id: str, scope: str | None, expires: datetime, payload: Any
    ) -> None:
        size = len(json.dumps(payload, default=str))
        if size > LRU_BYTES:
            self.lru.pop(key, None)  # too big to keep: read again next time
            return
        self.lru[key] = Entry(connection_id, scope, expires, payload, size)

    def drop(self, connection_id: str, scope: str | None = None) -> None:
        for key in [
            k
            for k, e in self.lru.items()
            if e.connection_id == connection_id and (scope is None or e.scope == scope)
        ]:
            del self.lru[key]


def runtime(state: State) -> LmsRuntime:
    rt = getattr(state, "lms", None)
    if rt is None:
        rt = LmsRuntime()
        state.lms = rt
    return rt


def cache_key(user_id: str, connection_id: str, method: str, params: dict[str, Any]) -> str:
    raw = json.dumps([user_id, connection_id, method, params], sort_keys=True, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()


def get(ctx: Ctx, key: str) -> Any | None:
    return runtime(ctx.state).get(key, ctx.now)


def put(
    ctx: Ctx,
    key: str,
    connection_id: str,
    payload: Any,
    *,
    scope: str | None = None,
    ttl: timedelta = TTL,
) -> None:
    runtime(ctx.state).put(key, connection_id, scope, ctx.now + ttl, payload)


def drop(ctx: Ctx, key: str) -> None:
    """Forgets one entry, so the next read asks the platform (after a write changed it)."""
    runtime(ctx.state).lru.pop(key, None)


def drop_scope(ctx: Ctx, connection_id: str, scope: str) -> None:
    runtime(ctx.state).drop(connection_id, scope)


def drop_connection(ctx: Ctx, connection_id: str) -> None:
    runtime(ctx.state).drop(connection_id)
