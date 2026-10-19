"""Limiting upload size before the body is parsed (the avatar upload does the same, M01)."""

import re

from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from semestra.core.errors import AppError

MAX_FILES_PER_REQUEST = 10
FRAMING_BYTES = 64 * 1024
_PATH = re.compile(r"/courses/[^/]+/files")


class UploadBodyLimit:
    """ASGI middleware: answers 413 `files.too_large` for a request body that cannot be a valid
    upload, before multipart parsing spools it to disk."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] != "http"
            or scope["method"] != "POST"
            or not _PATH.fullmatch(scope["path"])
        ):
            return await self.app(scope, receive, send)
        per_file = scope["app"].state.settings.files_max_upload_bytes
        limit = per_file * MAX_FILES_PER_REQUEST + FRAMING_BYTES
        declared = Headers(scope=scope).get("content-length")
        if declared is not None and declared.isdigit() and int(declared) > limit:
            return await self._reject(scope, receive, send, per_file)

        received, rejected = 0, False

        async def counting_receive() -> Message:
            nonlocal received, rejected
            message = await receive()
            if message["type"] == "http.request" and not rejected:
                received += len(message.get("body", b""))
                if received > limit:
                    rejected = True
                    await self._reject(scope, receive, send, per_file)
                    return {"type": "http.disconnect"}
            return message

        async def tracking_send(message: Message) -> None:
            if not rejected:
                await send(message)

        try:
            await self.app(scope, counting_receive, tracking_send)
        except Exception:
            if not rejected:
                raise

    async def _reject(self, scope: Scope, receive: Receive, send: Send, per_file: int) -> None:
        error = AppError("files.too_large", 413, max=per_file)
        request_id = scope.get("state", {}).get("request_id")
        body = {"error": {"code": error.code, "params": error.params, "request_id": request_id}}
        await JSONResponse(body, status_code=413, headers={"Connection": "close"})(
            scope, receive, send
        )
