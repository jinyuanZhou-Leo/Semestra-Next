"""What the assistant sends a real provider (Anthropic, through respx): finding a tool must not
change the tool list, or the provider's prompt cache misses (M12 §4.2)."""

import json
from typing import Any

import respx
from fastapi import FastAPI
from httpx import Response

from semestra.modules.agent import runtime
from semestra.modules.agent.tests.conftest import Agent
from semestra.modules.ai.adapters import base
from semestra.modules.ai.tests.conftest import ANTHROPIC, ANTHROPIC_KEY, models_ok


def _sse(*blocks: dict[str, Any], stop: str) -> Response:
    events: list[dict[str, Any]] = [
        {
            "type": "message_start",
            "message": {
                "id": "msg_1",
                "type": "message",
                "role": "assistant",
                "content": [],
                "model": "claude-sonnet-5-5",
                "usage": {"input_tokens": 100, "output_tokens": 0},
            },
        }
    ]
    for i, block in enumerate(blocks):
        if block["type"] == "text":
            events += [
                {
                    "type": "content_block_start",
                    "index": i,
                    "content_block": {"type": "text", "text": ""},
                },
                {
                    "type": "content_block_delta",
                    "index": i,
                    "delta": {"type": "text_delta", "text": block["text"]},
                },
            ]
        else:
            events += [
                {
                    "type": "content_block_start",
                    "index": i,
                    "content_block": {
                        "type": "tool_use",
                        "id": block["id"],
                        "name": block["name"],
                        "input": {},
                    },
                },
                {
                    "type": "content_block_delta",
                    "index": i,
                    "delta": {
                        "type": "input_json_delta",
                        "partial_json": json.dumps(block["input"]),
                    },
                },
            ]
        events.append({"type": "content_block_stop", "index": i})
    events += [
        {"type": "message_delta", "delta": {"stop_reason": stop}, "usage": {"output_tokens": 5}},
        {"type": "message_stop"},
    ]
    body = "".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n" for e in events)
    return Response(200, text=body, headers={"content-type": "text/event-stream"})


async def test_finding_a_tool_keeps_the_anthropic_tool_list(
    agent: Agent, app: FastAPI, monkeypatch: Any
):
    monkeypatch.setattr(base, "RETRY_BASE_SECONDS", 0)
    app.state.agent.chat_model = runtime._chat_model  # pyright: ignore[reportPrivateUsage]
    with respx.mock(assert_all_called=False, assert_all_mocked=True) as mock:
        models_ok(mock)  # pyright: ignore[reportArgumentType]
        await agent.call(
            "POST", "/ai/providers", json={"kind": "anthropic", "api_key": ANTHROPIC_KEY}
        )
        search = {
            "type": "tool_use",
            "id": "toolu_1",
            "name": "search_tools",
            "input": {"queries": ["schedule meeting list"]},
        }
        route = mock.post(f"{ANTHROPIC}/v1/messages").mock(
            side_effect=[
                _sse(search, stop="tool_use"),
                _sse({"type": "text", "text": "Found it."}, stop="end_turn"),
            ]
        )
        session = await agent.session()
        events = await agent.send(session["id"], "show my meetings")

    assert [n for n, _ in events if n == "error"] == []
    first, second = (json.loads(c.request.content) for c in route.calls)
    meetings = next(t for t in first["tools"] if t["name"] == "schedule__meeting__list")
    assert meetings.get("defer_loading") is True
    assert second["tools"] == first["tools"]
    assert second["system"] == first["system"]
