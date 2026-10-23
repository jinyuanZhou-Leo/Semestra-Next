"""Refusing an upload body that is too big before multipart parsing spools it to disk.

Starlette writes every uploaded file to a temporary file before the route runs, so a size check
in the route comes after the disk has been filled. `BodyLimit` answers 413 as soon as the
declared or received body passes the limit of the route it matches.
"""

import re
from collections.abc import Callable

from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from semestra.core.config import Settings
from semestra.core.errors import AppError

FRAMING_BYTES = 64 * 1024  # multipart boundaries and part headers

# The largest body a route accepts (without framing) and the error to answer with.
Limit = Callable[[Settings], tuple[int, AppError]]


class BodyLimit:
    """ASGI middleware for POST routes whose path matches `path` (full match)."""

    def __init__(self, app: ASGIApp, *, path: re.Pattern[str], limit: Limit) -> None:
        self.app = app
        self.path = path
        self.limit = limit

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] != "http"
            or scope["method"] != "POST"
            or not self.path.fullmatch(scope["path"])
        ):
            return await self.app(scope, receive, send)
        limit, error = self.limit(scope["app"].state.settings)
        limit += FRAMING_BYTES
        declared = Headers(scope=scope).get("content-length")
        if declared is not None and declared.isdigit() and int(declared) > limit:
            return await _reject(scope, receive, send, error)

        received, rejected = 0, False

        async def counting_receive() -> Message:
            nonlocal received, rejected
            message = await receive()
            if message["type"] == "http.request" and not rejected:
                received += len(message.get("body", b""))
                if received > limit:
                    rejected = True
                    await _reject(scope, receive, send, error)
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


async def _reject(scope: Scope, receive: Receive, send: Send, error: AppError) -> None:
    request_id = scope.get("state", {}).get("request_id")
    body = {"error": {"code": error.code, "params": error.params, "request_id": request_id}}
    await JSONResponse(body, status_code=413, headers={"Connection": "close"})(scope, receive, send)
