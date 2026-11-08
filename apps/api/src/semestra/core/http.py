"""Outbound HTTP to user-chosen hosts (M00 §3.10): Canvas, custom LLM base URLs.

`safe_client(settings)` refuses to connect to private, loopback, link-local and other non-public
addresses. The check runs where the connection is opened, on the address actually dialled, so a
hostname cannot resolve to a public address for the check and a private one for the connection.
Redirects are not followed (a redirect could point anywhere) and proxy environment variables are
ignored. `SEMESTRA_ALLOW_PRIVATE_EGRESS=true` lets a self-hosted instance reach its own network
(a local Ollama, a school's Canvas on the LAN); link-local and cloud metadata addresses stay
blocked either way.
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


# Never reachable, whatever the policy: link-local (where every cloud's metadata service lives)
# and the metadata addresses outside it (AWS over IPv6, Alibaba Cloud).
_ALWAYS_BLOCKED = tuple(
    ipaddress.ip_network(n)
    for n in ("169.254.0.0/16", "fe80::/10", "fd00:ec2::254/128", "100.100.100.200/32")
)
# NAT64 (RFC 6052): the IPv4 address a translator would dial is in the last 32 bits.
_NAT64 = ipaddress.ip_network("64:ff9b::/96")


def _target(address: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address:
    """The address a connection to `address` ends up at: IPv4-mapped and NAT64 addresses are
    their embedded IPv4 address."""
    ip = ipaddress.ip_address(address.split("%")[0])
    if isinstance(ip, ipaddress.IPv6Address):
        if ip.ipv4_mapped is not None:
            return ip.ipv4_mapped
        if ip in _NAT64:
            return ipaddress.IPv4Address(int(ip) & 0xFFFFFFFF)
    return ip


def egress_allowed(address: str, *, allow_private: bool = False) -> bool:
    """Whether outbound requests may dial `address`: public addresses only, or with
    `allow_private` also the instance's own network (loopback, LAN, ULA, CGNAT)."""
    ip = _target(address)
    if ip.is_multicast or ip.is_unspecified or any(ip in n for n in _ALWAYS_BLOCKED):
        return False
    return allow_private or ip.is_global


class _GuardedBackend(httpcore.AsyncNetworkBackend):
    def __init__(self, inner: httpcore.AsyncNetworkBackend, *, allow_private: bool) -> None:
        self._inner = inner
        self._allow_private = allow_private

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
        allowed = (egress_allowed(a, allow_private=self._allow_private) for a in addresses)
        if not addresses or not all(allowed):
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
    pool: Any = transport._pool  # pyright: ignore[reportPrivateUsage]
    pool._network_backend = _GuardedBackend(
        pool._network_backend, allow_private=settings.allow_private_egress
    )
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
