"""Lets the provider SDKs send their requests through our own `httpx` client.

The SDKs (and Pydantic AI) use `httpx2`, a fork of `httpx`. Every request still has to go through
`safe_client` (M00 §3.10: no private addresses, no redirects, no proxy variables), so the SDKs get
an `httpx2.AsyncClient` whose transport hands each request to that client.
"""

from collections.abc import AsyncIterator

import httpx
import httpx2

# The SDKs refuse to start without a key; endpoints that need none get this one, and the bridge
# drops the auth headers carrying it.
NO_KEY = "semestra-no-key"
_AUTH_HEADERS = ("authorization", "x-api-key", "x-goog-api-key")


class _Body(httpx2.AsyncByteStream):
    def __init__(self, response: httpx.Response) -> None:
        self._response = response

    async def __aiter__(self) -> AsyncIterator[bytes]:
        try:
            async for chunk in self._response.aiter_raw():
                yield chunk
        except httpx.TimeoutException as exc:
            raise httpx2.ReadTimeout(str(exc)) from exc
        except httpx.TransportError as exc:
            raise httpx2.ReadError(str(exc)) from exc

    async def aclose(self) -> None:
        await self._response.aclose()


class _Bridge(httpx2.AsyncBaseTransport):
    def __init__(self, client: httpx.AsyncClient, *, drop_auth: bool) -> None:
        self._client = client
        self._drop_auth = drop_auth

    async def handle_async_request(self, request: httpx2.Request) -> httpx2.Response:
        headers = [
            (name, value)
            for name, value in request.headers.multi_items()
            if not (self._drop_auth and name.lower() in _AUTH_HEADERS)
        ]
        outgoing = self._client.build_request(
            request.method, str(request.url), headers=headers, content=await request.aread()
        )
        try:
            response = await self._client.send(outgoing, stream=True)
        except httpx.TimeoutException as exc:
            raise httpx2.ConnectTimeout(str(exc), request=request) from exc
        except httpx.TransportError as exc:
            raise httpx2.ConnectError(str(exc), request=request) from exc
        return httpx2.Response(
            response.status_code,
            headers=response.headers.multi_items(),
            stream=_Body(response),
            request=request,
        )


def sdk_client(client: httpx.AsyncClient, *, has_key: bool) -> httpx2.AsyncClient:
    """An `httpx2` client for an SDK that sends everything through `client`."""
    timeout = client.timeout
    return httpx2.AsyncClient(
        transport=_Bridge(client, drop_auth=not has_key),
        timeout=httpx2.Timeout(timeout.read, connect=timeout.connect),
        follow_redirects=False,
        trust_env=False,
    )
