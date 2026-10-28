"""Providers, keys, model choices and status over HTTP (M06 §6, §9)."""

import respx
from fastapi import FastAPI
from httpx import AsyncClient, Response
from sqlalchemy import select
from structlog.testing import capture_logs

from semestra.core.security import decrypt
from semestra.modules.ai.models import AiModelAssignment, AiProvider
from semestra.modules.ai.tests.conftest import (
    ANTHROPIC,
    ANTHROPIC_KEY,
    COMPAT,
    OPENAI,
    OPENAI_KEY,
    Ai,
    LoginAs,
    models_ok,
)
from semestra.testing import MakeUser, collect_events


async def test_create_checks_the_key_and_stores_it_encrypted(
    ai: Ai, mock: respx.MockRouter, app: FastAPI
):
    models_ok(mock)
    with capture_logs() as logs:
        created = await ai.provider("anthropic")
    assert created["kind"] == "anthropic"
    assert created["display_name"] == "Anthropic"
    assert created["key_hint"] == "sk-…wxyz"
    assert created["capabilities"] == ["chat", "tools", "vision", "structured"]
    assert created["capabilities_editable"] is False
    assert created["last_checked_at"] is not None
    request = mock.calls.last.request
    assert request.headers["x-api-key"] == ANTHROPIC_KEY

    async with app.state.session_factory() as db:
        row = (await db.scalars(select(AiProvider))).one()
    assert row.api_key_encrypted
    assert ANTHROPIC_KEY not in row.api_key_encrypted
    assert decrypt(app.state.settings, row.api_key_encrypted) == ANTHROPIC_KEY

    listed = await ai.call("GET", "/ai/providers")
    assert ANTHROPIC_KEY not in str(listed)
    assert ANTHROPIC_KEY not in str(created)
    assert ANTHROPIC_KEY not in str(logs)


async def test_bad_key_is_rejected_with_the_reason(ai: Ai, mock: respx.MockRouter):
    mock.get(f"{OPENAI}/models").mock(return_value=Response(401, json={"error": {}}))
    body = await ai.call(
        "POST", "/ai/providers", 400, json={"kind": "openai", "api_key": OPENAI_KEY}
    )
    assert body["error"]["code"] == "ai.provider_check_failed"
    assert body["error"]["params"] == {"reason": "ai.invalid_key"}
    assert (await ai.call("GET", "/ai/providers"))["items"] == []


async def test_required_fields_per_kind(ai: Ai, mock: respx.MockRouter):
    models_ok(mock)
    for body in (
        {"kind": "anthropic"},
        {"kind": "openai_compatible"},
        {"kind": "ollama", "base_url": "ftp://x"},
        {"kind": "anthropic", "api_key": "k" * 20, "capabilities": ["chat"]},
    ):
        err = await ai.call("POST", "/ai/providers", 422, json=body)
        assert err["error"]["code"] == "common.validation"


async def test_compatible_endpoint_chooses_capabilities_and_may_not_list_models(
    ai: Ai, mock: respx.MockRouter
):
    mock.get(f"{COMPAT}/models").mock(return_value=Response(404))
    created = await ai.provider("openai_compatible", capabilities=["chat", "vision"])
    assert created["capabilities"] == ["chat", "vision"]
    assert created["capabilities_editable"] is True
    assert created["key_hint"] is None
    models = await ai.call("GET", f"/ai/providers/{created['id']}/models")
    assert models == {"items": [], "manual_entry": True}


async def test_private_base_url_is_refused(ai: Ai):
    # No HTTP mock: safe_client refuses to dial the loopback address itself.
    body = await ai.call(
        "POST",
        "/ai/providers",
        400,
        json={"kind": "openai_compatible", "base_url": "http://127.0.0.1:9/v1"},
    )
    assert body["error"]["params"] == {"reason": "common.egress_blocked"}


async def test_update_rechecks_a_new_key(ai: Ai, mock: respx.MockRouter, app: FastAPI):
    models_ok(mock)
    created = await ai.provider("openai")
    route = mock.get(f"{OPENAI}/models")
    calls_before = route.call_count
    renamed = await ai.call(
        "PATCH", f"/ai/providers/{created['id']}", json={"display_name": "Work"}
    )
    assert renamed["display_name"] == "Work"
    assert route.call_count == calls_before

    route.mock(return_value=Response(401))
    err = await ai.call(
        "PATCH", f"/ai/providers/{created['id']}", 400, json={"api_key": "sk-new-key-0000000000"}
    )
    assert err["error"]["params"]["reason"] == "ai.invalid_key"
    async with app.state.session_factory() as db:
        row = await db.get(AiProvider, created["id"])
        assert row is not None
        assert decrypt(app.state.settings, row.api_key_encrypted or "") == OPENAI_KEY

    route.mock(return_value=Response(200, json={"data": []}))
    rekeyed = await ai.call(
        "PATCH", f"/ai/providers/{created['id']}", json={"api_key": "sk-new-key-0000009999"}
    )
    assert rekeyed["key_hint"] == "sk-…9999"


async def test_other_users_cannot_see_or_touch_a_provider(
    ai: Ai, mock: respx.MockRouter, make_user: MakeUser, login_as: LoginAs, client: AsyncClient
):
    models_ok(mock)
    created = await ai.provider("anthropic")
    other = await make_user(email="other@example.com")
    await login_as(client, other)
    assert (await ai.call("GET", "/ai/providers"))["items"] == []
    for method, url in (
        ("PATCH", f"/ai/providers/{created['id']}"),
        ("DELETE", f"/ai/providers/{created['id']}"),
        ("POST", f"/ai/providers/{created['id']}:test"),
        ("GET", f"/ai/providers/{created['id']}/models"),
    ):
        kwargs = {"json": {"display_name": "x"}} if method == "PATCH" else {}
        body = await ai.call(method, url, 404, **kwargs)
        assert body["error"]["code"] == "common.not_found"
    err = await ai.call(
        "PUT",
        "/ai/assignments",
        404,
        json={"purpose": "chat", "provider_id": created["id"], "model": "x"},
    )
    assert err["error"]["code"] == "common.not_found"


async def test_status_assignments_and_delete(ai: Ai, mock: respx.MockRouter, app: FastAPI):
    status = await ai.call("GET", "/ai/status")
    assert all(not s["available"] for s in status["items"])

    models_ok(mock)
    with collect_events(app, ai.user.id) as seen:
        anthropic = await ai.provider("anthropic")
    types = [e["type"] for e in seen]
    assert "ai.provider.created" in types
    changed = {e["data"]["purpose"] for e in seen if e["type"] == "ai.assignment.updated"}
    assert changed == {"chat", "extraction", "vision", "ocr", "title"}

    status = {s["purpose"]: s for s in (await ai.call("GET", "/ai/status"))["items"]}
    assert status["chat"]["available"]
    assert status["chat"]["source"] == "default"
    assert status["chat"]["model"] == "claude-sonnet-5-5"
    assert status["ocr"]["model"] == "claude-haiku-5-5"  # a cheaper model reads scanned pages
    assert status["title"]["model"] == "claude-haiku-5-5"
    assert not status["embedding"]["available"]  # Anthropic has no embeddings

    openai = await ai.provider("openai")
    status = {s["purpose"]: s for s in (await ai.call("GET", "/ai/status"))["items"]}
    assert status["embedding"]["provider_id"] == openai["id"]
    assert status["chat"]["provider_id"] == anthropic["id"]  # the older provider stays first

    with collect_events(app, ai.user.id) as seen:
        assignments = await ai.call(
            "PUT",
            "/ai/assignments",
            json={
                "purpose": "chat",
                "provider_id": openai["id"],
                "model": "gpt-5-mini",
                "params": {"temperature": 0.2},
            },
        )
    assert [e["data"] for e in seen if e["type"] == "ai.assignment.updated"] == [
        {"purpose": "chat"}
    ]
    chat = next(a for a in assignments["items"] if a["purpose"] == "chat")
    assert (chat["provider_id"], chat["model"], chat["params"]["temperature"]) == (
        openai["id"],
        "gpt-5-mini",
        0.2,
    )
    assert chat["recommended"] == {"provider_id": anthropic["id"], "model": "claude-sonnet-5-5"}
    status = {s["purpose"]: s for s in (await ai.call("GET", "/ai/status"))["items"]}
    assert (status["chat"]["source"], status["chat"]["model"]) == ("assignment", "gpt-5-mini")

    err = await ai.call(
        "PUT",
        "/ai/assignments",
        400,
        json={"purpose": "embedding", "provider_id": anthropic["id"], "model": "x"},
    )
    assert err["error"]["code"] == "ai.capability_unsupported"

    deleted = await ai.call("DELETE", f"/ai/providers/{openai['id']}")
    assert deleted["cleared_purposes"] == ["chat"]
    async with app.state.session_factory() as db:
        assert (await db.scalars(select(AiModelAssignment))).all() == []
    status = {s["purpose"]: s for s in (await ai.call("GET", "/ai/status"))["items"]}
    assert status["chat"]["provider_id"] == anthropic["id"]
    assert not status["embedding"]["available"]

    await ai.call("DELETE", f"/ai/providers/{anthropic['id']}")
    status = await ai.call("GET", "/ai/status")
    assert all(not s["available"] for s in status["items"])


async def test_disabled_provider_is_skipped(ai: Ai, mock: respx.MockRouter):
    models_ok(mock)
    created = await ai.provider("anthropic")
    await ai.call(
        "PUT",
        "/ai/assignments",
        json={"purpose": "chat", "provider_id": created["id"], "model": "claude-opus-5-5"},
    )
    await ai.call("PATCH", f"/ai/providers/{created['id']}", json={"enabled": False})
    status = await ai.call("GET", "/ai/status")
    assert all(not s["available"] for s in status["items"])


async def test_assignment_falls_back_when_its_capability_is_unticked(
    ai: Ai, mock: respx.MockRouter
):
    mock.get(f"{COMPAT}/models").mock(return_value=Response(200, json={"data": [{"id": "m"}]}))
    created = await ai.provider("openai_compatible", capabilities=["chat", "vision"])
    await ai.call(
        "PUT",
        "/ai/assignments",
        json={"purpose": "vision", "provider_id": created["id"], "model": "m"},
    )

    async def vision_available() -> bool:
        status = await ai.call("GET", "/ai/status")
        return next(s for s in status["items"] if s["purpose"] == "vision")["available"]

    assert await vision_available()
    await ai.call("PATCH", f"/ai/providers/{created['id']}", json={"capabilities": ["chat"]})
    assert not await vision_available()


async def test_test_and_models_endpoints(ai: Ai, mock: respx.MockRouter):
    models_ok(mock)
    created = await ai.provider("anthropic")
    models = await ai.call("GET", f"/ai/providers/{created['id']}/models")
    assert models == {
        "items": [{"id": "claude-sonnet-5-5", "display_name": "S"}],
        "manual_entry": False,
    }
    route = mock.get(f"{ANTHROPIC}/v1/models")
    count = route.call_count
    await ai.call("GET", f"/ai/providers/{created['id']}/models")
    assert route.call_count == count  # cached for an hour

    route.mock(return_value=Response(401))
    check = await ai.call("POST", f"/ai/providers/{created['id']}:test")
    assert (check["ok"], check["error_code"]) == (False, "ai.invalid_key")
    listed = (await ai.call("GET", "/ai/providers"))["items"][0]
    assert listed["last_error_code"] == "ai.invalid_key"


async def test_capabilities_are_http_only():
    from semestra.core.capability import registry

    names = [c.name for c in registry.list(expose="agent") if c.name.startswith("ai.")]
    assert names == []
    assert {c.name for c in registry.list(expose="http") if c.name.startswith("ai.")} == {
        "ai.provider.list",
        "ai.provider.create",
        "ai.provider.update",
        "ai.provider.delete",
        "ai.provider.test",
        "ai.provider.list_models",
        "ai.assignment.get",
        "ai.assignment.update",
        "ai.status.get",
        "ai.usage.summarize",
    }
