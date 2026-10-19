"""Uploaded avatars: validated, cropped to a square and re-encoded as WebP before storage."""

import io
import re
from collections.abc import AsyncIterator

import anyio
from PIL import Image, ImageOps, UnidentifiedImageError
from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.core.storage import get_storage, user_key

MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_SOURCE_PIXELS = 40_000_000
OUTPUT_SIZE = 256
OUTPUT_QUALITY = 85
ALLOWED_FORMATS = {"PNG", "JPEG", "WEBP"}

URL_PREFIX = "/account/avatars/"
_URL = re.compile(rf"{re.escape(URL_PREFIX)}(?P<user>[A-Za-z0-9_-]+)/(?P<version>[A-Za-z0-9_-]+)")


def _encode(raw: bytes) -> bytes:
    try:
        with Image.open(io.BytesIO(raw)) as probe:
            if probe.format not in ALLOWED_FORMATS:
                raise AppError("auth.avatar_invalid", 415)
            if probe.width * probe.height > MAX_SOURCE_PIXELS:
                raise AppError("auth.avatar_invalid", 413)
            image = ImageOps.exif_transpose(probe)
            image.load()
    except UnidentifiedImageError, OSError, Image.DecompressionBombError:
        raise AppError("auth.avatar_invalid", 415) from None
    image = ImageOps.fit(
        image.convert("RGBA"), (OUTPUT_SIZE, OUTPUT_SIZE), Image.Resampling.LANCZOS
    )
    out = io.BytesIO()
    image.save(out, "WEBP", quality=OUTPUT_QUALITY, method=6)
    return out.getvalue()


async def _chunks(data: bytes) -> AsyncIterator[bytes]:
    yield data


def storage_key(avatar_url: str | None) -> str | None:
    """Storage key behind a locally hosted avatar URL (None for external, e.g. Google, URLs)."""
    match = _URL.fullmatch(avatar_url or "")
    return f"users/{match['user']}/avatar/{match['version']}" if match else None


def discard_after_commit(ctx: Ctx, avatar_url: str | None) -> None:
    """Delete a replaced avatar's file only once the row no longer points at it."""
    if key := storage_key(avatar_url):
        storage = get_storage(ctx)
        ctx.after_commit.append(lambda: storage.delete(key))


async def store(ctx: Ctx, user_id: str, raw: bytes) -> str:
    """Re-encode `raw` and return the new avatar URL; the caller removes the previous one."""
    if len(raw) > MAX_UPLOAD_BYTES:
        raise AppError("auth.avatar_too_large", 413, limit_bytes=MAX_UPLOAD_BYTES)
    data = await anyio.to_thread.run_sync(_encode, raw)
    key = user_key(user_id, "avatar")
    await get_storage(ctx).put(key, _chunks(data), "image/webp")
    return f"{URL_PREFIX}{user_id}/{key.rsplit('/', 1)[1]}"


class UploadBodyLimit:
    """ASGI middleware: rejects an oversized avatar upload before multipart parsing spools it."""

    PATH = "/account/avatar"
    LIMIT = MAX_UPLOAD_BYTES + 64 * 1024  # multipart framing

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] != "POST" or scope["path"] != self.PATH:
            return await self.app(scope, receive, send)
        declared = Headers(scope=scope).get("content-length")
        if declared is not None and declared.isdigit() and int(declared) > self.LIMIT:
            return await self._reject(scope, receive, send)

        received, started = 0, False

        async def counting_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.LIMIT:
                    raise _TooLarge
            return message

        async def tracking_send(message: Message) -> None:
            nonlocal started
            started = started or message["type"] == "http.response.start"
            await send(message)

        try:
            await self.app(scope, counting_receive, tracking_send)
        except _TooLarge:
            if not started:
                await self._reject(scope, receive, send)

    async def _reject(self, scope: Scope, receive: Receive, send: Send) -> None:
        error = AppError("auth.avatar_too_large", 413, limit_bytes=MAX_UPLOAD_BYTES)
        body = {"error": {"code": error.code, "params": error.params, "request_id": None}}
        await JSONResponse(body, status_code=413, headers={"Connection": "close"})(
            scope, receive, send
        )


class _TooLarge(Exception):
    pass
