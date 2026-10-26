"""The OpenAI Responses API and Anthropic-compatible endpoints (M06 §2)."""

import json
from typing import Any

import pytest
import respx
from fastapi import FastAPI
from httpx import Response
from pydantic import BaseModel

from semestra.core.errors import AppError
from semestra.modules import ai as m06
from semestra.modules.ai.adapters import convert
from semestra.modules.ai.adapters.base import ModelParams
from semestra.modules.ai.llm import Message
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


async def test_responses_conversion_and_usage(ai: Ai, app: FastAPI, mock: respx.MockRouter):
    await responses_provider(ai, mock)
    route = mock.post(f"{RESPONSES}/responses").mock(
        return_value=responses_reply([message_item("Found it.")])
    )
    messages = [
        Message.system("Be brief."),
        Message.user("find it"),
        Message.assistant("Where?"),
        Message.user("Anywhere"),
    ]
    async with ai.ctx() as ctx:
        result = await m06.complete(ctx, "chat", messages, source_module="agent")
    assert result.text == "Found it."
    body = json.loads(route.calls.last.request.content)
    assert body["store"] is False
    roles = [i.get("role") for i in body["input"]]
    assert roles == ["system", "user", "assistant", "user"]
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


# --- OpenAI-compatible ----------------------------------------------------------------------


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
    assert (body["model"], body["system"]) == ("deepseek-chat", "sys")
    assert body["max_tokens"] == 16384  # the default cap; 4096 cut long answers off


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
    # Some compatible models think by default (DeepSeek): structured output asks them not to.
    assert body["thinking"] == {"type": "disabled"}


async def test_structured_answer_cut_off_is_not_retried(
    ai: Ai, app: FastAPI, mock: respx.MockRouter
):
    mock.get(f"{ANTHROPIC_COMPAT}/v1/models").mock(return_value=Response(200, json={"data": []}))
    provider = await ai.provider(
        "anthropic_compatible", base_url=ANTHROPIC_COMPAT, capabilities=["chat", "structured"]
    )
    await ai.call(
        "PUT",
        "/ai/assignments",
        json={"purpose": "extraction", "provider_id": provider["id"], "model": "deepseek-flash"},
    )
    cut = Response(
        200,
        json={
            "content": [
                {"type": "tool_use", "id": "t", "name": "Course", "input": {"code": "APS"}}
            ],
            "stop_reason": "max_tokens",
            "usage": {"input_tokens": 3, "output_tokens": 16384},
        },
    )
    route = mock.post(f"{ANTHROPIC_COMPAT}/v1/messages").mock(return_value=cut)
    async with ai.ctx() as ctx:
        with pytest.raises(AppError) as exc:
            await m06.structured(
                ctx, "extraction", [Message.user("APS105")], Course, source_module="imports"
            )
    assert exc.value.code == "ai.output_truncated"
    assert route.call_count == 1  # asking again would stop at the same place
    rows = await usage_rows(app)
    assert [(r.status, r.error_code, r.output_tokens) for r in rows[-1:]] == [
        ("error", "ai.output_truncated", 16384)
    ]


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
    assert '\\"credits\\"' in json.dumps(body["system"])  # the schema, in the prompt


def test_responses_ask_for_a_reasoning_summary_when_reasoning():
    # The assistant shows the summary in its thinking block (M12 §6.1).
    thinking = ModelParams(reasoning_effort="low")
    summary = convert.settings_for("openai_responses", thinking).get("openai_reasoning_summary")
    assert summary == "auto"
    assert "openai_reasoning_summary" not in convert.settings_for("openai", thinking)
    plain = ModelParams()
    assert "openai_reasoning_summary" not in convert.settings_for("openai_responses", plain)


async def test_responses_without_summary_after_the_provider_refuses_it(
    ai: Ai, mock: respx.MockRouter
):
    # Unverified OpenAI organizations get a 400 for reasoning summaries: answer without one.
    provider = await responses_provider(ai, mock)
    await ai.call(
        "PUT",
        "/ai/assignments",
        json={
            "purpose": "chat",
            "provider_id": provider["id"],
            "model": "gpt-5",
            "params": {"reasoning_effort": "low"},
        },
    )
    refused = Response(
        400,
        json={
            "error": {
                "message": "Your organization must be verified to generate reasoning summaries.",
                "param": "reasoning.summary",
            }
        },
    )
    route = mock.post(f"{RESPONSES}/responses").mock(
        side_effect=[
            refused,
            responses_reply([message_item("ok")]),
            responses_reply([message_item("again")]),
        ]
    )
    async with ai.ctx() as ctx:
        first = await m06.complete(ctx, "chat", [Message.user("hi")], source_module="t")
        second = await m06.complete(ctx, "chat", [Message.user("hi")], source_module="t")
    assert isinstance(first, m06.Completion)
    assert isinstance(second, m06.Completion)
    assert (first.text, second.text) == ("ok", "again")
    sent = [json.loads(call.request.content)["reasoning"] for call in route.calls]
    assert [r.get("summary") for r in sent] == ["auto", None, None]
    assert all(r["effort"] == "low" for r in sent)


async def test_responses_other_rejections_are_not_blamed_on_the_summary(
    ai: Ai, mock: respx.MockRouter
):
    provider = await responses_provider(ai, mock)
    await ai.call(
        "PUT",
        "/ai/assignments",
        json={
            "purpose": "chat",
            "provider_id": provider["id"],
            "model": "gpt-5",
            "params": {"reasoning_effort": "low"},
        },
    )
    route = mock.post(f"{RESPONSES}/responses").mock(
        side_effect=[
            Response(400, json={"error": {"message": "bad input"}}),
            Response(400, json={"error": {"message": "bad input"}}),
            responses_reply([message_item("ok")]),
        ]
    )
    async with ai.ctx() as ctx:
        with pytest.raises(AppError) as rejected:
            await m06.complete(ctx, "chat", [Message.user("hi")], source_module="t")
        assert rejected.value.code == "ai.request_rejected"
        await m06.complete(ctx, "chat", [Message.user("hi")], source_module="t")
    # Still asked for the summary next time: dropping it did not help.
    assert json.loads(route.calls.last.request.content)["reasoning"]["summary"] == "auto"
