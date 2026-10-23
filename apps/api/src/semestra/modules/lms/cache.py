"""Read cache (M09 §2.4): in-process LRU first, then `lms_cache`, 5 minutes by default.

Keys are `(user, connection, method, params)`. Changing a connection's credentials or config
drops all of its entries; an entry may also carry a `scope` (`course:<external id>`), so one
course's reads can be dropped together ("Refresh" in the Canvas tab). Payloads are JSON (the
DTOs dumped), so both levels hold the same.

Reads never write in the request's transaction: SQLite allows one writer, and a read that
holds the write lock while it waits on the platform (a file preview downloads and parses for up
to a minute) would make every other write in the app time out. The second level is written
after the request commits, in a short transaction of its own.
"""

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

import structlog
from cachetools import LRUCache
from sqlalchemy import delete
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from starlette.datastructures import State

from semestra.core.context import Ctx, system_ctx
from semestra.modules.lms.models import LmsCache

log = structlog.get_logger()

TTL = timedelta(minutes=5)
# The in-process level is bounded by size, not count: one file preview can be megabytes.
LRU_BYTES = 64 * 1024 * 1024


# The calendar overlay mixes a connection's courses; a course refresh drops it too.
CALENDAR_SCOPE = "calendar"


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
            self.lru.pop(key, None)  # too big for memory: the second level still holds it
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


async def get(ctx: Ctx, key: str) -> Any | None:
    rt = runtime(ctx.state)
    hit = rt.get(key, ctx.now)
    if hit is not None:
        return hit
    row = await ctx.db.get(LmsCache, key)
    if row is None or row.user_id != ctx.user_id or row.expires_at <= ctx.now:
        return None
    rt.put(key, row.connection_id, row.scope, row.expires_at, row.payload)
    return row.payload


async def put(
    ctx: Ctx,
    key: str,
    connection_id: str,
    payload: Any,
    *,
    scope: str | None = None,
    ttl: timedelta = TTL,
) -> None:
    """Memory now; `lms_cache` once the request has committed (see the module docstring)."""
    expires = ctx.now + ttl
    runtime(ctx.state).put(key, connection_id, scope, expires, payload)
    state, user_id = ctx.state, ctx.user_id

    async def _store() -> None:
        try:
            async with system_ctx(state) as sys:
                stmt = sqlite_insert(LmsCache).values(
                    key=key,
                    user_id=user_id,
                    connection_id=connection_id,
                    scope=scope,
                    payload=payload,
                    expires_at=expires,
                )
                await sys.db.execute(
                    stmt.on_conflict_do_update(
                        index_elements=[LmsCache.key],
                        set_={"payload": payload, "expires_at": expires, "scope": scope},
                    )
                )
                await sys.db.commit()
        except Exception:
            # The connection may be gone by now (deleted meanwhile): memory still has it.
            log.warning("lms_cache_store_failed", exc_info=True)

    ctx.after_commit.append(_store)


async def drop(ctx: Ctx, key: str) -> None:
    """Forgets one entry, so the next read asks the platform (after a write changed it)."""
    runtime(ctx.state).lru.pop(key, None)
    await ctx.db.execute(delete(LmsCache).where(LmsCache.key == key))


async def drop_scope(ctx: Ctx, connection_id: str, scope: str) -> None:
    runtime(ctx.state).drop(connection_id, scope)
    await ctx.db.execute(
        delete(LmsCache).where(LmsCache.connection_id == connection_id, LmsCache.scope == scope)
    )


async def drop_connection(ctx: Ctx, connection_id: str) -> None:
    runtime(ctx.state).drop(connection_id)
    await ctx.db.execute(delete(LmsCache).where(LmsCache.connection_id == connection_id))


async def purge_expired(ctx: Ctx) -> None:
    await ctx.db.execute(delete(LmsCache).where(LmsCache.expires_at <= ctx.now))
