"""The OpenAI Responses API and Anthropic-compatible endpoints (M06 §2)."""

import json
from typing import Any

import respx
from fastapi import FastAPI
from httpx import Response
from pydantic import BaseModel

from semestra.modules import ai as m06
from semestra.modules.ai.llm import Message, Tool, ToolCall, ToolResult
from semestra.modules.ai.tests.conftest import Ai
from semestra.modules.ai.tests.test_calls import anthropic_reply, usage_rows

RESPONSES = "https://gateway.example.com/v1"
ANTHROPIC_COMPAT = "https://llm.example.com/anthropic"
KEY = "gw-SECRETSECRETSECRET-1234"


class Course(BaseModel):
    code: str
    credits: float


def responses_reply(output: list[dict[str, Any]], status: str = "completed") -> Response:
    return Response(
        200,
        json={
            "id": "resp_1",
            "object": "response",
            "created_at": 1,
            "model": "gpt-5",
            "status": status,
            "output": output,
            "parallel_tool_calls": True,
            "tool_choice": "auto",
            "tools": [],
            "usage": {
                "input_tokens": 20,
                "input_tokens_details": {"cached_tokens": 5},
                "output_tokens": 4,
                "output_tokens_details": {"reasoning_tokens": 0},
                "total_tokens": 24,
            },
        },
    )


def message_item(text: str) -> dict[str, Any]:
    return {
        "type": "message",
        "id": "msg_1",
        "role": "assistant",
        "status": "completed",
        "content": [{"type": "output_text", "text": text, "annotations": []}],
    }


async def responses_provider(ai: Ai, mock: respx.MockRouter, **body: Any) -> dict[str, Any]:
    mock.get(f"{RESPONSES}/models").mock(
        return_value=Response(200, json={"object": "list", "data": [{"id": "gpt-5"}]})
    )
    provider = await ai.provider(
        "openai_responses",
        base_url=RESPONSES,
        api_key=KEY,
        capabilities=["chat", "tools", "structured"],
        **body,
    )
    for purpose in ("chat", "extraction"):
        await ai.call(
            "PUT",
            "/ai/assignments",
            json={"purpose": purpose, "provider_id": provider["id"], "model": "gpt-5"},
        )
    return provider


# --- Responses API ----------------------------------------------------------------------------


async def test_responses_tools_and_usage(ai: Ai, app: FastAPI, mock: respx.MockRouter):
    await responses_provider(ai, mock)
    route = mock.post(f"{RESPONSES}/responses").mock(
        return_value=responses_reply(
            [
                {
                    "type": "function_call",
                    "id": "fc_1",
                    "call_id": "c1",
                    "name": "lookup",
                    "arguments": '{"q": 2}',
                    "status": "completed",
                }
            ]
        )
    )
    messages = [
        Message.system("Be brief."),
        Message.user("find it"),
        Message.assistant("looking", ToolCall("c0", "lookup", {"q": 1})),
        Message("tool", [ToolResult("c0", "lookup", "nothing")]),
    ]
    async with ai.ctx() as ctx:
        result = await m06.complete(
            ctx,
            "chat",
            messages,
            tools=[Tool("lookup", "Look up", {"type": "object"})],
            source_module="agent",
        )
    assert isinstance(result, m06.Completion)
    assert result.tool_calls == [ToolCall("c1", "lookup", {"q": 2})]
    assert result.stop_reason == "tool_use"
    body = json.loads(route.calls.last.request.content)
    assert body["store"] is False
    items = body["input"]
    assert {"type": "function_call", "call_id": "c0", "name": "lookup"}.items() <= items[3].items()
    assert items[4] == {"type": "function_call_output", "call_id": "c0", "output": "nothing"}
    assert body["tools"][0]["name"] == "lookup"
    assert route.calls.last.request.headers["authorization"] == f"Bearer {KEY}"
    [row] = await usage_rows(app)
    assert (row.provider_kind, row.input_tokens, row.output_tokens, row.cached_tokens) == (
        "openai_responses",
        20,
        4,
        5,
    )


async def test_responses_structured_output(ai: Ai, mock: respx.MockRouter):
    await responses_provider(ai, mock)
    route = mock.post(f"{RESPONSES}/responses").mock(
        return_value=responses_reply([message_item('{"code": "MAT187", "credits": 0.5}')])
    )
    async with ai.ctx() as ctx:
        result = await m06.structured(
            ctx, "extraction", [Message.user("MAT187")], Course, source_module="imports"
        )
    assert result == Course(code="MAT187", credits=0.5)
    fmt = json.loads(route.calls.last.request.content)["text"]["format"]
    assert (fmt["type"], fmt["name"]) == ("json_schema", "Course")


async def test_responses_stream(ai: Ai, app: FastAPI, mock: respx.MockRouter):
    await responses_provider(ai, mock)
    call = {
        "type": "function_call",
        "id": "fc_1",
        "call_id": "c9",
        "name": "lookup",
        "arguments": '{"q": 3}',
        "status": "completed",
    }
    final = json.loads(responses_reply([message_item("Hello"), call]).content)
    events = [
        {"type": "response.created", "sequence_number": 0, "response": {**final, "output": []}},
        {
            "type": "response.output_item.added",
            "sequence_number": 1,
            "output_index": 0,
            "item": {**message_item(""), "content": [], "status": "in_progress"},
        },
        *[
            {
                "type": "response.output_text.delta",
                "sequence_number": 2 + i,
                "item_id": "msg_1",
                "output_index": 0,
                "content_index": 0,
                "delta": delta,
                "logprobs": [],
            }
            for i, delta in enumerate(["Hel", "lo"])
        ],
        {
            "type": "response.output_item.done",
            "sequence_number": 4,
            "output_index": 0,
            "item": message_item("Hello"),
        },
        {
            "type": "response.output_item.added",
            "sequence_number": 5,
            "output_index": 1,
            "item": call,
        },
        {
            "type": "response.output_item.done",
            "sequence_number": 6,
            "output_index": 1,
            "item": call,
        },
        {"type": "response.completed", "sequence_number": 7, "response": final},
    ]
    sse = "".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n" for e in events)
    mock.post(f"{RESPONSES}/responses").mock(
        return_value=Response(200, text=sse, headers={"content-type": "text/event-stream"})
    )
    async with ai.ctx() as ctx:
        stream = await m06.complete(
            ctx,
            "chat",
            [Message.user("hi")],
            tools=[Tool("lookup", "Look up", {"type": "object"})],
            stream=True,
            source_module="agent",
        )
        assert not isinstance(stream, m06.Completion)
        chunks = [c async for c in stream]
    assert "".join(c.text for c in chunks if c.text) == "Hello"
    assert [c.tool_call for c in chunks if c.tool_call] == [ToolCall("c9", "lookup", {"q": 3})]
    done = chunks[-1].done
    assert done is not None
    assert (done.text, done.stop_reason, done.usage.input_tokens) == ("Hello", "tool_use", 20)
    [row] = await usage_rows(app)
    assert row.status == "ok"


async def test_responses_rate_limit_is_retried(ai: Ai, mock: respx.MockRouter):
    await responses_provider(ai, mock)
    route = mock.post(f"{RESPONSES}/responses").mock(
        side_effect=[
            Response(429, json={"error": {"message": "slow"}}),
            responses_reply([message_item("ok")]),
        ]
    )
    async with ai.ctx() as ctx:
        result = await m06.complete(ctx, "chat", [Message.user("hi")], source_module="t")
    assert isinstance(result, m06.Completion)
    assert result.text == "ok"
    assert route.call_count == 2


# --- Anthropic-compatible -------------------------------------------------------------------


async def test_anthropic_compatible_without_a_key(ai: Ai, mock: respx.MockRouter):
    # No model listing at this endpoint: the provider is still created and the model is typed.
    mock.get(f"{ANTHROPIC_COMPAT}/v1/models").mock(return_value=Response(404))
    provider = await ai.provider(
        "anthropic_compatible", base_url=f"{ANTHROPIC_COMPAT}/v1", capabilities=["chat", "tools"]
    )
    assert provider["capabilities_editable"] is True
    models = await ai.call("GET", f"/ai/providers/{provider['id']}/models")
    assert models == {"items": [], "manual_entry": True}
    await ai.call(
        "PUT",
        "/ai/assignments",
        json={"purpose": "chat", "provider_id": provider["id"], "model": "deepseek-chat"},
    )
    route = mock.post(f"{ANTHROPIC_COMPAT}/v1/messages").mock(return_value=anthropic_reply("hi"))
    async with ai.ctx() as ctx:
        result = await m06.complete(
            ctx, "chat", [Message.system("sys"), Message.user("hello")], source_module="t"
        )
    assert isinstance(result, m06.Completion)
    assert result.text == "hi"
    request = route.calls.last.request
    assert "x-api-key" not in request.headers
    assert "authorization" not in request.headers
    body = json.loads(request.content)
    assert (body["model"], body["system"], body["max_tokens"]) == ("deepseek-chat", "sys", 4096)


async def test_anthropic_compatible_key_and_structured_output(ai: Ai, mock: respx.MockRouter):
    mock.get(f"{ANTHROPIC_COMPAT}/v1/models").mock(
        return_value=Response(200, json={"data": [{"id": "kimi-k2", "display_name": "Kimi K2"}]})
    )
    provider = await ai.provider(
        "anthropic_compatible",
        base_url=ANTHROPIC_COMPAT,
        api_key=KEY,
        capabilities=["chat", "tools", "structured"],
    )
    models = await ai.call("GET", f"/ai/providers/{provider['id']}/models")
    assert models["items"] == [{"id": "kimi-k2", "display_name": "Kimi K2"}]
    await ai.call(
        "PUT",
        "/ai/assignments",
        json={"purpose": "extraction", "provider_id": provider["id"], "model": "kimi-k2"},
    )
    route = mock.post(f"{ANTHROPIC_COMPAT}/v1/messages").mock(
        return_value=Response(
            200,
            json={
                "content": [
                    {
                        "type": "tool_use",
                        "id": "t",
                        "name": "Course",
                        "input": {"code": "APS105", "credits": 0.5},
                    }
                ],
                "stop_reason": "tool_use",
                "usage": {"input_tokens": 3, "output_tokens": 2},
            },
        )
    )
    async with ai.ctx() as ctx:
        result = await m06.structured(
            ctx, "extraction", [Message.user("APS105")], Course, source_module="imports"
        )
    assert result == Course(code="APS105", credits=0.5)
    request = route.calls.last.request
    assert request.headers["x-api-key"] == KEY
    assert request.headers["authorization"] == f"Bearer {KEY}"
    body = json.loads(request.content)
    # Not a Claude model: the result comes back as a forced tool call.
    assert [t["name"] for t in body["tools"]] == ["Course"]
    assert body["tool_choice"]["type"] in ("any", "tool")


async def test_anthropic_compatible_json_fallback(ai: Ai, mock: respx.MockRouter):
    mock.get(f"{ANTHROPIC_COMPAT}/v1/models").mock(return_value=Response(200, json={"data": []}))
    provider = await ai.provider(
        "anthropic_compatible", base_url=ANTHROPIC_COMPAT, capabilities=["chat"]
    )
    await ai.call(
        "PUT",
        "/ai/assignments",
        json={"purpose": "extraction", "provider_id": provider["id"], "model": "glm-4.6"},
    )
    route = mock.post(f"{ANTHROPIC_COMPAT}/v1/messages").mock(
        return_value=anthropic_reply('```json\n{"code": "ECE244", "credits": 0.5}\n```')
    )
    async with ai.ctx() as ctx:
        result = await m06.structured(
            ctx, "extraction", [Message.user("ECE244")], Course, source_module="imports"
        )
    assert result.code == "ECE244"
    body = json.loads(route.calls.last.request.content)
    assert "tools" not in body
    assert "JSON Schema" in body["system"]
