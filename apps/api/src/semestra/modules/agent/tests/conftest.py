"""A scripted chat model and helpers to talk to the assistant over HTTP and SSE."""

import json
from collections.abc import AsyncIterator, Awaitable, Callable, Sequence
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import AsyncClient

from semestra.core.context import Ctx
from semestra.modules.ai import Chunk, Completion, Message, Tool, ToolCall, Usage
from semestra.testing import MakeUser, UserHandle

LoginAs = Callable[[AsyncClient, UserHandle], Awaitable[str]]
Step = Completion | Callable[[list[Message]], Completion]


def say(text: str) -> Completion:
    return Completion(text=text, usage=Usage(10, 5), model="fake")


def call(
    name: str, args: dict[str, Any] | None = None, *, call_id: str | None = None, text: str = ""
) -> Completion:
    return calls([(name, args or {})], ids=[call_id] if call_id else None, text=text)


def calls(
    items: Sequence[tuple[str, dict[str, Any]]], *, ids: list[str] | None = None, text: str = ""
) -> Completion:
    tool_calls = [
        ToolCall((ids or [])[i] if ids else f"call_{name}_{i}", name.replace(".", "__"), args)
        for i, (name, args) in enumerate(items)
    ]
    return Completion(text=text, tool_calls=tool_calls, stop_reason="tool_use", usage=Usage(10, 5))


class FakeModel:
    """Plays back completions; records what it was sent."""

    model = "fake-model"
    supports_tools = True
    reads_pdf = True

    def __init__(self) -> None:
        self.script: list[Step] = []
        self.requests: list[tuple[list[Message], list[Tool]]] = []

    def then(self, *steps: Step) -> FakeModel:
        self.script.extend(steps)
        return self

    async def stream(
        self, messages: Sequence[Message], tools: Sequence[Tool] | None = None
    ) -> AsyncIterator[Chunk]:
        self.requests.append((list(messages), list(tools or [])))
        assert self.script, "the model was called more often than scripted"
        step = self.script.pop(0)
        completion = step(list(messages)) if callable(step) else step
        if completion.text:
            half = len(completion.text) // 2 or 1
            yield Chunk(text=completion.text[:half])
            if completion.text[half:]:
                yield Chunk(text=completion.text[half:])
        for tc in completion.tool_calls:
            yield Chunk(tool_call=tc)
        yield Chunk(done=completion)

    def last_text(self) -> str:
        """Everything the model was sent in its last request, as text."""
        messages, _ = self.requests[-1]
        return json.dumps([repr(m) for m in messages], ensure_ascii=False)


class Agent:
    def __init__(self, app: FastAPI, client: AsyncClient, model: FakeModel) -> None:
        self.app = app
        self.client = client
        self.model = model

    async def call(self, method: str, url: str, status: int = 200, **kwargs: Any) -> Any:
        r = await self.client.request(method, url, **kwargs)
        assert r.status_code == status, r.text
        return r.json()

    async def stream(
        self, url: str, body: dict[str, Any], status: int = 200
    ) -> list[tuple[str, Any]]:
        out: list[tuple[str, Any]] = []
        async with self.client.stream("POST", url, json=body) as r:
            if r.status_code != status:
                await r.aread()
                raise AssertionError(r.text)
            if status != 200:
                await r.aread()
                return [("http_error", r.json())]
            name = "message"
            async for line in r.aiter_lines():
                if line.startswith("event:"):
                    name = line[6:].strip()
                elif line.startswith("data:"):
                    out.append((name, json.loads(line[5:].strip())))
                    name = "message"
        await self.app.state.ai.drain()
        return out

    async def session(self, scope: dict[str, Any] | None = None) -> dict[str, Any]:
        return await self.call("POST", "/agent/sessions", json={"scope": scope} if scope else {})

    async def send(self, session_id: str, text: str = "", **body: Any) -> list[tuple[str, Any]]:
        return await self.stream(f"/agent/sessions/{session_id}/messages", {"text": text, **body})

    async def decide(
        self, session_id: str, proposal_id: str, decision: str = "approve", **body: Any
    ) -> list[tuple[str, Any]]:
        return await self.stream(
            f"/agent/sessions/{session_id}/proposals/{proposal_id}:decide",
            {"decision": decision, **body},
        )

    async def detail(self, session_id: str) -> dict[str, Any]:
        return await self.call("GET", f"/agent/sessions/{session_id}")

    async def program(self) -> dict[str, Any]:
        return await self.call(
            "POST", "/programs", json={"name": "BASc", "timezone": "America/Toronto"}
        )

    async def course_with_lab(self) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
        program = await self.program()
        term = (
            await self.call(
                "POST",
                f"/programs/{program['id']}/terms",
                json={"name": "Fall 2026", "start_date": "2026-09-08", "end_date": "2026-12-20"},
            )
        )["term"]
        course = await self.call(
            "POST",
            f"/programs/{program['id']}/courses",
            json={"title": "Programming", "code": "APS105H1", "term_ids": [term["id"]]},
        )
        lab = await self.call(
            "POST", f"/courses/{course['id']}/assessments", json={"title": "Lab 3", "weight": 10}
        )
        return program, course, lab


def events_named(events: list[tuple[str, Any]], name: str) -> list[Any]:
    return [data for n, data in events if n == name]


@pytest.fixture
def model() -> FakeModel:
    return FakeModel()


@pytest.fixture
async def agent(
    app: FastAPI, client: AsyncClient, make_user: MakeUser, login_as: LoginAs, model: FakeModel
) -> Agent:
    user = await make_user()
    await login_as(client, user)

    async def chat_model(ctx: Ctx) -> FakeModel:
        return model

    async def chat_available(ctx: Ctx) -> bool:
        return True

    async def small_complete(ctx: Ctx, messages: list[Message]) -> str:
        return "Lab score"

    rt = app.state.agent
    rt.chat_model = chat_model
    rt.chat_available = chat_available
    rt.small_complete = small_complete
    return Agent(app, client, model)
