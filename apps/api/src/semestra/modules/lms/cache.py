"""Read cache (M09 §2.4): in-process LRU first, then `lms_cache`, 5 minutes.

Keys are `(user, connection, method, params)`. Changing a connection's credentials or config
drops all of its entries. Payloads are JSON (the DTOs dumped), so both levels hold the same.
"""

import hashlib
import json
from collections import OrderedDict
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import delete
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from starlette.datastructures import State

from semestra.core.context import Ctx
from semestra.modules.lms.models import LmsCache

TTL = timedelta(minutes=5)
LRU_SIZE = 512


class LmsRuntime:
    """Per-app state of the module (`app.state.lms`)."""

    def __init__(self) -> None:
        self.lru: OrderedDict[str, tuple[str, datetime, Any]] = OrderedDict()

    def get(self, key: str, now: datetime) -> Any | None:
        hit = self.lru.get(key)
        if hit is None:
            return None
        if hit[1] <= now:
            del self.lru[key]
            return None
        self.lru.move_to_end(key)
        return hit[2]

    def put(self, key: str, connection_id: str, expires: datetime, payload: Any) -> None:
        self.lru[key] = (connection_id, expires, payload)
        self.lru.move_to_end(key)
        while len(self.lru) > LRU_SIZE:
            self.lru.popitem(last=False)

    def drop(self, connection_id: str) -> None:
        for key in [k for k, v in self.lru.items() if v[0] == connection_id]:
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
    rt.put(key, row.connection_id, row.expires_at, row.payload)
    return row.payload


async def put(ctx: Ctx, key: str, connection_id: str, payload: Any) -> None:
    expires = ctx.now + TTL
    runtime(ctx.state).put(key, connection_id, expires, payload)
    stmt = sqlite_insert(LmsCache).values(
        key=key,
        user_id=ctx.user_id,
        connection_id=connection_id,
        payload=payload,
        expires_at=expires,
    )
    await ctx.db.execute(
        stmt.on_conflict_do_update(
            index_elements=[LmsCache.key], set_={"payload": payload, "expires_at": expires}
        )
    )


async def drop(ctx: Ctx, key: str) -> None:
    """Forgets one entry, so the next read asks the platform (after a write changed it)."""
    runtime(ctx.state).lru.pop(key, None)
    await ctx.db.execute(delete(LmsCache).where(LmsCache.key == key))


async def drop_connection(ctx: Ctx, connection_id: str) -> None:
    runtime(ctx.state).drop(connection_id)
    await ctx.db.execute(delete(LmsCache).where(LmsCache.connection_id == connection_id))


async def purge_expired(ctx: Ctx) -> None:
    await ctx.db.execute(delete(LmsCache).where(LmsCache.expires_at <= ctx.now))
