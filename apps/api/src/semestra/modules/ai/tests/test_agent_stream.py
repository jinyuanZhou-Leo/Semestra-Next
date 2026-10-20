"""The assistant's streaming model: retries before the first event only, the reasoning summary
fallback, and usage rows for failed and cancelled streams (M06 §4.3, M12 §4)."""

import asyncio
import json
from typing import Any

import pytest
import respx
from fastapi import FastAPI
from httpx import Response
from pydantic_ai.direct import model_request_stream
from pydantic_ai.messages import ModelRequest
from pydantic_ai.models import ModelRequestParameters

from semestra.core.errors import AppError
from semestra.modules import ai as m06
from semestra.modules.ai.adapters import model as adapter_model
from semestra.modules.ai.tests.conftest import ANTHROPIC, Ai, models_ok
from semestra.modules.ai.tests.test_calls import usage_rows
from semestra.modules.ai.tests.test_compatible_kinds import RESPONSES, responses_provider

PROMPT = [ModelRequest.user_text_prompt("hi")]


def sse(events: list[dict[str, Any]]) -> Response:
    body = "".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n" for e in events)
    return Response(200, text=body, headers={"content-type": "text/event-stream"})


START = {
    "type": "message_start",
    "message": {
        "id": "msg_1",
        "type": "message",
        "role": "assistant",
        "content": [],
        "model": "claude-sonnet-5-5",
        "usage": {"input_tokens": 9, "output_tokens": 0},
    },
}
TEXT = [
    {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
    {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Hi"}},
]
END = [
    {"type": "content_block_stop", "index": 0},
    {"type": "message_delta", "delta": {"stop_reason": "end_turn"}, "usage": {"output_tokens": 2}},
    {"type": "message_stop"},
]


async def drain_stream(ai: Ai) -> str:
    async with (
        ai.ctx() as ctx,
        m06.agent_model(ctx) as model,
        model_request_stream(
            model.model, PROMPT, model_request_parameters=ModelRequestParameters()
        ) as stream,
    ):
        async for _ in stream:
            pass
        return stream.get().text or ""


async def test_overload_before_the_first_event_is_retried(
    ai: Ai, app: FastAPI, mock: respx.MockRouter
):
    models_ok(mock)
    await ai.provider("anthropic")
    route = mock.post(f"{ANTHROPIC}/v1/messages").mock(
        side_effect=[Response(429), Response(529), sse([START, *TEXT, *END])]
    )
    assert await drain_stream(ai) == "Hi"
    assert route.call_count == 3
    await ai.drain()
    [row] = await usage_rows(app)
    assert (row.status, row.input_tokens, row.output_tokens) == ("ok", 9, 2)


async def test_a_failure_after_the_first_event_is_not_retried(
    ai: Ai, app: FastAPI, mock: respx.MockRouter
):
    # Retrying would replay text the user has already seen.
    models_ok(mock)
    await ai.provider("anthropic")
    error = {"type": "error", "error": {"type": "overloaded_error", "message": "Overloaded"}}
    route = mock.post(f"{ANTHROPIC}/v1/messages").mock(
        side_effect=[sse([START, *TEXT, error]), sse([START, *TEXT, *END])]
    )
    with pytest.raises(AppError) as exc:
        await drain_stream(ai)
    assert exc.value.code.startswith("ai.")
    assert route.call_count == 1
    await ai.drain()
    [row] = await usage_rows(app)
    assert (row.status, row.error_code) == ("error", exc.value.code)


async def test_a_cancelled_stream_is_recorded(ai: Ai, app: FastAPI, mock: respx.MockRouter):
    models_ok(mock)
    await ai.provider("anthropic")
    mock.post(f"{ANTHROPIC}/v1/messages").mock(return_value=sse([START, *TEXT, *END]))

    async def stop_after_the_first_event() -> None:
        async with (
            ai.ctx() as ctx,
            m06.agent_model(ctx) as model,
            model_request_stream(
                model.model, PROMPT, model_request_parameters=ModelRequestParameters()
            ) as stream,
        ):
            async for _ in stream:
                raise asyncio.CancelledError

    with pytest.raises(asyncio.CancelledError):
        await stop_after_the_first_event()
    await ai.drain()
    [row] = await usage_rows(app)
    assert (row.status, row.error_code) == ("error", "ai.cancelled")


def responses_events(text: str) -> list[dict[str, Any]]:
    response = {
        "id": "resp_1",
        "object": "response",
        "created_at": 1,
        "model": "gpt-5",
        "status": "in_progress",
        "output": [],
        "parallel_tool_calls": True,
        "tool_choice": "auto",
        "tools": [],
    }
    item = {
        "type": "message",
        "id": "msg_1",
        "role": "assistant",
        "status": "in_progress",
        "content": [],
    }
    done_item = {
        **item,
        "status": "completed",
        "content": [{"type": "output_text", "text": text, "annotations": []}],
    }
    usage = {
        "input_tokens": 20,
        "input_tokens_details": {"cached_tokens": 0},
        "output_tokens": 4,
        "output_tokens_details": {"reasoning_tokens": 0},
        "total_tokens": 24,
    }
    return [
        {"type": "response.created", "sequence_number": 0, "response": response},
        {
            "type": "response.output_item.added",
            "sequence_number": 1,
            "output_index": 0,
            "item": item,
        },
        {
            "type": "response.output_text.delta",
            "sequence_number": 2,
            "item_id": "msg_1",
            "output_index": 0,
            "content_index": 0,
            "delta": text,
            "logprobs": [],
        },
        {
            "type": "response.output_item.done",
            "sequence_number": 3,
            "output_index": 0,
            "item": done_item,
        },
        {
            "type": "response.completed",
            "sequence_number": 4,
            "response": {**response, "status": "completed", "output": [done_item], "usage": usage},
        },
    ]


async def test_a_stream_drops_the_refused_reasoning_summary(
    ai: Ai, mock: respx.MockRouter, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(adapter_model, "_NO_SUMMARY", set())
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
        side_effect=[refused, sse(responses_events("ok"))]
    )
    assert await drain_stream(ai) == "ok"
    sent = [json.loads(call.request.content)["reasoning"] for call in route.calls]
    assert [r.get("summary") for r in sent] == ["auto", None]
    assert {(RESPONSES, provider["id"])} == adapter_model._NO_SUMMARY  # pyright: ignore[reportPrivateUsage]
