"""Gives every HTTP request an id: kept from a valid `X-Request-ID`, else a new UUIDv7. It is
bound to the log context, stored in the scope state (`request.state.request_id`) for error
envelopes, and sent back in the `X-Request-ID` response header.

A plain ASGI middleware rather than `@app.middleware("http")`, whose `BaseHTTPMiddleware` wraps
every request, streams included, in an extra task and memory stream."""

import re
import uuid

import structlog
from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

# A caller's id is kept for tracing across proxies, but only if it looks like one: it goes into
# every log line and back out in a header.
_REQUEST_ID = re.compile(r"[A-Za-z0-9._-]{1,64}")


class RequestId:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        incoming = Headers(scope=scope).get("x-request-id", "")
        request_id = incoming if _REQUEST_ID.fullmatch(incoming) else str(uuid.uuid7())
        scope.setdefault("state", {})["request_id"] = request_id
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(request_id=request_id)

        async def send_with_id(message: Message) -> None:
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message)["x-request-id"] = request_id
            await send(message)

        await self.app(scope, receive, send_with_id)
