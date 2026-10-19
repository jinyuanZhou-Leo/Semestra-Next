"""Every provider kind sends through `safe_client`: private addresses are refused (M00 §3.10).

respx mocks below the transport, so the other tests never reach the egress guard; these use the
real client. A new kind or an SDK upgrade that bypasses the injected HTTP client fails here.
"""

import httpx
import pytest
from fastapi import FastAPI

from semestra.core.errors import AppError
from semestra.core.http import safe_client
from semestra.modules.ai.adapters import KINDS, adapter_for
from semestra.modules.ai.adapters.base import Adapter, ChatRequest, Endpoint
from semestra.modules.ai.llm import Message

METHODS = ("complete", "stream", "embed", "list_models")


async def _call(
    adapter: Adapter, method: str, client: httpx.AsyncClient, ep: Endpoint, req: ChatRequest
) -> None:
    match method:
        case "complete":
            await adapter.complete(client, ep, req)
        case "stream":
            async for _ in adapter.stream(client, ep, req):
                pass
        case "embed":
            await adapter.embed(client, ep, "m", ["hi"])
        case _:
            await adapter.list_models(client, ep)


@pytest.mark.parametrize("method", METHODS)
@pytest.mark.parametrize("kind", KINDS)
async def test_private_addresses_are_refused(app: FastAPI, kind: str, method: str):
    settings = app.state.settings
    assert not settings.allow_private_egress
    ep = Endpoint(kind, "http://127.0.0.1:9/v1", "k" * 20, ("chat", "embedding"), None, "x")
    adapter = adapter_for(kind)
    req = ChatRequest(model="m", messages=[Message.user("hi")])
    async with safe_client(settings) as client:
        with pytest.raises(AppError) as exc:
            await _call(adapter, method, client, ep, req)
    expected = (
        "ai.capability_unsupported"
        if method == "embed" and kind.startswith("anthropic")
        else "common.egress_blocked"
    )
    assert exc.value.code == expected
