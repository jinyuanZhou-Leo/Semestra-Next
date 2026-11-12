"""The background course sync (M09 §4.8) with the fake provider: imported assignments follow the
platform, what the user changed too is asked about, new and removed assignments wait for the
user, and the scheduler syncs what is due."""

from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi import FastAPI

from semestra.core.context import system_ctx
from semestra.modules.lms import sync
from semestra.modules.lms.errors import lms_error
from semestra.modules.lms.schemas.dto import Announcement, Submission
from semestra.modules.lms.tests.conftest import Api, FakeProvider
from semestra.modules.lms.tests.test_lms import setup_program
from semestra.testing import Clock, collect_events

pytestmark = pytest.mark.usefixtures("fake")


async def _course(api: Api, *external_ids: str) -> tuple[str, str]:
    """A Program with one linked course and these assignments imported into its gradebook."""
    program_id, term_id, _ = await setup_program(api)
    course = await api.course(program_id, term_id)
    await api.link(course, "101")
    if external_ids:
        await api.call(
            "POST",
            f"/courses/{course}/lms/imports:assignments",
            json={"external_ids": list(external_ids)},
        )
    return program_id, course


async def _assessments(api: Api, course: str) -> dict[str, dict[str, Any]]:
    items = (await api.call("GET", f"/courses/{course}/assessments"))["items"]
    return {a["source_ref"].rsplit(":", 1)[-1]: a for a in items if a["source_ref"]}


async def test_imported_assignments_follow_the_platform(api: Api, fake: FakeProvider, clock: Clock):
    program_id, course = await _course(api, "a1", "a2", "a3")
    labs = fake.course_assignments["101"]
    labs[0] = labs[0].model_copy(
        update={"name": "Lab 1 (revised)", "points": 20,
                "due_at": datetime(2026, 2, 13, 4, 59, tzinfo=UTC)}
    )  # fmt: skip
    status = await api.sync(program_id)
    # Lab 2 changed nothing itself, but its share of the Labs' points fell: 15% -> 12%.
    changes = {(c["title"], c["field"]): (c["old"], c["new"]) for c in status["recent"]}
    assert changes == {
        ("Lab 1 (revised)", "title"): ("Lab 1", "Lab 1 (revised)"),
        ("Lab 1 (revised)", "due_at"): (
            {"date": "2026-02-06", "time": "23:59:00"},
            {"date": "2026-02-12", "time": "23:59:00"},
        ),
        ("Lab 1 (revised)", "weight"): (5, 8),
        ("Lab 2", "weight"): (15, 12),
    }
    assert status["pending"] == []
    lab = (await _assessments(api, course))["a1"]
    assert (lab["title"], lab["due_date"], lab["weight"]) == ("Lab 1 (revised)", "2026-02-12", 8)

    # Putting a change back keeps the user's value: the platform's next change asks.
    title = next(c for c in status["recent"] if c["field"] == "title")
    status = await api.call("POST", f"/lms/sync/changes/{title['id']}:revert")
    assert next(c for c in status["recent"] if c["id"] == title["id"])["reverted"]
    assert (await _assessments(api, course))["a1"]["title"] == "Lab 1"
    clock.advance(minutes=1)
    status = await api.sync(program_id)
    assert status["pending"] == []  # the platform did not change it again
    labs[0] = labs[0].model_copy(update={"name": "Lab 1 (final)"})
    status = await api.sync(program_id)
    [asked] = status["pending"]
    assert asked["kind"] == "conflict"
    assert asked["conflicts"] == [{"field": "title", "mine": "Lab 1", "platform": "Lab 1 (final)"}]
    status = await api.call(
        "POST", f"/lms/sync/items/{asked['id']}:resolve", json={"choice": "platform"}
    )
    assert status["pending"] == []
    assert (await _assessments(api, course))["a1"]["title"] == "Lab 1 (final)"

    # A field the user changed stays theirs while the platform leaves it; the others follow.
    midterm = (await _assessments(api, course))["a3"]
    await api.call("PATCH", f"/assessments/{midterm['id']}", json={"title": "Midterm (mine)"})
    labs[2] = labs[2].model_copy(update={"due_at": datetime(2026, 3, 8, 15, 0, tzinfo=UTC)})
    status = await api.sync(program_id)
    assert status["pending"] == []
    midterm = (await _assessments(api, course))["a3"]
    assert (midterm["title"], midterm["due_date"]) == ("Midterm (mine)", "2026-03-08")
    # Keeping their value when the platform renames it too: not asked again until it changes.
    labs[2] = labs[2].model_copy(update={"name": "Midterm (room B)"})
    [asked] = (await api.sync(program_id))["pending"]
    await api.call("POST", f"/lms/sync/items/{asked['id']}:resolve", json={"choice": "mine"})
    assert (await api.sync(program_id))["pending"] == []
    assert (await _assessments(api, course))["a3"]["title"] == "Midterm (mine)"
    err = await api.call(
        "POST", f"/lms/sync/items/{asked['id']}:resolve", 409, json={"choice": "platform"}
    )
    assert err["error"]["code"] == "lms.sync_nothing_to_resolve"


async def test_a_new_grade_is_applied_and_announced(api: Api, app: FastAPI, fake: FakeProvider):
    program_id, course = await _course(api, "a1", "a2")
    user_id = (await api.call("GET", "/account/me"))["id"]
    labs = fake.course_assignments["101"]
    labs[1] = labs[1].model_copy(update={"submission": Submission(state="graded", score=27)})
    with collect_events(app, user_id) as messages:
        await api.sync(program_id)
    lab2 = (await _assessments(api, course))["a2"]
    assert (lab2["points_earned"], lab2["points_possible"]) == (27, 30)
    [synced] = [m["data"] for m in messages if m["type"] == sync.SYNCED]
    assert synced["applied"] == [
        {"change_id": synced["applied"][0]["change_id"], "name": "Lab 2", "field": "score"}
    ]
    # Told once: the next sync finds nothing to do.
    with collect_events(app, user_id) as messages:
        await api.sync(program_id)
    [synced] = [m["data"] for m in messages if m["type"] == sync.SYNCED]
    assert synced["applied"] == []


async def test_new_assignments_wait_for_the_user(api: Api, fake: FakeProvider):
    program_id, course = await _course(api, "a1")
    labs = fake.course_assignments["101"]
    # One already due is not offered: the user can still import it from the platform's list.
    labs.append(
        labs[0].model_copy(update={"external_id": "a4", "name": "Quiz 0",
                                   "due_at": datetime(2026, 1, 10, tzinfo=UTC)})
    )  # fmt: skip
    status = await api.sync(program_id)
    assert [(i["kind"], i["title"]) for i in status["pending"]] == [
        ("new", "Lab 2"),
        ("new", "Midterm"),
    ]
    lab2, midterm = status["pending"]

    # Ignored: listed apart, offered again on request.
    path = f"/programs/{program_id}/lms/sync:dismiss"
    status = await api.call("POST", path, json={"item_ids": [lab2["id"]]})
    assert [i["title"] for i in status["pending"]] == ["Midterm"]
    assert [i["title"] for i in status["ignored"]] == ["Lab 2"]
    assert [i["title"] for i in (await api.sync(program_id))["ignored"]] == ["Lab 2"]
    status = await api.call("POST", path, json={"item_ids": [lab2["id"]], "dismissed": False})
    assert [i["title"] for i in status["pending"]] == ["Lab 2", "Midterm"]

    # Importing one takes it off the list; one gone from the platform goes too.
    await api.call(
        "POST", f"/courses/{course}/lms/imports:assignments", json={"external_ids": ["a3"]}
    )
    assert [i["id"] for i in (await api.call("GET", f"/programs/{program_id}/lms/sync"))[
        "pending"
    ]] == [lab2["id"]]  # fmt: skip
    assert "a3" in await _assessments(api, course)
    del labs[1]
    status = await api.sync(program_id)
    assert (status["pending"], status["ignored"]) == ([], [])
    assert midterm["id"] != lab2["id"]


async def test_an_assignment_gone_from_the_platform_is_kept_or_deleted(
    api: Api, fake: FakeProvider
):
    program_id, course = await _course(api, "a1", "a2", "a3")
    labs = fake.course_assignments["101"]
    del labs[:2]
    status = await api.sync(program_id)
    assert [(i["kind"], i["title"]) for i in status["pending"]] == [
        ("removed", "Lab 1"),
        ("removed", "Lab 2"),
    ]
    lab1, lab2 = status["pending"]
    before = await _assessments(api, course)
    await api.call("POST", f"/lms/sync/items/{lab1['id']}:resolve", json={"choice": "keep"})
    status = await api.call(
        "POST", f"/lms/sync/items/{lab2['id']}:resolve", json={"choice": "delete"}
    )
    assert status["pending"] == []
    items = (await api.call("GET", f"/courses/{course}/assessments"))["items"]
    # Kept as made by hand; the other one is gone.
    assert [(a["id"], a["source_ref"]) for a in items if a["title"].startswith("Lab")] == [
        (before["a1"]["id"], None)
    ]


async def test_a_bound_assessment_fills_in_what_it_lacks_and_asks_about_the_rest(
    api: Api, fake: FakeProvider
):
    program_id, course = await _course(api)
    labs = fake.course_assignments["101"]
    labs.append(
        labs[1].model_copy(update={"external_id": "a6", "name": "Essay", "group_id": "g9",
                                   "submission": Submission(state="graded", score=20)})
    )  # fmt: skip
    made = await api.call(
        "POST", f"/courses/{course}/assessments", json={"title": "My essay", "weight": 3}
    )
    await api.call("PUT", f"/assessments/{made['id']}/lms-assignment", json={"assignment_id": "a6"})
    status = await api.sync(program_id)
    essay = next(
        a
        for a in (await api.call("GET", f"/courses/{course}/assessments"))["items"]
        if a["id"] == made["id"]
    )
    # Its name stays; the due date and grade it lacked come; its weight differs: asked.
    assert (essay["title"], essay["due_date"], essay["points_earned"]) == (
        "My essay",
        "2026-02-20",
        20,
    )
    assert {c["field"] for c in status["recent"]} == {"due_at", "score"}
    [asked] = [i for i in status["pending"] if i["kind"] == "conflict"]
    assert [c["field"] for c in asked["conflicts"]] == ["weight"]


async def test_a_course_that_cannot_be_read_keeps_its_error(
    api: Api, fake: FakeProvider, monkeypatch: pytest.MonkeyPatch
):
    program_id, course = await _course(api, "a1")
    await api.sync(program_id)

    async def moved(*_: Any) -> Any:
        raise lms_error("lms.invalid_config", field="base_url", reason="redirect")

    with monkeypatch.context() as mp:
        mp.setattr(type(fake), "get_course", moved)
        fake.calls.clear()
        status = await api.sync(program_id)
    # The other stages would fail the same way: not tried.
    assert not any(kind == "assignments" for kind, _ in fake.calls)
    assert [(e["stage"], e["code"]) for e in status["errors"]] == [("course", "lms.invalid_config")]
    assert status["connection_error"] == "lms.invalid_config"

    # A broken stage does not stop the others, and a sync that works clears the errors.
    async def broken(*_: Any) -> Any:
        raise RuntimeError("provider bug")

    with monkeypatch.context() as mp:
        mp.setattr(type(fake), "assignments", broken)
        fake.calls.clear()
        status = await api.sync(program_id)
    assert [(e["stage"], e["code"]) for e in status["errors"]] == [
        ("assignments", "common.internal")
    ]
    assert any(kind == "announcements" for kind, _ in fake.calls)
    assert status["connection_error"] is None
    status = await api.sync(program_id, course)
    assert status["errors"] == []
    assert status["synced_at"] is not None


async def test_announcements_since_the_last_sync_are_told(
    api: Api, app: FastAPI, fake: FakeProvider, clock: Clock
):
    program_id, _ = await _course(api)
    user_id = (await api.call("GET", "/account/me"))["id"]

    async def posted(*_: Any, **__: Any) -> Sequence[Announcement]:
        at = clock.now - timedelta(minutes=5)
        return [
            Announcement(external_id="n1", external_course_id="101", title="Room change",
                         posted_at=at),
            Announcement(external_id="n0", external_course_id="101", title="Old",
                         posted_at=at - timedelta(days=2)),
        ]  # fmt: skip

    fake.announcements = posted  # pyright: ignore[reportAttributeAccessIssue]

    async def told() -> list[str]:
        clock.advance(hours=1)
        with collect_events(app, user_id) as messages:
            await api.sync(program_id)
        [synced] = [m["data"] for m in messages if m["type"] == sync.SYNCED]
        return [n["title"] for n in synced["notices"]]

    # The first sync only looks: what was there already is not news.
    assert await told() == []
    assert await told() == ["Room change"]
    # After days without a sync (the server was off), what came meanwhile is only recorded.
    clock.advance(days=3)
    assert await told() == []


async def test_the_scheduler_syncs_what_is_due(api: Api, app: FastAPI, clock: Clock):
    program_id, _ = await _course(api)

    async def due() -> int:
        async with system_ctx(app.state) as ctx:
            await sync.sync_due(ctx)
            await ctx.db.commit()
        status = await api.call("GET", f"/programs/{program_id}/lms/sync")
        await api.run_jobs()
        return int(status["syncing"])

    assert await due() == 1  # never synced
    clock.advance(hours=1)
    assert await due() == 0  # every 6 hours by default
    await api.call("PATCH", "/me/settings/lms", json={"values": {"sync_every": "1h"}})
    clock.advance(minutes=1)
    assert await due() == 1
    # Opening the app syncs what was not synced in the last half hour.
    queued = await api.call("POST", f"/programs/{program_id}/lms/sync", json={})
    assert queued["queued"] == 0
    # An account not used for weeks is left until it comes back.
    clock.advance(days=15)
    async with system_ctx(app.state) as ctx:
        await sync.sync_due(ctx)
        await ctx.db.commit()
    async with system_ctx(app.state) as ctx:
        assert not await ctx.db.scalar(
            sync.select(sync.CoreJob.id).where(sync.CoreJob.status == "pending")
        )


async def test_the_server_sets_the_shortest_interval(api: Api, app: FastAPI, clock: Clock):
    program_id, _ = await _course(api)

    async def offered() -> list[str]:
        schemas = (await api.call("GET", "/me/settings-schemas"))["items"]
        lms = next(s for s in schemas if s["namespace"] == "lms")
        return lms["json_schema"]["properties"]["sync_every"]["enum"]

    assert await offered() == ["15m", "30m", "1h", "6h", "1d"]
    await api.call("PATCH", "/me/settings/lms", json={"values": {"sync_every": "15m"}})
    await api.sync(program_id)
    app.state.settings = app.state.settings.model_copy(update={"lms_sync_min_interval": "1h"})
    assert await offered() == ["1h", "6h", "1d"]
    # A shorter choice saved before counts as the server's shortest.
    clock.advance(minutes=30)
    async with system_ctx(app.state) as ctx:
        await sync.sync_due(ctx)
        await ctx.db.commit()
    assert not (await api.call("GET", f"/programs/{program_id}/lms/sync"))["syncing"]
