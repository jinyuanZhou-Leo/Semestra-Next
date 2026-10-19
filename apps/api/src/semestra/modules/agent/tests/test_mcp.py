"""The MCP endpoint with the official SDK client over the ASGI app (M12 §5, §10)."""

from collections.abc import AsyncIterator, Callable
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from typing import Any

import httpx2
from fastapi import FastAPI
from httpx import AsyncClient
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

from semestra.modules.agent.tests.conftest import Agent

Connect = Callable[[str], AbstractAsyncContextManager[ClientSession]]


async def _token(agent: Agent, scopes: list[str]) -> str:
    created = await agent.call("POST", "/account/tokens", json={"name": "Claude", "scopes": scopes})
    return created["token"]


def _connector(app: FastAPI) -> Connect:
    @asynccontextmanager
    async def connect(token: str) -> AsyncIterator[ClientSession]:
        async with (
            httpx2.AsyncClient(
                transport=httpx2.ASGITransport(app=app),
                base_url="http://testserver",
                headers={"Authorization": f"Bearer {token}"},
            ) as http,
            streamable_http_client("http://testserver/mcp", http_client=http) as streams,
            ClientSession(streams[0], streams[1]) as session,
        ):
            await session.initialize()
            yield session

    return connect


def _text(content: object) -> str:
    text = getattr(content, "text", None)
    assert isinstance(text, str)
    return text


def _payload(result: Any) -> Any:
    return result.structured_content


async def test_read_token_lists_and_calls_read_tools(app: FastAPI, agent: Agent):
    program = await agent.program()
    token = await _token(agent, ["read"])
    async with _connector(app)(token) as mcp:
        tools = {t.name: t for t in (await mcp.list_tools()).tools}
        assert "academics__program__list" in tools
        annotations = tools["academics__program__list"].annotations
        assert annotations is not None
        assert annotations.read_only_hint is True
        assert "grading__assessment__update" not in tools  # write tools need a write token
        assert "agent__session__list" not in tools  # http-only capabilities never appear

        result = await mcp.call_tool("academics__program__list", {})
        assert result.is_error is False
        assert _payload(result)["items"][0]["id"] == program["id"]

        refused = await mcp.call_tool("academics__program__create", {"name": "X"})
        assert refused.is_error is True
        assert _payload(refused)["error"]["code"] == "auth.token_scope"


async def test_write_token_and_destructive_preference(app: FastAPI, agent: Agent):
    _, _, lab = await agent.course_with_lab()
    token = await _token(agent, ["read", "write"])
    async with _connector(app)(token) as mcp:
        names = {t.name for t in (await mcp.list_tools()).tools}
        assert "grading__assessment__update" in names
        assert "grading__assessment__delete" not in names
        result = await mcp.call_tool(
            "grading__assessment__update", {"assessment_id": lab["id"], "score_percentage": 90}
        )
        assert result.is_error is False
        assert _payload(result)["score_percentage"] == 90

    await agent.call("PATCH", "/agent/preferences", json={"mcp_allow_destructive": True})
    async with _connector(app)(token) as mcp:
        names = {t.name for t in (await mcp.list_tools()).tools}
        assert "grading__assessment__delete" in names


async def test_prompts_are_skills_and_resources_summarize(app: FastAPI, agent: Agent):
    program, course, _ = await agent.course_with_lab()
    token = await _token(agent, ["read"])
    async with _connector(app)(token) as mcp:
        prompts = {p.name for p in (await mcp.list_prompts()).prompts}
        assert {"record-grades", "answer-schedule-questions"} <= prompts
        prompt = await mcp.get_prompt("record-grades")
        assert "Recording grades" in _text(prompt.messages[0].content)

        programs = await mcp.read_resource("semestra://programs")
        assert program["id"] in _text(programs.contents[0])
        course_res = await mcp.read_resource(f"semestra://courses/{course['id']}")
        assert "APS105H1" in _text(course_res.contents[0])


async def test_cookies_and_missing_tokens_are_refused(client: AsyncClient, agent: Agent):
    r = await client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "common.unauthenticated"
    r = await client.post(
        "/mcp",
        json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
        headers={"Authorization": "Bearer spat_not-a-real-token"},
    )
    assert r.status_code == 401
