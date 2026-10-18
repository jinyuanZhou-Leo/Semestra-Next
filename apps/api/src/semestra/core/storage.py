"""File storage (M00 §3.9).

Modules store bytes through `get_storage(ctx)` under keys from `user_key(user_id, module)` and keep
their own metadata rows. Uploads are streamed: `put(..., max_bytes=...)` counts while writing and
aborts with `common.quota_exceeded` as soon as the limit is passed. Each module that stores files
registers a usage counter with `@storage_usage_provider("<module>")`; the user quota is the sum.
"""

import hashlib
import re
import uuid
from collections.abc import AsyncIterable, AsyncIterator, Awaitable, Callable
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

    def open(self, key: str) -> AsyncIterator[bytes]: ...

    async def delete(self, key: str) -> None: ...

    async def exists(self, key: str) -> bool: ...


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

    async def open(self, key: str) -> AsyncIterator[bytes]:
        path = self._path(key)
        try:
            source = await anyio.open_file(path, "rb")
        except FileNotFoundError:
            raise not_found() from None
        async with source:
            while chunk := await source.read(CHUNK_SIZE):
                yield chunk

    async def delete(self, key: str) -> None:
        await anyio.Path(self._path(key)).unlink(missing_ok=True)

    async def exists(self, key: str) -> bool:
        return await anyio.Path(self._path(key)).is_file()


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


async def remaining_quota(ctx: Ctx) -> int | None:
    """Bytes the user may still store (None = unlimited); use it to bound `max_bytes`."""
    current = await usage(ctx)
    if current.quota_bytes == 0:
        return None
    return max(0, current.quota_bytes - current.used_bytes)


@capability(
    name="core.storage.usage",
    summary="Get how much file storage the user has used and their quota.",
    description="""Use when the user asks how much space their files take or why an upload was
rejected for exceeding the quota.""",
    effect="read",
    http=Http("GET", "/storage/usage"),
    tags=("storage",),
)
async def storage_usage(ctx: Ctx, inp: NoInput) -> StorageUsage:
    return await usage(ctx)
