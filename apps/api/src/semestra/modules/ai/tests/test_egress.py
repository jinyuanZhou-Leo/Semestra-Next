"""Every provider kind sends through `safe_client`: private addresses are refused (M00 §3.10).

respx mocks below the transport, so the other tests never reach the egress guard; these use the
real client. A new kind or an SDK upgrade that bypasses the injected HTTP client fails here.
"""

import httpx
import pytest
from fastapi import FastAPI
from pydantic_ai.direct import model_request, model_request_stream
from pydantic_ai.messages import ModelRequest

from semestra.core.errors import AppError
from semestra.core.http import safe_client
from semestra.modules.ai.adapters import KINDS, adapter_for, semestra_model
from semestra.modules.ai.adapters.base import Endpoint, ModelParams

METHODS = ("complete", "stream", "embed", "list_models")


async def _call(method: str, client: httpx.AsyncClient, ep: Endpoint) -> None:
    adapter = adapter_for(ep.kind)
    model = semestra_model(client, ep, "m", ModelParams())
    messages = [ModelRequest.user_text_prompt("hi")]
    match method:
        case "complete":
            await model_request(model, messages)
        case "stream":
            async with model_request_stream(model, messages) as stream:
                async for _ in stream:
                    pass
        case "embed":
            await adapter.embed(client, ep, "m", ["hi"])
        case _:
            await adapter.list_models(client, ep)


@pytest.mark.parametrize("method", METHODS)
@pytest.mark.parametrize("kind", KINDS)
async def test_private_addresses_are_refused(
    app: FastAPI, kind: str, method: str, monkeypatch: pytest.MonkeyPatch
):
    retries: list[int] = []

    async def no_backoff(attempt: int, error: AppError) -> None:
        retries.append(attempt)

    monkeypatch.setattr("semestra.modules.ai.adapters.model.backoff", no_backoff)
    settings = app.state.settings
    assert not settings.allow_private_egress
    ep = Endpoint(kind, "http://127.0.0.1:9/v1", "k" * 20, ("chat", "embedding"), None, "x")
    async with safe_client(settings) as client:
        with pytest.raises(AppError) as exc:
            await _call(method, client, ep)
    expected = (
        "ai.capability_unsupported"
        if method == "embed" and kind.startswith("anthropic")
        else "common.egress_blocked"
    )
    assert exc.value.code == expected
    assert retries == []  # a refused address is final, not retried
