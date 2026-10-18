"""Real provider calls (`pytest -m live`, skipped in CI). Keys come from the environment:
ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY."""

import os

import pytest
from pydantic import BaseModel

from semestra.modules import ai as m06
from semestra.modules.ai.llm import Message
from semestra.modules.ai.tests.conftest import Ai

pytestmark = pytest.mark.live

KEYS = {"anthropic": "ANTHROPIC_API_KEY", "openai": "OPENAI_API_KEY", "gemini": "GEMINI_API_KEY"}


class Capital(BaseModel):
    city: str


@pytest.mark.parametrize("kind", list(KEYS))
async def test_real_provider(ai: Ai, kind: str):
    key = os.environ.get(KEYS[kind])
    if not key:
        pytest.skip(f"{KEYS[kind]} is not set")
    await ai.provider(kind, api_key=key)
    async with ai.ctx() as ctx:
        reply = await m06.complete(ctx, "title", [Message.user("Say OK.")], source_module="live")
        assert isinstance(reply, m06.Completion)
        assert reply.text
        capital = await m06.structured(
            ctx,
            "extraction",
            [Message.user("What is the capital of France?")],
            Capital,
            source_module="live",
        )
        assert "paris" in capital.city.lower()
