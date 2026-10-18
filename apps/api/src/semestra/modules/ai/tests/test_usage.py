"""Usage summary: days in the user's time zone, groups and cost estimates (M06 §6)."""

from datetime import UTC, datetime

from fastapi import FastAPI
from httpx import AsyncClient

from semestra.core.db import new_id
from semestra.modules.ai import catalog
from semestra.modules.ai.models import AiUsageEvent
from semestra.modules.ai.tests.conftest import Ai, LoginAs
from semestra.testing import MakeUser


async def add_event(app: FastAPI, user_id: str, at: datetime, **fields: object) -> None:
    values: dict[str, object] = {
        "purpose": "chat",
        "provider_kind": "anthropic",
        "model": "claude-sonnet-5-5",
        "source_module": "agent",
        "input_tokens": 1000,
        "output_tokens": 100,
        "cost_usd_estimate": 0.0045,
        "duration_ms": 10,
        "status": "ok",
        **fields,
    }
    async with app.state.session_factory() as db:
        db.add(AiUsageEvent(id=new_id(), user_id=user_id, created_at=at, **values))
        await db.commit()


async def test_summary_groups_by_local_day_purpose_module_and_model(
    ai: Ai, app: FastAPI, make_user: MakeUser, login_as: LoginAs, client: AsyncClient
):
    # The test clock is 2026-01-15 12:00 UTC.
    uid = ai.user.id
    await add_event(app, uid, datetime(2026, 1, 15, 3, 0, tzinfo=UTC))  # Jan 14 in Toronto
    await add_event(app, uid, datetime(2026, 1, 15, 11, 0, tzinfo=UTC))
    await add_event(
        app,
        uid,
        datetime(2026, 1, 15, 11, 30, tzinfo=UTC),
        purpose="extraction",
        source_module="imports",
        provider_kind="openai_compatible",
        model="custom",
        cost_usd_estimate=None,
    )
    await add_event(
        app,
        uid,
        datetime(2026, 1, 14, 9, 0, tzinfo=UTC),
        status="error",
        error_code="ai.timeout",
        input_tokens=0,
        output_tokens=0,
        cost_usd_estimate=None,
    )
    await add_event(app, uid, datetime(2025, 12, 1, tzinfo=UTC))  # outside 30 days
    other = await make_user(email="other@example.com")
    await add_event(app, other.id, datetime(2026, 1, 15, 11, 0, tzinfo=UTC))

    summary = await ai.call("GET", "/ai/usage", params={"tz": "America/Toronto"})
    assert summary["since"].startswith("2025-12-17")
    assert summary["totals"] == {
        "calls": 4,
        "errors": 1,
        "input_tokens": 3000,
        "output_tokens": 300,
        "cost_usd": 0.009,
    }
    assert summary["cost_complete"] is False
    assert [(d["date"], d["purpose"], d["input_tokens"]) for d in summary["by_day"]] == [
        ("2026-01-14", "chat", 1000),
        ("2026-01-15", "chat", 1000),
        ("2026-01-15", "extraction", 1000),
    ]
    assert [(r["key"], r["calls"]) for r in summary["by_purpose"]] == [
        ("chat", 3),
        ("extraction", 1),
    ]
    assert {r["key"] for r in summary["by_module"]} == {"agent", "imports"}
    assert {r["key"] for r in summary["by_model"]} == {
        "anthropic/claude-sonnet-5-5",
        "openai_compatible/custom",
    }

    utc = await ai.call("GET", "/ai/usage", params={"days": 1})
    assert utc["totals"]["calls"] == 3

    err = await ai.call("GET", "/ai/usage", 422, params={"tz": "Mars/Base"})
    assert err["error"]["code"] == "common.validation"

    await login_as(client, other)
    assert (await ai.call("GET", "/ai/usage"))["totals"]["calls"] == 1


def test_pricing_uses_the_longest_prefix():
    assert catalog.estimate_cost("openai", "gpt-5-mini-2025-08-07", 1_000_000, 0) == 0.25
    assert catalog.estimate_cost("openai", "gpt-5", 1_000_000, 1_000_000) == 11.25
    assert catalog.estimate_cost("openai", "unknown", 1, 1) is None
    assert catalog.estimate_cost("ollama", "qwen3:8b", 5000, 5000) == 0.0
    assert catalog.context_window("claude-opus-5-5") == 200_000
    assert catalog.context_window("mystery") == 32_000
    assert catalog.default_model("anthropic", "embedding") is None
