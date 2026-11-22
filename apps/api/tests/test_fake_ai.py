"""Contract test for the fake model API (`devtools/fake_ai.py`): Semestra talks to it through M06
and the assistant exactly as `pnpm dev:demo` does, so a change to M06's prompts or schemas that
the fake no longer answers fails here instead of quietly emptying the demo."""

import json
from collections.abc import Iterator
from typing import Any

import httpx
import pytest
import respx
from fastapi import FastAPI
from httpx import AsyncClient
from pydantic import BaseModel

from devtools import fake_ai
from devtools.seed import AI_PURPOSES
from semestra.core.context import system_ctx
from semestra.modules import ai as m06
from semestra.modules.ai import Evidenced, Message, PageText
from semestra.modules.ai.adapters import base
from semestra.testing import MakeUser

BASE = "https://fake-ai.example.com/v1"

SYLLABUS = [
    PageText(1, "ECE201H1 Electric Circuits\nInstructor: Prof. Ada Byron"),
    PageText(2, "Grading\nQuizzes 10%\nLabs 15%\nMidterm exam 30% — 2026-10-21\nFinal exam 45%"),
]


class Category(BaseModel):
    name: Evidenced[str]
    weight: Evidenced[float]


class Syllabus(BaseModel):
    course_code: Evidenced[str]
    instructor: Evidenced[str]
    categories: list[Category]


class Title(BaseModel):
    title: str


@pytest.fixture
def fake() -> Iterator[respx.MockRouter]:
    """Requests to `BASE` reach the fake app in-process."""
    app = fake_ai.create_app()

    async def forward(request: httpx.Request) -> httpx.Response:
        async with AsyncClient(transport=httpx.ASGITransport(app=app)) as c:
            r = await c.send(
                c.build_request(
                    request.method, request.url, headers=request.headers, content=request.content
                )
            )
            return httpx.Response(r.status_code, headers=r.headers, content=r.content)

    with respx.mock(assert_all_called=False) as router:
        router.route(host="fake-ai.example.com").mock(side_effect=forward)
        yield router  # pyright: ignore[reportReturnType]


@pytest.fixture
async def signed_in(
    app: FastAPI,
    client: AsyncClient,
    make_user: MakeUser,
    login_as: Any,
    fake: respx.MockRouter,
    monkeypatch: pytest.MonkeyPatch,
) -> str:
    monkeypatch.setattr(base, "RETRY_BASE_SECONDS", 0)
    user = await make_user()
    await login_as(client, user)
    r = await client.post(
        "/ai/providers",
        json={
            "kind": "openai_compatible",
            "display_name": "Fake AI",
            "base_url": BASE,
            "api_key": "fake-key",
            "capabilities": ["chat", "tools", "vision", "structured", "embedding"],
        },
    )
    assert r.status_code == 200, r.text
    provider_id = r.json()["id"]
    for purpose in AI_PURPOSES:
        model = "fake-embed" if purpose == "embedding" else "fake-chat"
        r = await client.put(
            "/ai/assignments",
            json={"purpose": purpose, "provider_id": provider_id, "model": model},
        )
        assert r.status_code == 200, r.text
    return user.id


async def test_m06_calls(app: FastAPI, signed_in: str):
    async with system_ctx(app.state, signed_in) as ctx:
        answer = await m06.complete(ctx, "chat", [Message.user("Hello")], source_module="t")
        title = await m06.structured(
            ctx, "title", [Message.user("Name this chat")], Title, source_module="t"
        )
        extracted = await m06.extract(
            ctx,
            "extraction",
            Syllabus,
            texts=SYLLABUS,
            instructions="Extract the course and its grading scheme.",
            source_module="t",
        )
        vectors = await m06.embed(ctx, ["circuits", "labs"], source_module="t")
    await app.state.ai.drain()

    assert answer.text.strip()
    assert title.title.strip()
    syllabus = extracted.value
    assert syllabus.course_code.value == "ECE201H1"
    assert {c.name.value for c in syllabus.categories} >= {"Quizzes", "Labs"}
    assert all(c.weight.value for c in syllabus.categories)
    assert vectors.dim > 0
    assert len(vectors.vectors) == 2


async def test_assistant_calls_a_tool_then_answers(client: AsyncClient, signed_in: str):
    session = (await client.post("/agent/sessions", json={})).json()
    events: list[tuple[str, Any]] = []
    async with client.stream(
        "POST", f"/agent/sessions/{session['id']}/messages", json={"text": "What is due soon?"}
    ) as r:
        assert r.status_code == 200
        name = "message"
        async for line in r.aiter_lines():
            if line.startswith("event:"):
                name = line[6:].strip()
            elif line.startswith("data:"):
                events.append((name, json.loads(line[5:].strip())))
    names = [n for n, _ in events]
    assert "error" not in names, events
    detail = (await client.get(f"/agent/sessions/{session['id']}")).json()
    text = json.dumps(detail)
    assert "search_tools" in text
    assert detail["messages"][-1]["role"] == "assistant"
