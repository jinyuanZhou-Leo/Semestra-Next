"""Fakes for the provider APIs (respx) and helpers to call M06 as a signed-in user."""

from collections.abc import AsyncIterator, Awaitable, Callable, Iterator
from contextlib import asynccontextmanager
from typing import Any

import pytest
import respx
from fastapi import FastAPI
from httpx import AsyncClient, Response

from semestra.core.context import Ctx, system_ctx
from semestra.modules.ai.adapters import base
from semestra.testing import MakeUser, UserHandle

LoginAs = Callable[[AsyncClient, UserHandle], Awaitable[str]]

ANTHROPIC = "https://api.anthropic.com"
OPENAI = "https://api.openai.com/v1"
GEMINI = "https://generativelanguage.googleapis.com/v1beta"
COMPAT = "https://llm.example.com/v1"
OLLAMA = "https://ollama.example.com"

ANTHROPIC_KEY = "sk-ant-api03-SECRETSECRETSECRET-wxyz"
OPENAI_KEY = "sk-proj-SECRETSECRETSECRET-abcd"


@pytest.fixture(autouse=True)
def _no_backoff(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(base, "RETRY_BASE_SECONDS", 0)


@pytest.fixture(autouse=True)
def _claude_answers_not_streamed(request: pytest.FixtureRequest) -> Iterator[None]:
    """Pydantic AI streams a Claude request behind the scenes when the model's own output cap is
    above the SDK's non-streaming limit (Claude 4.5+). The fakes here answer with one JSON body,
    so tests keep the request unstreamed; `test_claude_streams_a_long_answer_behind_the_scenes`
    (marked `streamed`) checks the real path."""
    if request.node.get_closest_marker("streamed"):
        yield
        return
    with pytest.MonkeyPatch.context() as patch:
        patch.setattr("pydantic_ai.models.anthropic._MAX_NON_STREAMING_TOKENS", 10**9)
        yield


@pytest.fixture
def mock() -> Iterator[respx.MockRouter]:
    with respx.mock(assert_all_called=False, assert_all_mocked=True) as router:
        yield router  # pyright: ignore[reportReturnType]


def models_ok(router: respx.MockRouter) -> None:
    """Every provider's "list models" endpoint answers, so creating providers passes the check."""
    router.get(f"{ANTHROPIC}/v1/models").mock(
        return_value=Response(
            200, json={"data": [{"id": "claude-sonnet-5-5", "display_name": "S"}]}
        )
    )
    router.get(f"{OPENAI}/models").mock(
        return_value=Response(200, json={"data": [{"id": "gpt-5"}, {"id": "gpt-5-mini"}]})
    )
    router.get(f"{GEMINI}/models").mock(
        return_value=Response(200, json={"models": [{"name": "models/gemini-2.5-flash"}]})
    )
    router.get(f"{COMPAT}/models").mock(return_value=Response(200, json={"data": [{"id": "ds"}]}))
    router.get(f"{OLLAMA}/v1/models").mock(
        return_value=Response(200, json={"object": "list", "data": [{"id": "qwen3:8b"}]})
    )


class Ai:
    """The signed-in user's view of M06: HTTP calls plus a ctx for the Python interface."""

    def __init__(self, app: FastAPI, client: AsyncClient, user: UserHandle) -> None:
        self.app = app
        self.client = client
        self.user = user

    async def call(self, method: str, url: str, status: int = 200, **kwargs: Any) -> Any:
        r = await self.client.request(method, url, **kwargs)
        assert r.status_code == status, r.text
        await self.drain()
        return r.json()

    async def provider(self, kind: str = "anthropic", **body: Any) -> dict[str, Any]:
        if kind in ("anthropic", "openai", "gemini") and "api_key" not in body:
            body["api_key"] = {"anthropic": ANTHROPIC_KEY, "openai": OPENAI_KEY}.get(
                kind, "g-key-1234567890"
            )
        if kind == "openai_compatible":
            body.setdefault("base_url", COMPAT)
        if kind == "ollama":
            body.setdefault("base_url", OLLAMA)
        return await self.call("POST", "/ai/providers", json={"kind": kind, **body})

    @asynccontextmanager
    async def ctx(self) -> AsyncIterator[Ctx]:
        async with system_ctx(self.app.state, self.user.id) as ctx:
            yield ctx
        await self.drain()

    async def drain(self) -> None:
        await self.app.state.ai.drain()


@pytest.fixture
async def ai(app: FastAPI, client: AsyncClient, make_user: MakeUser, login_as: LoginAs) -> Ai:
    user = await make_user()
    await login_as(client, user)
    return Ai(app, client, user)
