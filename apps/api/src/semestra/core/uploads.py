"""Limiting upload size before the body is parsed.

FastAPI parses a multipart body into a spooled temporary file before the route runs, so a size
check in the route comes after the whole upload is on disk. `UploadBodyLimit` counts the body as
it arrives and answers 413 as soon as it passes the limit of its path. Modules declare their
upload routes with `limit_upload`; `main.py` installs the middleware once.
"""

import re
from collections.abc import Callable
from dataclasses import dataclass

from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from semestra.core.config import Settings
from semestra.core.errors import AppError

FRAMING_BYTES = 64 * 1024  # multipart boundaries and part headers

# The largest acceptable upload in bytes (without framing) and the error past it.
LimitFn = Callable[[Settings], tuple[int, AppError]]


@dataclass(frozen=True)
class _Rule:
    path: re.Pattern[str]
    limit: LimitFn


_rules: list[_Rule] = []


def limit_upload(path: str, limit: LimitFn) -> None:
    """Bounds POST bodies to paths matching the regular expression `path` (whole path)."""
    _rules.append(_Rule(re.compile(path), limit))


def _rule_for(path: str) -> _Rule | None:
    return next((r for r in _rules if r.path.fullmatch(path)), None)


class UploadBodyLimit:
    """ASGI middleware enforcing the `limit_upload` rules."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        rule = (
            _rule_for(scope["path"])
            if scope["type"] == "http" and scope["method"] == "POST"
            else None
        )
        if rule is None:
            return await self.app(scope, receive, send)
        content, error = rule.limit(scope["app"].state.settings)
        limit = content + FRAMING_BYTES
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
                    # Answer here: an exception would be rewritten by the body parser downstream.
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
