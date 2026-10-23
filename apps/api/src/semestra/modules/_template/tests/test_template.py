"""End-to-end check of every M00 path with the module template (M00 §6, items 2 and 3)."""

from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from httpx import AsyncClient

import semestra.modules._template  # noqa: F401  (registers the template for this test session)
from semestra.core.capability import registry
from semestra.testing import MakeUser, UserHandle, collect_events

Login = Callable[[AsyncClient, UserHandle], Awaitable[str]]
RunJobs = Callable[[], Awaitable[None]]


async def test_read_capability_over_rest(client: AsyncClient, make_user: MakeUser, login_as: Login):
    r = await client.get("/template/echo", params={"text": "hi"})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "common.unauthenticated"

    await login_as(client, await make_user())
    r = await client.get("/template/echo", params={"text": "hello"})
    assert r.status_code == 200
    assert r.json() == {"text": "hello", "length": 5}

    r = await client.get("/template/echo", params={"text": ""})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "common.validation"


def test_capabilities_are_listed_for_agent_and_mcp() -> None:
    for surface in ("agent", "mcp"):
        names = {c.name for c in registry.list(expose=surface)}
        assert {"template.echo.get", "template.countdown.start"} <= names
    start = registry.get("template.countdown.start")
    assert start.effect == "write"
    assert start.input_model.model_json_schema()["properties"]["steps"]["maximum"] == 20
    assert registry.get("template.echo.get").operation_id == "templateEchoGet"


async def test_job_runs_reports_progress_and_streams_events(
    app: Any,
    client: AsyncClient,
    make_user: MakeUser,
    login_as: Login,
    run_jobs: RunJobs,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr("semestra.core.jobs.PROGRESS_THROTTLE_SECONDS", 0)
    user = await make_user()
    await login_as(client, user)
    with collect_events(app, user.id) as messages:
        r = await client.post("/template/countdown", json={"steps": 2})
        assert r.status_code == 200
        job = r.json()
        assert job["status"] == "pending"
        await run_jobs()

    r = await client.get(f"/jobs/{job['id']}")
    assert r.json()["status"] == "succeeded"
    assert r.json()["result"] == {"steps_done": 2}
    assert r.json()["progress"] == 100

    updates = [m["data"] for m in messages if m["type"] == "core.job.progress"]
    assert {u["job_id"] for u in updates} == {job["id"]}
    assert [(u["status"], u["progress"], u["step"], u["step_current"]) for u in updates] == [
        ("pending", 0, None, None),
        ("running", 0, None, None),
        ("running", 0, "counting", 0),
        ("running", 50, "counting", 1),
        ("succeeded", 100, "counting", 1),
    ]
    assert {"type": "template.countdown.finished", "data": {"job_id": job["id"]}} in messages


async def test_job_can_be_cancelled_and_is_private(
    client: AsyncClient, make_user: MakeUser, login_as: Login, run_jobs: RunJobs
):
    await login_as(client, await make_user())
    job = (await client.post("/template/countdown", json={})).json()

    r = await client.post(f"/jobs/{job['id']}/cancel")
    assert r.status_code == 200
    assert r.json()["status"] == "cancelled"
    await run_jobs()
    assert (await client.get(f"/jobs/{job['id']}")).json()["status"] == "cancelled"

    await login_as(client, await make_user(email="other@example.com"))
    for r in (
        await client.get(f"/jobs/{job['id']}"),
        await client.post(f"/jobs/{job['id']}/cancel"),
    ):
        assert r.status_code == 404
        assert r.json()["error"]["code"] == "common.not_found"
    assert (await client.get("/jobs")).json() == {"items": [], "next_cursor": None}
