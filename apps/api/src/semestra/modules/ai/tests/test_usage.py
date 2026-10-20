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
    await add_event(app, uid, datetime(2026, 1, 15, 11, 0, tzinfo=UTC), cached_tokens=600)
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

    summary = await ai.call("GET", "/ai/usage", params={"days": 30, "tz": "America/Toronto"})
    assert summary["since"].startswith("2025-12-17")
    assert summary["until"] == "2026-01-15"
    assert summary["totals"] == {
        "calls": 4,
        "errors": 1,
        "input_tokens": 3000,
        "cached_tokens": 600,
        "output_tokens": 300,
        "cost_usd": 0.009,
    }
    assert summary["cost_complete"] is False
    assert [
        (d["date"], d["purpose"], d["calls"], d["input_tokens"]) for d in summary["by_day"]
    ] == [
        ("2026-01-14", "chat", 2, 1000),
        ("2026-01-15", "chat", 1, 1000),
        ("2026-01-15", "extraction", 1, 1000),
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

    everything = await ai.call("GET", "/ai/usage", params={"tz": "America/Toronto"})
    assert everything["since"].startswith("2025-11-30")  # the first call, in Toronto
    assert everything["totals"]["calls"] == 5

    one_day = await ai.call(
        "GET",
        "/ai/usage",
        params={"start": "2026-01-14", "end": "2026-01-14", "tz": "America/Toronto"},
    )
    assert one_day["since"].startswith("2026-01-14")
    assert one_day["until"] == "2026-01-14"
    assert [(r["key"], r["calls"]) for r in one_day["by_purpose"]] == [("chat", 2)]

    err = await ai.call(
        "GET", "/ai/usage", 422, params={"start": "2026-01-15", "end": "2026-01-14"}
    )
    assert err["error"]["code"] == "common.validation"

    err = await ai.call("GET", "/ai/usage", 422, params={"tz": "Mars/Base"})
    assert err["error"]["code"] == "common.validation"

    await login_as(client, other)
    assert (await ai.call("GET", "/ai/usage"))["totals"]["calls"] == 1
    empty = await ai.call("GET", "/ai/usage", params={"start": "2026-01-01", "end": "2026-01-01"})
    assert empty["totals"]["calls"] == 0


async def test_all_time_without_calls_starts_today(ai: Ai):
    summary = await ai.call("GET", "/ai/usage")
    assert summary["since"].startswith("2026-01-15")
    assert summary["until"] == "2026-01-15"
    assert summary["by_day"] == []


def test_cost_comes_from_genai_prices():
    full = catalog.estimate_cost("openai", None, "gpt-5-mini", 1_000_000, 0)
    assert full is not None
    assert full > 0
    # Cache reads cost less than fresh input.
    cached = catalog.estimate_cost("openai", None, "gpt-5-mini", 1_000_000, 0, 1_000_000)
    assert cached is not None
    assert cached < full
    # A compatible endpoint is recognised by its URL; a proxy for a first-party kind falls back.
    assert catalog.estimate_cost(
        "openai_compatible", "https://api.deepseek.com/v1", "deepseek-chat", 1000, 1000
    )
    assert catalog.estimate_cost(
        "openai", "https://proxy.example.com/v1", "gpt-5-mini", 1000, 0
    ) == round(full / 1000, 6)
    assert catalog.estimate_cost("openai", None, "unknown-model", 1, 1) is None
    assert (
        catalog.estimate_cost("openai_compatible", "http://localhost:8080/v1", "custom", 1, 1)
        is None
    )
    assert catalog.estimate_cost("ollama", "http://localhost:11434", "qwen3:8b", 5000, 5000) == 0.0
    assert catalog.context_window("claude-opus-5-5") == 200_000
    assert catalog.context_window("mystery") == 32_000
    assert catalog.default_model("anthropic", "embedding") is None
