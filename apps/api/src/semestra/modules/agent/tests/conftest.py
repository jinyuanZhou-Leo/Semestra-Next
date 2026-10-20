"""A scripted chat model (Pydantic AI's `FunctionModel`) and helpers to talk to the assistant
over HTTP and SSE."""

import json
from collections.abc import AsyncIterator, Awaitable, Callable, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from pydantic_ai.messages import (
    ModelMessage,
    ModelMessagesTypeAdapter,
    ModelRequest,
    ModelResponse,
    ToolReturnPart,
    UserContent,
    UserPromptPart,
)
from pydantic_ai.models.function import (
    AgentInfo,
    DeltaThinkingPart,
    DeltaToolCall,
    FunctionModel,
)
from pydantic_ai.profiles import ModelProfile
from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.modules.agent.models import AgentMessage
from semestra.modules.ai import Message
from semestra.testing import MakeUser, UserHandle

LoginAs = Callable[[AsyncClient, UserHandle], Awaitable[str]]


@dataclass
class Thought:
    content: str
    signature: str | None = None


@dataclass
class Reply:
    """One scripted model response: thinking, then text, then tool calls."""

    text: str = ""
    calls: list[tuple[str, dict[str, Any], str]] = field(default_factory=lambda: [])
    thinking: list[Thought] = field(default_factory=lambda: [])


Step = Reply | Callable[[list[ModelMessage]], Reply]


def say(text: str, *, thinking: Sequence[Thought] = ()) -> Reply:
    return Reply(text=text, thinking=list(thinking))


def call(
    name: str, args: dict[str, Any] | None = None, *, call_id: str | None = None, text: str = ""
) -> Reply:
    return calls([(name, args or {})], ids=[call_id] if call_id else None, text=text)


def calls(
    items: Sequence[tuple[str, dict[str, Any]]], *, ids: list[str] | None = None, text: str = ""
) -> Reply:
    return Reply(
        text=text,
        calls=[
            (name.replace(".", "__"), args, (ids or [])[i] if ids else f"call_{name}_{i}")
            for i, (name, args) in enumerate(items)
        ],
    )


class FakeModel:
    """Plays back replies through a `FunctionModel`; records every request it was sent."""

    name = "fake-model"
    supports_tools = True
    vision = True
    reads_pdf = True
    context_window = 128_000

    def __init__(self) -> None:
        self.source = "test:instance:fake-model"
        self.script: list[Step] = []
        self.requests: list[tuple[list[ModelMessage], AgentInfo]] = []
        # Tools a test makes disappear on purpose ("*": any).
        self.may_lose_tools: set[str] = set()
        # Like Chat Completions: no native tool search, so a revealed tool becomes an ordinary one.
        self.model = FunctionModel(
            stream_function=self._stream,
            model_name=self.name,
            profile=ModelProfile(supported_native_tools=frozenset()),
        )

    def then(self, *steps: Step) -> FakeModel:
        self.script.extend(steps)
        return self

    async def _stream(self, messages: list[ModelMessage], info: AgentInfo) -> AsyncIterator[Any]:
        self._check_tools_kept(messages, info)
        self.requests.append((list(messages), info))
        assert self.script, "the model was called more often than scripted"
        step = self.script.pop(0)
        reply = step(list(messages)) if callable(step) else step
        for i, thought in enumerate(reply.thinking):
            yield {100 + i: DeltaThinkingPart(content=thought.content, signature=thought.signature)}
        if reply.text:
            half = len(reply.text) // 2 or 1
            yield reply.text[:half]
            if reply.text[half:]:
                yield reply.text[half:]
        if reply.calls:
            yield {
                i: DeltaToolCall(name, json.dumps(args), tool_call_id=call_id)
                for i, (name, args, call_id) in enumerate(reply.calls)
            }

    def _check_tools_kept(self, messages: list[ModelMessage], info: AgentInfo) -> None:
        """A tool the model could call stays callable for the rest of the conversation, also
        after the history is loaded back from the database (an approval, the next message,
        Continue). Losing one means the stored history dropped what revealed it."""
        first = _first_prompt(messages)
        earlier = next(
            (i for m, i in reversed(self.requests) if first and _first_prompt(m) == first), None
        )
        if earlier is None:
            return
        lost = {t.name for t in earlier.function_tools} - {t.name for t in info.function_tools}
        if "*" not in self.may_lose_tools:
            assert not lost - self.may_lose_tools, f"tools lost between requests: {sorted(lost)}"

    def tools_of(self, index: int = -1) -> set[str]:
        """The tools the model could call in a request."""
        return {t.name for t in self.requests[index][1].function_tools}

    def instructions_of(self, index: int = -1) -> str:
        return self.requests[index][1].instructions or ""

    def text_of(self, index: int = -1) -> str:
        """Everything the model was sent in a request, as text."""
        messages, info = self.requests[index]
        dumped = ModelMessagesTypeAdapter.dump_json(messages).decode()
        return (info.instructions or "") + json.dumps(json.loads(dumped), ensure_ascii=False)

    def last_text(self) -> str:
        return self.text_of(-1)

    def responses_of(self, index: int = -1) -> list[ModelResponse]:
        return [m for m in self.requests[index][0] if isinstance(m, ModelResponse)]

    def prompts(self, index: int = -1) -> list[list[UserContent]]:
        """The user prompts of a request (one list of content items each)."""
        return [
            [p.content] if isinstance(p.content, str) else list(p.content)
            for m in self.requests[index][0]
            if isinstance(m, ModelRequest)
            for p in m.parts
            if isinstance(p, UserPromptPart)
        ]

    def results(self, index: int = -1) -> list[ToolReturnPart]:
        """The tool results a request carried."""
        return [
            p
            for m in self.requests[index][0]
            if isinstance(m, ModelRequest)
            for p in m.parts
            if isinstance(p, ToolReturnPart)
        ]


def _first_prompt(messages: list[ModelMessage]) -> str | None:
    """The conversation's first user prompt, to tell requests of one conversation apart."""
    for m in messages:
        if isinstance(m, ModelRequest):
            for p in m.parts:
                if isinstance(p, UserPromptPart):
                    return str(p.content)
    return None


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

    async def resume(self, session_id: str) -> list[tuple[str, Any]]:
        return await self.stream(f"/agent/sessions/{session_id}:continue", {})

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


async def report_input_tokens(app: FastAPI, session_id: str, input_tokens: int) -> None:
    """Sets what the provider reported as the prompt size of the conversation's last answer
    (`FunctionModel` reports a fixed guess)."""
    async with app.state.session_factory() as db:
        row = await db.scalar(
            select(AgentMessage)
            .where(AgentMessage.session_id == session_id, AgentMessage.role == "assistant")
            .order_by(AgentMessage.created_at.desc(), AgentMessage.id.desc())
            .limit(1)
        )
        assert row is not None
        assert row.model_parts
        parts = [dict(p) for p in row.model_parts]
        parts[0]["usage"] = {**parts[0].get("usage", {}), "input_tokens": input_tokens}
        row.model_parts = parts
        await db.commit()


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

    @asynccontextmanager
    async def chat_model(ctx: Ctx) -> AsyncIterator[FakeModel]:
        yield model

    async def chat_available(ctx: Ctx) -> bool:
        return True

    async def small_complete(ctx: Ctx, messages: list[Message]) -> str:
        return "Lab score"

    rt = app.state.agent
    rt.chat_model = chat_model
    rt.chat_available = chat_available
    rt.small_complete = small_complete
    return Agent(app, client, model)
