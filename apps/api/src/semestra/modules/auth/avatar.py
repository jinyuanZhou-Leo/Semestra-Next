"""Uploaded avatars: validated, cropped to a square and re-encoded as WebP before storage."""

import io
import re
from collections.abc import AsyncIterator

import anyio
from PIL import Image, ImageOps, UnidentifiedImageError

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.core.storage import get_storage, user_key

MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_SOURCE_PIXELS = 40_000_000
OUTPUT_SIZE = 256
OUTPUT_QUALITY = 85
ALLOWED_FORMATS = {"PNG", "JPEG", "WEBP"}

URL_PREFIX = "/account/avatars/"
_URL = re.compile(rf"{re.escape(URL_PREFIX)}(?P<user>[\w-]+)/(?P<version>[\w-]+)")


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


async def discard(ctx: Ctx, avatar_url: str | None) -> None:
    if key := storage_key(avatar_url):
        await get_storage(ctx).delete(key)


async def store(ctx: Ctx, user_id: str, raw: bytes) -> str:
    """Re-encode `raw` and return the new avatar URL; the caller removes the previous one."""
    if len(raw) > MAX_UPLOAD_BYTES:
        raise AppError("auth.avatar_too_large", 413, limit_bytes=MAX_UPLOAD_BYTES)
    data = await anyio.to_thread.run_sync(_encode, raw)
    key = user_key(user_id, "avatar")
    await get_storage(ctx).put(key, _chunks(data), "image/webp")
    return f"{URL_PREFIX}{user_id}/{key.rsplit('/', 1)[1]}"
