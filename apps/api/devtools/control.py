"""What the fake servers share: injected faults and a request log, both driven over HTTP under
`/_fake/` (or `python -m devtools fake …`).

    POST   /_fake/faults    {"kind": "rate_limit", "path": "/files", "times": 3}
    GET    /_fake/faults
    DELETE /_fake/faults
    GET    /_fake/requests  counts per route ("GET /api/v1/courses/{id}/files")
    DELETE /_fake/requests

A fault applies to requests whose path matches `path` (a regular expression searched in the path,
default every request), on every `every`-th matching request, `times` times (default: until
cleared). Kinds:

    rate_limit    429 with Retry-After (`retry_after`, default 2); `style: "403"` sends Canvas's
                  403 "Rate Limit Exceeded" with X-Rate-Limit-Remaining: 0 instead
    unauthorized  401 (Canvas adds WWW-Authenticate: Bearer: an expired or revoked token)
    payment       402 (an AI key out of credit)
    server_error  500
    slow          answers normally after `delay` seconds (default 5)
    drop          starts the answer and cuts it off: the client sees a broken connection
"""

import asyncio
import json
import re
from collections import Counter
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from typing import Any, Literal

from starlette.types import ASGIApp, Message, Receive, Scope, Send

FaultKind = Literal["rate_limit", "unauthorized", "payment", "server_error", "slow", "drop"]
KINDS: tuple[str, ...] = FaultKind.__args__  # pyright: ignore[reportAttributeAccessIssue]
# An error body in the faked service's own format, from the status and a message.
ErrorBody = Callable[[int, str], dict[str, Any]]


@dataclass
class Fault:
    kind: FaultKind
    path: str = ""
    times: int | None = None
    every: int = 1
    delay: float = 5.0
    retry_after: int = 2
    style: str = ""
    seen: int = field(default=0, repr=False)

    def matches(self, path: str) -> bool:
        if self.times == 0 or not re.search(self.path, path):
            return False
        self.seen += 1
        if self.seen % max(self.every, 1):
            return False
        if self.times is not None:
            self.times -= 1
        return True


@dataclass
class Control:
    faults: list[Fault] = field(default_factory=list)
    requests: Counter[str] = field(default_factory=Counter)
    statuses: Counter[int] = field(default_factory=Counter)

    def add(self, raw: dict[str, Any]) -> Fault:
        if raw.get("kind") not in KINDS:
            raise ValueError(f"kind must be one of {', '.join(KINDS)}")
        fault = Fault(**{k: v for k, v in raw.items() if k in Fault.__dataclass_fields__})
        re.compile(fault.path)
        self.faults.append(fault)
        return fault

    def pick(self, path: str) -> Fault | None:
        return next((f for f in self.faults if f.matches(path)), None)


def route_of(method: str, path: str) -> str:
    """The route a request hit, ids replaced: "GET /api/v1/courses/{id}/files"."""
    return f"{method} {re.sub(r'/\d+(?=/|$)', '/{id}', path)}"


async def _json(send: Send, status: int, body: Any, headers: dict[str, str] | None = None) -> None:
    data = json.dumps(body).encode()
    raw = [(b"content-type", b"application/json"), (b"content-length", str(len(data)).encode())]
    raw += [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()]
    await send({"type": "http.response.start", "status": status, "headers": raw})
    await send({"type": "http.response.body", "body": data})


async def _body(receive: Receive) -> bytes:
    chunks = []
    while True:
        message = await receive()
        chunks.append(message.get("body", b""))
        if not message.get("more_body"):
            return b"".join(chunks)


class ControlMiddleware:
    """Serves `/_fake/*`, logs every other request and applies the faults."""

    def __init__(self, app: ASGIApp, control: Control, error_body: ErrorBody, *, canvas: bool):
        self.app = app
        self.control = control
        self.error_body = error_body
        self.canvas = canvas

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path: str = scope["path"]
        method: str = scope["method"]
        if path.startswith("/_fake/"):
            # The app's own controls (the fake Canvas's `/_fake/changes`) go through untouched.
            if not await self._control(path, method, receive, send):
                await self.app(scope, receive, send)
            return
        self.control.requests[route_of(method, path)] += 1
        fault = self.control.pick(path)
        if fault is None:
            await self.app(scope, receive, self._counting(send))
            return
        await self._fail(fault, scope, receive, send)

    def _counting(self, send: Send) -> Send:
        async def wrapped(message: Message) -> None:
            if message["type"] == "http.response.start":
                self.control.statuses[message["status"]] += 1
            await send(message)

        return wrapped

    async def _fail(self, fault: Fault, scope: Scope, receive: Receive, send: Send) -> None:
        match fault.kind:
            case "slow":
                await asyncio.sleep(fault.delay)
                await self.app(scope, receive, self._counting(send))
                return
            case "drop":
                self.control.statuses[0] += 1
                await send(
                    {
                        "type": "http.response.start",
                        "status": 200,
                        "headers": [(b"content-length", b"1000")],
                    }
                )
                await send({"type": "http.response.body", "body": b"{", "more_body": False})
                return
            case "rate_limit" if fault.style == "403":
                status, headers = 403, {"X-Rate-Limit-Remaining": "0"}
                body: Any = "403 Forbidden (Rate Limit Exceeded)"
            case "rate_limit":
                status, headers = 429, {"Retry-After": str(fault.retry_after)}
                body = self.error_body(429, "Rate limit exceeded")
            case "unauthorized":
                status = 401
                headers = {"WWW-Authenticate": 'Bearer realm="canvas-lms"'} if self.canvas else {}
                body = self.error_body(401, "Invalid access token.")
            case "payment":
                status, headers = 402, {}
                body = self.error_body(402, "Your credit balance is too low.")
            case "server_error":
                status, headers = 500, {}
                body = self.error_body(500, "Internal server error")
        self.control.statuses[status] += 1
        if isinstance(body, str):
            data = body.encode()
            await send(
                {
                    "type": "http.response.start",
                    "status": status,
                    "headers": [
                        (b"content-type", b"text/plain"),
                        *((k.lower().encode(), v.encode()) for k, v in headers.items()),
                    ],
                }
            )
            await send({"type": "http.response.body", "body": data})
            return
        await _json(send, status, body, headers)

    async def _control(self, path: str, method: str, receive: Receive, send: Send) -> bool:
        control = self.control
        match path, method:
            case "/_fake/faults", "GET":
                await _json(send, 200, [asdict(f) for f in control.faults if f.times != 0])
            case "/_fake/faults", "POST":
                try:
                    fault = control.add(json.loads(await _body(receive) or b"{}"))
                except (ValueError, TypeError, re.error) as exc:
                    await _json(send, 400, {"error": str(exc)})
                    return True
                await _json(send, 200, asdict(fault))
            case "/_fake/faults", "DELETE":
                control.faults.clear()
                await _json(send, 200, [])
            case "/_fake/requests", "GET":
                await _json(
                    send,
                    200,
                    {
                        "total": sum(control.requests.values()),
                        "statuses": {str(k): v for k, v in sorted(control.statuses.items())},
                        "routes": dict(control.requests.most_common()),
                    },
                )
            case "/_fake/requests", "DELETE":
                control.requests.clear()
                control.statuses.clear()
                await _json(send, 200, {"total": 0})
            case _:
                return False
        return True
