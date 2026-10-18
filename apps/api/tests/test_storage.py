import hashlib
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from fastapi import FastAPI
from httpx import AsyncClient

from semestra.core.context import Ctx, system_ctx
from semestra.core.errors import AppError
from semestra.core.storage import LocalStorage, remaining_quota, storage_usage_provider, user_key
from semestra.testing import MakeUser


@storage_usage_provider("test")
async def _usage(ctx: Ctx) -> int:
    return 1000


async def chunks(*parts: bytes) -> AsyncIterator[bytes]:
    for part in parts:
        yield part


async def read(storage: LocalStorage, key: str) -> bytes:
    return b"".join([c async for c in storage.open(key)])


async def test_put_open_delete(tmp_path: Path):
    storage = LocalStorage(tmp_path)
    key = user_key("u1", "files")
    assert key.startswith("users/u1/files/")

    obj = await storage.put(key, chunks(b"hello ", b"world"), "text/plain")
    assert (obj.size, obj.sha256) == (11, hashlib.sha256(b"hello world").hexdigest())
    assert await storage.exists(key)
    assert await read(storage, key) == b"hello world"

    await storage.delete(key)
    await storage.delete(key)  # idempotent
    assert not await storage.exists(key)
    with pytest.raises(AppError) as exc:
        await read(storage, key)
    assert exc.value.code == "common.not_found"


async def test_put_stops_at_the_limit_and_leaves_nothing(tmp_path: Path):
    storage = LocalStorage(tmp_path)
    with pytest.raises(AppError) as exc:
        await storage.put("users/u/m/big", chunks(b"12345", b"67890"), "x", max_bytes=8)
    assert (exc.value.code, exc.value.params) == ("common.quota_exceeded", {"limit_bytes": 8})
    assert [p for p in tmp_path.rglob("*") if p.is_file()] == []  # noqa: ASYNC240


@pytest.mark.parametrize("key", ["../x", "/abs", "a//b", "a/../b", "a/.hidden", ""])
async def test_rejects_unsafe_keys(tmp_path: Path, key: str):
    with pytest.raises(ValueError, match="invalid storage key"):
        await LocalStorage(tmp_path).exists(key)


async def test_usage_sums_module_providers(
    client: AsyncClient, make_user: MakeUser, login_as: object
):
    await login_as(client, await make_user())  # pyright: ignore[reportCallIssue]
    r = await client.get("/storage/usage")
    assert r.status_code == 200
    assert r.json() == {"used_bytes": 1000, "quota_bytes": 52_428_800, "by_module": {"test": 1000}}


async def test_remaining_quota(app: FastAPI, make_user: MakeUser):
    user = await make_user()
    async with system_ctx(app.state, user.id) as ctx:
        assert await remaining_quota(ctx) == 52_428_800 - 1000
        app.state.settings.user_storage_quota_bytes = 0  # self-hosting: unlimited
        assert await remaining_quota(ctx) is None
