"""Outbound HTTP to user-chosen hosts (M00 §3.10): Canvas, custom LLM base URLs.

`safe_client(settings)` refuses to connect to private, loopback, link-local and other non-public
addresses. The check runs where the connection is opened, on the address actually dialled, so a
hostname cannot resolve to a public address for the check and a private one for the connection.
Redirects are not followed (a redirect could point anywhere) and proxy environment variables are
ignored. `SEMESTRA_ALLOW_PRIVATE_EGRESS=true` lifts the address check for self-hosting.
"""

import asyncio
import ipaddress
import socket
import weakref
from collections.abc import Iterable
from typing import Any

import anyio
import httpcore
import httpx

from semestra.core.config import Settings
from semestra.core.errors import AppError

DEFAULT_TIMEOUT = httpx.Timeout(20.0, connect=10.0)


def is_public_address(address: str) -> bool:
    ip = ipaddress.ip_address(address.split("%")[0])
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


class _GuardedBackend(httpcore.AsyncNetworkBackend):
    def __init__(self, inner: httpcore.AsyncNetworkBackend) -> None:
        self._inner = inner

    async def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,  # noqa: ASYNC109 (httpcore's interface)
        local_address: str | None = None,
        socket_options: Iterable[Any] | None = None,
    ) -> httpcore.AsyncNetworkStream:
        try:
            infos = await anyio.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        except OSError as exc:
            raise httpcore.ConnectError(str(exc)) from exc
        addresses = list(dict.fromkeys(str(info[4][0]) for info in infos))
        if not addresses or not all(is_public_address(a) for a in addresses):
            raise AppError("common.egress_blocked", 400, host=host)
        error: Exception = httpcore.ConnectError(f"cannot connect to {host}")
        for address in addresses:
            try:
                return await self._inner.connect_tcp(
                    address, port, timeout, local_address, socket_options
                )
            except (httpcore.ConnectError, httpcore.ConnectTimeout) as exc:
                error = exc
        raise error

    async def connect_unix_socket(
        self,
        path: str,
        timeout: float | None = None,  # noqa: ASYNC109
        socket_options: Iterable[Any] | None = None,
    ) -> httpcore.AsyncNetworkStream:
        raise AppError("common.egress_blocked", 400, host=path)

    async def sleep(self, seconds: float) -> None:
        await self._inner.sleep(seconds)


# One pool for the whole app. Connections stay open 30 s between requests (httpx: 5 s), long
# enough for an agent turn's tool calls between two model requests.
POOL_LIMITS = httpx.Limits(max_connections=100, max_keepalive_connections=20, keepalive_expiry=30)


def _new_transport(settings: Settings) -> httpx.AsyncHTTPTransport:
    transport = httpx.AsyncHTTPTransport(trust_env=False, limits=POOL_LIMITS)
    if not settings.allow_private_egress:
        pool: Any = transport._pool  # pyright: ignore[reportPrivateUsage]
        pool._network_backend = _GuardedBackend(pool._network_backend)
    return transport


class _SharedTransport(httpx.AsyncBaseTransport):
    """The connection pool every `safe_client` of an event loop sends through. A client closing
    leaves it open, so calls to the same host (a model provider, Canvas) reuse connections and
    TLS sessions instead of dialling again each time; `close_shared_transports` closes it."""

    def __init__(self, inner: httpx.AsyncHTTPTransport) -> None:
        self.inner = inner

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        return await self.inner.handle_async_request(request)

    async def aclose(self) -> None:
        pass


# Connections belong to the event loop that opened them; keyed by the egress policy too.
_shared: weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, dict[bool, _SharedTransport]] = (
    weakref.WeakKeyDictionary()
)


def _transport(settings: Settings) -> httpx.AsyncBaseTransport:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:  # built outside a loop: a pool of its own, closed with the client
        return _new_transport(settings)
    pools = _shared.setdefault(loop, {})
    shared = pools.get(settings.allow_private_egress)
    if shared is None:
        shared = pools[settings.allow_private_egress] = _SharedTransport(_new_transport(settings))
    return shared


async def close_shared_transports() -> None:
    """Closes the pooled connections of the running loop (app shutdown)."""
    for shared in _shared.pop(asyncio.get_running_loop(), {}).values():
        await shared.inner.aclose()


def safe_client(settings: Settings, **kwargs: Any) -> httpx.AsyncClient:
    """An `httpx.AsyncClient` for user-chosen destinations. Use it as `async with`; closing it
    keeps the shared connection pool open."""
    kwargs.setdefault("timeout", DEFAULT_TIMEOUT)
    return httpx.AsyncClient(
        transport=_transport(settings), follow_redirects=False, trust_env=False, **kwargs
    )
