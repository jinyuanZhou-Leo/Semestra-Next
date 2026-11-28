"""The monthly usage limit: background calls pause at it, the user's own calls do not (M06 §7.1)."""

from datetime import UTC, datetime

import pytest
import respx
from fastapi import FastAPI

from semestra.core.errors import AppError
from semestra.modules import ai as m06
from semestra.modules.ai.llm import Message
from semestra.modules.ai.tests.conftest import ANTHROPIC, Ai, models_ok
from semestra.modules.ai.tests.test_calls import anthropic_reply
from semestra.modules.ai.tests.test_usage import add_event
from semestra.testing import collect_events

# The test clock is 2026-01-15 12:00 UTC.
THIS_MONTH = datetime(2026, 1, 10, tzinfo=UTC)
LAST_MONTH = datetime(2025, 12, 31, 12, tzinfo=UTC)
HI = [Message.user("hi")]


async def set_limit(ai: Ai, amount: float | None) -> None:
    await ai.call(
        "PATCH",
        "/me/settings/ai.usage",
        json={"scope_type": "account", "values": {"monthly_limit_usd": amount}},
    )


async def limit_state(ai: Ai) -> dict[str, object]:
    return (await ai.call("GET", "/ai/status"))["usage_limit"]


async def test_no_limit_by_default_and_only_this_month_counts(ai: Ai, app: FastAPI):
    await add_event(app, ai.user.id, THIS_MONTH, cost_usd_estimate=0.5)
    await add_event(app, ai.user.id, THIS_MONTH, cost_usd_estimate=None)  # no known price
    await add_event(app, ai.user.id, LAST_MONTH, cost_usd_estimate=9.0)
    assert await limit_state(ai) == {
        "monthly_limit_usd": None,
        "spent_usd": 0.5,
        "reached": False,
        "resets_on": "2026-02-01",
    }

    await set_limit(ai, 0.5)
    state = await limit_state(ai)
    assert state["monthly_limit_usd"] == 0.5
    assert state["reached"] is True

    await set_limit(ai, None)  # back to no limit
    assert (await limit_state(ai))["reached"] is False


async def test_the_limit_must_be_above_zero(ai: Ai):
    await ai.call(
        "PATCH",
        "/me/settings/ai.usage",
        422,
        json={"scope_type": "account", "values": {"monthly_limit_usd": 0}},
    )


async def test_background_calls_pause_at_the_limit_but_the_users_own_still_run(
    ai: Ai, app: FastAPI, mock: respx.MockRouter
):
    models_ok(mock)
    await ai.provider("anthropic")
    route = mock.post(f"{ANTHROPIC}/v1/messages").mock(return_value=anthropic_reply())
    await add_event(app, ai.user.id, THIS_MONTH, cost_usd_estimate=1.0)
    await set_limit(ai, 1.0)

    async with ai.ctx() as ctx:
        with pytest.raises(AppError) as exc:
            await m06.complete(ctx, "chat", HI, source_module="t", background=True)
        assert exc.value.code == "ai.usage_limit_reached"
        assert route.call_count == 0

        await m06.complete(ctx, "chat", [Message.user("hi")], source_module="t")
    assert route.call_count == 1

    await set_limit(ai, 5.0)  # raised: background calls run again
    async with ai.ctx() as ctx:
        await m06.complete(ctx, "chat", HI, source_module="t", background=True)
    assert route.call_count == 2


async def test_the_call_that_reaches_the_limit_tells_open_pages(
    ai: Ai, app: FastAPI, mock: respx.MockRouter
):
    models_ok(mock)
    await ai.provider("anthropic")
    # A thousand times the usual answer, so the estimate is clearly above the remaining cent.
    mock.post(f"{ANTHROPIC}/v1/messages").mock(
        return_value=anthropic_reply(input_tokens=200_000, output_tokens=20_000)
    )
    await add_event(app, ai.user.id, THIS_MONTH, cost_usd_estimate=0.99)
    await set_limit(ai, 1.0)

    with collect_events(app, ai.user.id) as pushed:
        async with ai.ctx() as ctx:
            await m06.complete(ctx, "chat", [Message.user("hi")], source_module="t")
    assert {"type": "ai.usage.limit_reached", "data": {}} in pushed
    assert (await limit_state(ai))["reached"] is True

    with collect_events(app, ai.user.id) as pushed:  # already past it: said once
        async with ai.ctx() as ctx:
            await m06.complete(ctx, "chat", [Message.user("hi")], source_module="t")
    assert {"type": "ai.usage.limit_reached", "data": {}} not in pushed
