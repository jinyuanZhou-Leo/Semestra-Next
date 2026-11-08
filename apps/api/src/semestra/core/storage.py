"""File storage (M00 §3.9).

Modules store bytes through `get_storage(ctx)` under keys from `user_key(user_id, module)` and keep
their own metadata rows. Each module that stores files registers a usage counter with
`@storage_usage_provider("<module>")`; the user quota is the sum.

A user upload goes through the same three steps everywhere:

1. `stage(ctx, key, stream, ...)` streams it into storage, cut off above the per-file cap or the
   quota left, before any database write (so no SQLite write lock is held while bytes arrive);
2. the caller inserts its row(s) inside `discard_on_error(ctx, keys)` and calls `charge(ctx)`,
   which counts the quota again under the write lock the insert took, so racing uploads cannot
   both pass;
3. objects a transaction stops referring to go with `delete_after_commit(ctx, keys)`.
"""

import hashlib
import re
import shutil
import uuid
from collections.abc import (
    AsyncGenerator,
    AsyncIterable,
    AsyncIterator,
    Awaitable,
    Callable,
    Iterable,
)
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import anyio
from pydantic import BaseModel, Field

from semestra.core.capability import Http, NoInput, capability
from semestra.core.context import Ctx
from semestra.core.db import new_id
from semestra.core.errors import AppError, not_found

CHUNK_SIZE = 64 * 1024
_KEY = re.compile(r"[A-Za-z0-9_-][A-Za-z0-9._-]*(/[A-Za-z0-9_-][A-Za-z0-9._-]*)*")


@dataclass(frozen=True)
class StoredObject:
    key: str
    size: int
    sha256: str


class Storage(Protocol):
    async def put(
        self,
        key: str,
        stream: AsyncIterable[bytes],
        content_type: str,
        *,
        max_bytes: int | None = None,
    ) -> StoredObject: ...

    def open(
        self, key: str, *, start: int = 0, length: int | None = None
    ) -> AsyncIterator[bytes]: ...

    async def delete(self, key: str) -> None: ...

    async def exists(self, key: str) -> bool: ...

    async def delete_prefix(self, prefix: str) -> None:
        """Deletes every object under `prefix/` (account deletion removes `users/<id>`)."""
        ...


def user_key(user_id: str, module: str) -> str:
    """`users/<user_id>/<module>/<uuid>`: the key layout every module uses."""
    return f"users/{user_id}/{module}/{new_id()}"


class LocalStorage:
    """Files under one root directory. Writes go to a temp file and are renamed into place."""

    def __init__(self, root: Path) -> None:
        self.root = root

    def _path(self, key: str) -> Path:
        if not _KEY.fullmatch(key):
            raise ValueError(f"invalid storage key {key!r}")
        return self.root / key

    async def put(
        self,
        key: str,
        stream: AsyncIterable[bytes],
        content_type: str,
        *,
        max_bytes: int | None = None,
    ) -> StoredObject:
        del content_type  # the local backend keeps no metadata; modules store it themselves
        path = self._path(key)
        await anyio.Path(path.parent).mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.part")
        digest, size = hashlib.sha256(), 0
        try:
            async with await anyio.open_file(tmp, "wb") as out:
                async for chunk in stream:
                    size += len(chunk)
                    if max_bytes is not None and size > max_bytes:
                        raise AppError("common.quota_exceeded", 413, limit_bytes=max_bytes)
                    digest.update(chunk)
                    await out.write(chunk)
            await anyio.Path(tmp).replace(path)
        finally:
            await anyio.Path(tmp).unlink(missing_ok=True)
        return StoredObject(key, size, digest.hexdigest())

    async def open(
        self, key: str, *, start: int = 0, length: int | None = None
    ) -> AsyncIterator[bytes]:
        """The object's bytes, optionally only `length` bytes from offset `start` (HTTP Range)."""
        path = self._path(key)
        try:
            source = await anyio.open_file(path, "rb")
        except FileNotFoundError:
            raise not_found() from None
        async with source:
            if start:
                await source.seek(start)
            remaining = length
            while remaining is None or remaining > 0:
                size = CHUNK_SIZE if remaining is None else min(CHUNK_SIZE, remaining)
                chunk = await source.read(size)
                if not chunk:
                    break
                if remaining is not None:
                    remaining -= len(chunk)
                yield chunk

    async def delete(self, key: str) -> None:
        await anyio.Path(self._path(key)).unlink(missing_ok=True)

    async def exists(self, key: str) -> bool:
        return await anyio.Path(self._path(key)).is_file()

    async def delete_prefix(self, prefix: str) -> None:
        path = self._path(prefix.rstrip("/"))
        await anyio.to_thread.run_sync(lambda: shutil.rmtree(path, ignore_errors=True))


def get_storage(ctx: Ctx) -> Storage:
    return ctx.state.storage


# --- quota ----------------------------------------------------------------------------------

UsageProvider = Callable[[Ctx], Awaitable[int]]
_usage_providers: dict[str, UsageProvider] = {}


def storage_usage_provider(module: str) -> Callable[[UsageProvider], UsageProvider]:
    """Register `async def (ctx) -> bytes used by ctx.user in this module`."""

    def decorate(fn: UsageProvider) -> UsageProvider:
        if module in _usage_providers:
            raise ValueError(f"duplicate storage usage provider {module!r}")
        _usage_providers[module] = fn
        return fn

    return decorate


class StorageUsage(BaseModel):
    used_bytes: int
    quota_bytes: int = Field(description="0 means unlimited.")
    by_module: dict[str, int]


async def usage(ctx: Ctx) -> StorageUsage:
    by_module = {name: await fn(ctx) for name, fn in sorted(_usage_providers.items())}
    return StorageUsage(
        used_bytes=sum(by_module.values()),
        quota_bytes=ctx.settings.user_storage_quota_bytes,
        by_module=by_module,
    )


def _quota_error(current: StorageUsage) -> AppError:
    return AppError(
        "common.quota_exceeded", 413, used=current.used_bytes, quota=current.quota_bytes
    )


async def remaining_quota(ctx: Ctx) -> int | None:
    """Bytes the user may still store (None = unlimited); use it to bound `max_bytes`."""
    current = await usage(ctx)
    if current.quota_bytes == 0:
        return None
    return max(0, current.quota_bytes - current.used_bytes)


# --- uploads --------------------------------------------------------------------------------


@dataclass(frozen=True)
class Staged:
    """An upload already in storage and not yet in the database. `data` holds its bytes when
    `stage(..., keep=True)` (for type detection or parsing); otherwise it is empty."""

    stored: StoredObject
    data: bytes

    @property
    def key(self) -> str:
        return self.stored.key


async def stage(
    ctx: Ctx,
    key: str,
    stream: AsyncIterable[bytes],
    *,
    cap: int,
    too_large: AppError,
    quota: bool = True,
    reserved: int = 0,
    keep: bool = False,
    content_type: str = "application/octet-stream",
) -> Staged:
    """Streams an upload into storage under `key`, refused with `too_large` above `cap` bytes,
    or with `common.quota_exceeded` above the quota left when `quota` is set (`reserved`: bytes
    this request already staged). Writes nothing to the database; the caller inserts its row
    with `discard_on_error` and then calls `charge`."""
    current = await usage(ctx) if quota else None
    budget = None
    if current is not None and current.quota_bytes > 0:
        budget = max(0, current.quota_bytes - current.used_bytes - reserved)
        if budget == 0:
            raise _quota_error(current)
    limit = cap if budget is None else min(cap, budget)
    seen = bytearray()

    async def kept() -> AsyncIterator[bytes]:
        async for chunk in stream:
            seen.extend(chunk)
            yield chunk

    try:
        stored = await get_storage(ctx).put(
            key, kept() if keep else stream, content_type, max_bytes=limit
        )
    except AppError as exc:
        if exc.code != "common.quota_exceeded":
            raise
        if current is None or budget is None or cap <= budget:
            raise too_large from None
        raise _quota_error(current) from None
    return Staged(stored, bytes(seen))


async def charge(ctx: Ctx) -> None:
    """Checks the quota with the caller's new rows counted. The insert took SQLite's write
    lock, so two uploads racing for the last free bytes are decided one after the other."""
    await ctx.db.flush()
    current = await usage(ctx)
    if current.quota_bytes > 0 and current.used_bytes > current.quota_bytes:
        raise _quota_error(current)


@asynccontextmanager
async def discard_on_error(ctx: Ctx, keys: Iterable[str]) -> AsyncGenerator[None]:
    """Deletes staged objects if the block fails, so a refused upload leaves nothing behind."""
    try:
        yield
    except BaseException:
        storage = get_storage(ctx)
        for key in keys:
            await storage.delete(key)
        raise


def delete_after_commit(ctx: Ctx, keys: Iterable[str | None]) -> None:
    """Deletes objects once the transaction has committed, so a rollback never loses one
    (`None` keys, rows without an object, are skipped)."""
    pending = [key for key in keys if key]
    if not pending:
        return
    storage = get_storage(ctx)

    async def remove() -> None:
        for key in pending:
            await storage.delete(key)

    ctx.after_commit.append(remove)


@capability(
    name="core.storage.get",
    summary="Get how much file storage the user has used and their quota.",
    description="""Use when the user asks how much space their files take or why an upload was
rejected for exceeding the quota.""",
    effect="read",
    http=Http("GET", "/storage/usage"),
    tags=("storage",),
)
async def storage_usage(ctx: Ctx, inp: NoInput) -> StorageUsage:
    return await usage(ctx)
