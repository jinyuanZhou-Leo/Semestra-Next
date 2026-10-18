"""Outbound HTTP to user-chosen hosts (M00 §3.10): Canvas, custom LLM base URLs.

`safe_client(settings)` refuses to connect to private, loopback, link-local and other non-public
addresses. The check runs where the connection is opened, on the address actually dialled, so a
hostname cannot resolve to a public address for the check and a private one for the connection.
Redirects are not followed (a redirect could point anywhere) and proxy environment variables are
ignored. `SEMESTRA_ALLOW_PRIVATE_EGRESS=true` lifts the address check for self-hosting.
"""

import ipaddress
import socket
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


def safe_client(settings: Settings, **kwargs: Any) -> httpx.AsyncClient:
    """An `httpx.AsyncClient` for user-chosen destinations. Use it as `async with`."""
    transport = httpx.AsyncHTTPTransport(trust_env=False)
    if not settings.allow_private_egress:
        pool: Any = transport._pool  # pyright: ignore[reportPrivateUsage]
        pool._network_backend = _GuardedBackend(pool._network_backend)
    kwargs.setdefault("timeout", DEFAULT_TIMEOUT)
    return httpx.AsyncClient(transport=transport, follow_redirects=False, trust_env=False, **kwargs)
