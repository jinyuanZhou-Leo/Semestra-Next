"""Grading over HTTP and the agent surface (M03 §8)."""

from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import func, select

from semestra.core.capability import registry
from semestra.core.context import system_ctx
from semestra.core.errors import AppError
from semestra.modules.grading import models, service
from semestra.modules.grading.schemas import AssessmentCandidates
from semestra.testing import MakeUser, UserHandle, collect_events

LoginAs = Callable[[AsyncClient, UserHandle], Awaitable[str]]

FALL = ("Fall 2025", "2025-09-04", "2025-12-20")
WINTER = ("Winter 2026", "2026-01-06", "2026-04-30")


class Api:
    def __init__(self, client: AsyncClient) -> None:
        self.client = client

    async def call(self, method: str, url: str, status: int = 200, **kwargs: Any) -> Any:
        r = await self.client.request(method, url, **kwargs)
        assert r.status_code == status, r.text
        return r.json()

    async def program(self, **body: Any) -> dict[str, Any]:
        return await self.call(
            "POST", "/programs", json={"name": "BASc", "timezone": "America/Toronto", **body}
        )

    async def term(self, program_id: str, name: str, start: str, end: str) -> dict[str, Any]:
        r = await self.call(
            "POST",
            f"/programs/{program_id}/terms",
            json={"name": name, "start_date": start, "end_date": end},
        )
        return r["term"]

    async def course(self, program_id: str, term_ids: list[str], **body: Any) -> dict[str, Any]:
        return await self.call(
            "POST",
            f"/programs/{program_id}/courses",
            json={"title": "Course", "term_ids": term_ids, **body},
        )

    async def assessment(self, course_id: str, title: str, weight: float, **body: Any) -> Any:
        return await self.call(
            "POST",
            f"/courses/{course_id}/assessments",
            json={"title": title, "weight": weight, **body},
        )

    async def gradebook(self, course_id: str) -> dict[str, Any]:
        return await self.call("GET", f"/courses/{course_id}/gradebook")


@pytest.fixture
async def api(client: AsyncClient, make_user: MakeUser, login_as: LoginAs) -> Api:
    user = await make_user()
    await login_as(client, user)
    return Api(client)


async def one_course(api: Api, **body: Any) -> tuple[dict[str, Any], dict[str, Any]]:
    program = await api.program()
    term = await api.term(program["id"], *FALL)
    return program, await api.course(program["id"], [term["id"]], **body)


# --- scale ----------------------------------------------------------------------------------


async def test_program_gets_the_default_scale_or_the_chosen_preset(api: Api):
    default = await api.program()
    scale = await api.call("GET", f"/programs/{default['id']}/grading-scale")
    assert scale["max_points"] == 4.0
    assert scale["bands"][0] == {"min": 90, "max": 100, "points": 4.0, "letter": "A+"}
    assert [c["key"] for c in scale["default_categories"]][:2] == ["quiz", "exam"]
    assert (scale["year_course_attribution"], scale["hide_gpa"]) == ("end_term", False)

    us = await api.program(name="US", setup={"grading_scale_preset": "us_4_0"})
    bands = (await api.call("GET", f"/programs/{us['id']}/grading-scale"))["bands"]
    assert bands[0]["min"] == 93

    odd = await api.program(name="Odd", setup={"grading_scale_preset": "nonsense"})
    assert (await api.call("GET", f"/programs/{odd['id']}/grading-scale"))["bands"][0]["min"] == 90

    presets = await api.call("GET", "/grading/scale-presets")
    assert [p["id"] for p in presets["items"]] == ["uoft_4_0", "us_4_0", "cn_100", "custom"]


async def test_scale_update_validates_and_keeps_unsent_fields(api: Api):
    program = await api.program()
    url = f"/programs/{program['id']}/grading-scale"
    updated = await api.call("PUT", url, json={"hide_gpa": True})
    assert updated["hide_gpa"] is True
    assert updated["bands"][0]["min"] == 90  # untouched

    bands = [
        {"min": 0, "max": 59, "points": 0.0, "letter": "F"},
        {"min": 60, "max": 100, "points": 3.0, "letter": "P"},
    ]
    changed = await api.call("PUT", url, json={"bands": bands, "max_points": 3.0})
    assert [b["min"] for b in changed["bands"]] == [60, 0]  # highest first

    for bad, reason in [
        ([{"min": 0, "max": 60, "points": 0}, {"min": 60, "max": 100, "points": 3}], "overlap"),
        ([{"min": 5, "max": 100, "points": 3}], "not_from_zero"),
        ([{"min": 0, "max": 80, "points": 3}], "not_to_hundred"),
        ([{"min": 0, "max": 100, "points": 3.5}], "points_out_of_range"),
    ]:
        r = await api.call("PUT", url, 422, json={"bands": bad})
        assert r["error"]["code"] == "grading.scale_invalid"
        assert r["error"]["params"]["reason"] == reason
    dup = [{"key": "a", "name": "A", "color": "blue"}] * 2
    r = await api.call("PUT", url, 422, json={"default_categories": dup})
    assert r["error"]["params"]["reason"] == "category_key_duplicate"
    await api.call("PUT", url, 422, json={"hide_gpa": None})


async def test_lowering_the_scale_maximum_drops_targets_above_it(api: Api):
    program = await api.program()
    term = await api.term(program["id"], "Fall", "2025-09-01", "2025-12-31")
    high = await api.course(program["id"], [term["id"]])
    low = await api.course(program["id"], [term["id"]])
    await api.call("PATCH", f"/courses/{high['id']}/grade", json={"target_points": 3.9})
    await api.call("PATCH", f"/courses/{low['id']}/grade", json={"target_points": 2.5})

    bands = [
        {"min": 0, "max": 59, "points": 0.0, "letter": "F"},
        {"min": 60, "max": 100, "points": 3.0, "letter": "P"},
    ]
    url = f"/programs/{program['id']}/grading-scale"
    await api.call("PUT", url, json={"bands": bands, "max_points": 3.0})
    assert (await api.gradebook(high["id"]))["result"]["target_points"] is None
    assert (await api.gradebook(low["id"]))["result"]["target_points"] == 2.5


# --- gradebook ------------------------------------------------------------------------------


async def test_new_courses_start_with_the_programs_default_categories(api: Api):
    program, course = await one_course(api)
    book = await api.gradebook(course["id"])
    assert [c["key"] for c in book["categories"]] == [
        "quiz", "exam", "assignment", "project", "lab", "presentation", "participation"
    ]  # fmt: skip
    assert book["result"]["basis"] == "percentage"
    assert book["summary"]["status"] == "in_progress"
    assert book["summary"]["weights_ok"] is False  # nothing to weigh yet
    # Changing the Program's template affects courses created afterwards only.
    await api.call(
        "PUT",
        f"/programs/{program['id']}/grading-scale",
        json={"default_categories": [{"key": "hw", "name": "Homework", "color": "blue"}]},
    )
    term = (await api.call("GET", f"/programs/{program['id']}/terms"))["items"][0]
    later = await api.course(program["id"], [term["id"]])
    assert [c["key"] for c in (await api.gradebook(later["id"]))["categories"]] == ["hw"]
    assert len((await api.gradebook(course["id"]))["categories"]) == 7


async def test_recording_scores_and_the_figures(api: Api):
    _, course = await one_course(api)
    cid = course["id"]
    cats = {c["key"]: c["id"] for c in (await api.gradebook(cid))["categories"]}
    quiz = await api.assessment(cid, "Quiz 1", 20, category_id=cats["quiz"])
    hw = await api.assessment(cid, "HW 1", 20, category_id=cats["assignment"])
    mid = await api.assessment(cid, "Midterm", 20, category_id=cats["exam"])
    final = await api.assessment(cid, "Final", 40, category_id=cats["exam"])
    assert quiz["status"] == "pending"

    book = await api.gradebook(cid)
    assert book["summary"]["weights_ok"]
    assert book["summary"]["current_percentage"] is None

    # Percent, points ("18/20") and a later change of the maximum.
    r = await api.call("PATCH", f"/assessments/{quiz['id']}", json={"score_percentage": 90})
    assert (r["score_percentage"], r["points_earned"], r["status"]) == (90, None, "graded")
    r = await api.call(
        "PATCH", f"/assessments/{hw['id']}", json={"points_earned": 14, "points_possible": 20}
    )
    assert (r["score_percentage"], r["points_earned"], r["points_possible"]) == (70, 14, 20)
    r = await api.call("PATCH", f"/assessments/{hw['id']}", json={"points_possible": 28})
    assert r["score_percentage"] == 50
    r = await api.call("PATCH", f"/assessments/{hw['id']}", json={"points_possible": 20})
    await api.call("PATCH", f"/assessments/{mid['id']}", json={"score_percentage": 80})

    summary = (await api.gradebook(cid))["summary"]
    assert summary["current_percentage"] == 80
    assert summary["locked_contribution"] == 48
    assert summary["final_percentage"] is None
    assert summary["required_average"] == 92.5  # target defaults to the scale's 4.0
    assert (summary["target_percentage"], summary["reachable"]) == (85, True)
    assert summary["forecast_percentage"] == 80
    assert summary["predictions"] == {final["id"]: 80}
    assert summary["current_letter"] == "A-"

    # Score three ways of clearing it again.
    r = await api.call("PATCH", f"/assessments/{quiz['id']}", json={"score_percentage": None})
    assert (r["score_percentage"], r["status"]) == (None, "pending")
    r = await api.call("PATCH", f"/assessments/{hw['id']}", json={"points_earned": None})
    assert (r["score_percentage"], r["points_earned"]) == (None, None)
    r = await api.call(
        "PATCH", f"/assessments/{mid['id']}", json={"score_percentage": None, "points_earned": None}
    )
    assert r["score_percentage"] is None

    # Inputs that cannot be a score.
    await api.call("PATCH", f"/assessments/{quiz['id']}", 422, json={"score_percentage": -1})
    await api.call("PATCH", f"/assessments/{quiz['id']}", 422, json={"points_possible": 0})
    r = await api.call("PATCH", f"/assessments/{quiz['id']}", 422, json={"points_earned": 5})
    assert r["error"]["code"] == "grading.points_invalid"
    await api.call("PATCH", f"/assessments/{quiz['id']}", 422, json={"title": None})


async def test_final_grade_override_and_pass_fail(api: Api):
    _, course = await one_course(api)
    cid = course["id"]
    await api.assessment(cid, "Everything", 100, score_percentage=79.5)
    summary = (await api.gradebook(cid))["summary"]
    assert (summary["status"], summary["final_percentage"], summary["final_points"]) == (
        "completed", 79.5, 3.3
    )  # fmt: skip
    assert (summary["final_letter"], summary["final_source"]) == ("B+", "computed")

    result = await api.call(
        "PATCH", f"/courses/{cid}/grade", json={"final_override_percentage": 91}
    )
    assert result["final_override_percentage"] == 91
    summary = (await api.gradebook(cid))["summary"]
    assert (summary["final_percentage"], summary["final_source"], summary["overridden"]) == (
        91, "override", True
    )  # fmt: skip
    await api.call("PATCH", f"/courses/{cid}/grade", json={"final_override_percentage": None})
    assert (await api.gradebook(cid))["summary"]["final_percentage"] == 79.5

    await api.call("PATCH", f"/courses/{cid}/grade", json={"basis": "pass_fail"})
    summary = (await api.gradebook(cid))["summary"]
    assert (summary["status"], summary["final_percentage"]) == ("in_progress", None)
    await api.call("PATCH", f"/courses/{cid}/grade", json={"pass_fail_result": "pass"})
    assert (await api.gradebook(cid))["summary"]["status"] == "passed"

    r = await api.call("PATCH", f"/courses/{cid}/grade", 422, json={"target_points": 4.5})
    assert r["error"]["code"] == "grading.points_invalid"
    await api.call("PATCH", f"/courses/{cid}/grade", 422, json={"basis": None})
    await api.call("PATCH", f"/courses/{cid}/grade", 422, json={"pass_fail_result": "maybe"})


async def test_course_without_a_gradebook_takes_a_final_grade_directly(api: Api):
    _, course = await one_course(api)
    cid = course["id"]
    await api.call(
        "PATCH", f"/courses/{cid}/grade", json={"gradebook_enabled": False, "manual_percentage": 81}
    )
    summary = (await api.gradebook(cid))["summary"]
    assert (summary["final_percentage"], summary["final_source"], summary["final_points"]) == (
        81, "manual", 3.7
    )  # fmt: skip
    assert summary["forecast_percentage"] is None


async def test_what_if_and_suggestions_need_complete_weights(api: Api):
    _, course = await one_course(api)
    cid = course["id"]
    quiz = await api.assessment(cid, "Quiz", 50, score_percentage=60)
    final = await api.assessment(cid, "Final", 30)
    r = await api.call("POST", f"/courses/{cid}/gradebook:simulate", 422, json={"scores": {}})
    assert r["error"]["code"] == "grading.weights_not_100"
    assert r["error"]["params"] == {"weight_total": 80, "weight_gap": 20}
    await api.call("POST", f"/courses/{cid}/gradebook:suggest", 422, json={})

    other = await api.assessment(cid, "Project", 20)
    sim = await api.call(
        "POST",
        f"/courses/{cid}/gradebook:simulate",
        json={"scores": {final["id"]: 70, other["id"]: 90, quiz["id"]: 0, "nope": 50}},
    )
    # The graded quiz keeps 60: 30 + 21 + 18.
    assert (sim["final_percentage"], sim["status"]) == (69, "completed")
    assert sim["ignored"] == [
        {"id": quiz["id"], "reason": "graded"},
        {"id": "nope", "reason": "unknown"},
    ]
    # Nothing was saved.
    assert (await api.gradebook(cid))["summary"]["final_percentage"] is None

    # A target in percent instead of points.
    sim = await api.call(
        "POST",
        f"/courses/{cid}/gradebook:simulate",
        json={"scores": {}, "target": {"kind": "percentage", "value": 70}},
    )
    assert (sim["target_percentage"], sim["required_average"]) == (70, 80)

    suggestion = await api.call(
        "POST",
        f"/courses/{cid}/gradebook:suggest",
        json={"target": {"kind": "points", "value": 3.0}},
    )
    assert suggestion["target_percentage"] == 73
    assert suggestion["reachable"] is True
    assert {i["assessment_id"] for i in suggestion["items"]} == {final["id"], other["id"]}
    assert suggestion["resulting_percentage"] >= 73
    # A target the scale cannot give.
    out = await api.call(
        "POST", f"/courses/{cid}/gradebook:suggest", json={"target": {"kind": "points", "value": 9}}
    )
    assert out["reachable"] is False
    assert all(i["score"] == 100 for i in out["items"])


async def test_dropped_assessments_are_ignored(api: Api):
    _, course = await one_course(api)
    cid = course["id"]
    await api.assessment(cid, "Real", 100, score_percentage=88)
    extra = await api.assessment(cid, "Dropped quiz", 20, score_percentage=0)
    assert (await api.gradebook(cid))["summary"]["weights_ok"] is False
    await api.call("PATCH", f"/assessments/{extra['id']}", json={"dropped": True})
    summary = (await api.gradebook(cid))["summary"]
    assert (summary["weights_ok"], summary["final_percentage"]) == (True, 88)


# --- assessments ----------------------------------------------------------------------------


async def test_due_dates_use_the_programs_time_zone(api: Api):
    _, course = await one_course(api)
    cid = course["id"]
    # Date only: the end of that day in Toronto (EST, UTC-5) is 04:59 UTC the next day.
    a = await api.assessment(cid, "Essay", 10, due_date="2025-11-10")
    assert (a["due_at"], a["due_has_time"]) == ("2025-11-11T04:59:00Z", False)
    assert (a["due_date"], a["due_time"]) == ("2025-11-10", None)
    b = await api.assessment(cid, "Quiz", 10, due_date="2025-11-10", due_time="10:30:00")
    assert (b["due_at"], b["due_has_time"], b["due_time"]) == (
        "2025-11-10T15:30:00Z",
        True,
        "10:30:00",
    )
    c = await api.assessment(cid, "Exam", 10, due_at="2025-12-01T14:00:00Z")
    assert (c["due_date"], c["due_time"]) == ("2025-12-01", "09:00:00")
    d = await api.assessment(cid, "Daylight", 10, due_date="2026-07-01", due_time="09:00:00")
    assert d["due_at"] == "2026-07-01T13:00:00Z"  # EDT, UTC-4

    # Moving the date keeps the time; clearing the time makes it a date again; null clears.
    moved = await api.call("PATCH", f"/assessments/{b['id']}", json={"due_date": "2025-11-12"})
    assert (moved["due_at"], moved["due_time"]) == ("2025-11-12T15:30:00Z", "10:30:00")
    dated = await api.call("PATCH", f"/assessments/{b['id']}", json={"due_time": None})
    assert (dated["due_has_time"], dated["due_at"]) == (False, "2025-11-13T04:59:00Z")
    cleared = await api.call("PATCH", f"/assessments/{b['id']}", json={"due_at": None})
    assert (cleared["due_at"], cleared["due_date"]) == (None, None)


async def test_overdue_status_and_filters(api: Api):
    _, course = await one_course(api)
    cid = course["id"]
    await api.assessment(cid, "Old", 10, due_date="2020-01-01")
    await api.assessment(cid, "Future", 10, due_date="2099-01-01")
    await api.assessment(cid, "Done", 10, due_date="2020-01-01", score_percentage=50)
    await api.assessment(cid, "Undated", 10)

    def titles(page: dict[str, Any]) -> list[str]:
        return [i["title"] for i in page["items"]]

    base = f"/courses/{cid}/assessments"
    assert titles(await api.call("GET", base, params={"status": "overdue"})) == ["Old"]
    assert titles(await api.call("GET", base, params={"status": "graded"})) == ["Done"]
    assert titles(await api.call("GET", base, params={"status": "pending"})) == [
        "Future",
        "Undated",
    ]
    page = await api.call("GET", base, params={"limit": 3})
    assert len(page["items"]) == 3
    assert page["next_cursor"] == "3"
    rest = await api.call("GET", base, params={"limit": 3, "cursor": page["next_cursor"]})
    assert titles(rest) == ["Undated"]
    assert rest["next_cursor"] is None


async def test_batch_import_skips_what_the_course_already_has(api: Api):
    _, course = await one_course(api)
    cid = course["id"]
    items = [
        {"title": "A1", "weight": 10, "source_kind": "lms", "source_ref": "101"},
        {"title": "A2", "weight": 10, "source_kind": "lms", "source_ref": "102"},
        {"title": "Manual", "weight": 5},
        {"title": "A1 again", "weight": 10, "source_kind": "lms", "source_ref": "101"},
    ]
    first = await api.call("POST", f"/courses/{cid}/assessments:batch", json={"assessments": items})
    assert [a["title"] for a in first["created"]] == ["A1", "A2", "Manual"]
    assert [(s["source_ref"], s["assessment_id"]) for s in first["skipped"]] == [
        ("101", first["created"][0]["id"])
    ]
    again = await api.call("POST", f"/courses/{cid}/assessments:batch", json={"assessments": items})
    assert again["created"][0]["title"] == "Manual"  # no source: never deduplicated
    assert len(again["skipped"]) == 3
    assert len((await api.call("GET", f"/courses/{cid}/assessments"))["items"]) == 4
    await api.call(
        "POST", f"/courses/{cid}/assessments:batch", 422,
        json={"assessments": [{"title": "x", "source_ref": "1"}]},
    )  # fmt: skip


async def test_categories(api: Api):
    _, course = await one_course(api)
    cid = course["id"]
    mid = await api.call(
        "POST", f"/courses/{cid}/grading-categories", json={"name": "Mid Term!", "color": "#112233"}
    )
    assert mid["key"] == "mid-term"
    again = await api.call("POST", f"/courses/{cid}/grading-categories", json={"name": "Mid Term!"})
    assert again["key"] == "mid-term-2"
    r = await api.call(
        "POST", f"/courses/{cid}/grading-categories", 409, json={"name": "x", "key": "quiz"}
    )
    assert r["error"]["code"] == "grading.category_key_conflict"
    await api.call(
        "POST", f"/courses/{cid}/grading-categories", 422, json={"name": "x", "color": "pink"}
    )

    renamed = await api.call(
        "PATCH", f"/grading-categories/{mid['id']}", json={"name": "Midterm", "archived": True}
    )
    assert (renamed["name"], renamed["archived"]) == ("Midterm", True)

    a = await api.assessment(cid, "Test", 10, category_id=mid["id"])
    assert a["category_id"] == mid["id"]
    await api.call("DELETE", f"/grading-categories/{mid['id']}")
    assert (await api.call("GET", f"/courses/{cid}/assessments"))["items"][0]["category_id"] is None

    book = await api.gradebook(cid)
    ids = [c["id"] for c in book["categories"]]
    order = await api.call(
        "PUT", f"/courses/{cid}/grading-category-order", json={"category_ids": ids[::-1][:2]}
    )
    assert [c["id"] for c in order["items"][:2]] == ids[::-1][:2]
    assert len(order["items"]) == len(ids)
    other_course = await api.course((await api.call("GET", "/programs"))["items"][0]["id"],
                                    course["term_ids"])  # fmt: skip
    await api.call(
        "POST", f"/courses/{other_course['id']}/assessments", 404,
        json={"title": "x", "category_id": ids[0]},
    )  # fmt: skip


async def test_reordering_and_deleting_assessments(api: Api):
    _, course = await one_course(api)
    cid = course["id"]
    ids = [(await api.assessment(cid, f"A{n}", 10))["id"] for n in range(3)]
    out = await api.call(
        "PUT", f"/courses/{cid}/assessment-order", json={"assessment_ids": [ids[2]]}
    )
    assert out["assessment_ids"] == [ids[2], ids[0], ids[1]]
    listed = await api.call("GET", f"/courses/{cid}/assessments")
    assert [i["id"] for i in listed["items"]] == [ids[2], ids[0], ids[1]]
    await api.call(
        "PUT", f"/courses/{cid}/assessment-order", 404, json={"assessment_ids": ["nope"]}
    )
    await api.call("DELETE", f"/assessments/{ids[0]}")
    await api.call("DELETE", f"/assessments/{ids[0]}", 404)


async def test_events_say_what_changed(api: Api, app: FastAPI):
    _, course = await one_course(api)
    user_id = (await api.call("GET", "/programs"))["items"][0]["id"]  # any id; user from the app
    del user_id
    async with app.state.session_factory() as db:
        owner = await db.scalar(select(models.GradingScale.user_id))
    assert owner
    with collect_events(app, owner) as pushed:
        a = await api.assessment(course["id"], "Quiz", 10, due_date="2025-10-01")
        await api.call("PATCH", f"/assessments/{a['id']}", json={"score_percentage": 80})
        points = {"points_earned": 9, "points_possible": 10}
        await api.call("PATCH", f"/assessments/{a['id']}", json=points)
        # 90/100 is the same 90 percent but a different score as typed
        points = {"points_earned": 90, "points_possible": 100}
        await api.call("PATCH", f"/assessments/{a['id']}", json=points)
        await api.call("PATCH", f"/assessments/{a['id']}", json={"due_date": "2025-10-02"})
        # an explicit 23:59 is the same instant as "end of day", but now shows a time
        await api.call("PATCH", f"/assessments/{a['id']}", json={"due_time": "23:59:00"})
        await api.call("PATCH", f"/assessments/{a['id']}", json={"note": "same"})
        await api.call("PATCH", f"/assessments/{a['id']}", json={"note": "same"})
        await api.call("PATCH", f"/courses/{course['id']}/grade", json={"target_points": 3.7})
        await api.call("DELETE", f"/assessments/{a['id']}")
    kinds = [
        (e["type"], e["data"].get("changed")) for e in pushed if e["type"].startswith("grading.")
    ]
    assert kinds == [
        ("grading.assessment.created", ["due_at"]),
        ("grading.assessment.updated", ["score_percentage"]),
        ("grading.assessment.updated", ["score_percentage", "points_earned", "points_possible"]),
        ("grading.assessment.updated", ["points_earned", "points_possible"]),
        ("grading.assessment.updated", ["due_at"]),
        ("grading.assessment.updated", ["due_has_time"]),
        ("grading.assessment.updated", ["note"]),  # the repeated identical note publishes nothing
        ("grading.course_result.updated", None),
        ("grading.assessment.deleted", []),
    ]
    updated = [e for e in pushed if e["type"] == "grading.assessment.updated"]
    assert [e["data"]["due_changed"] for e in updated] == [False, False, False, True, True, False]


async def test_point_scores_obey_the_percentage_limit(api: Api):
    _, course = await one_course(api)
    a = await api.assessment(course["id"], "Quiz", 10)
    r = await api.call(
        "PATCH",
        f"/assessments/{a['id']}",
        422,
        json={"points_earned": 1001, "points_possible": 100},
    )
    assert r["error"]["code"] == "grading.points_invalid"
    bonus = await api.call(
        "PATCH", f"/assessments/{a['id']}", json={"points_earned": 105, "points_possible": 100}
    )
    assert bonus["score_percentage"] == 105


async def test_calendar_deadlines_leave_out_scored_and_dropped_work(api: Api, app: FastAPI):
    program, course = await one_course(api)
    cid = course["id"]
    open_ = await api.assessment(cid, "Open", 10, due_date="2025-10-01")
    done = await api.assessment(cid, "Done", 10, due_date="2025-10-02", score_percentage=90)
    gone = await api.assessment(cid, "Gone", 10, due_date="2025-10-03", dropped=True)
    del done, gone
    async with app.state.session_factory() as db:
        owner = await db.scalar(select(models.GradingScale.user_id))
    assert owner
    async with system_ctx(app.state, owner) as ctx:
        found = await service.assessment_deadlines(
            ctx,
            program["id"],
            datetime(2025, 9, 1, tzinfo=UTC),
            datetime(2025, 11, 1, tzinfo=UTC),
        )
    assert [a.id for a in found] == [open_["id"]]


# --- term and Program figures ---------------------------------------------------------------


async def build_program(api: Api) -> dict[str, Any]:
    """The 'program' dataset of `fixtures/grading_cases.json`, through the API."""
    program = await api.program(credit_requirement=10)
    pid = program["id"]
    terms = {
        "T1": (await api.term(pid, "T1", "2024-09-01", "2024-12-20"))["id"],
        "T2": (await api.term(pid, "T2", "2025-01-06", "2025-04-30"))["id"],
        "T3": (await api.term(pid, "T3", "2025-09-01", "2025-12-20"))["id"],
    }
    spec = [
        ("c1", 0.5, True, ["T1"], 85), ("c2", 0.5, True, ["T1"], 72),
        ("c3", 1.0, True, ["T1", "T2"], 77), ("c4", 0.5, True, ["T2"], 60),
        ("c5", 0.5, False, ["T2"], 95), ("c6", 0.5, True, ["T3"], None),
        ("c7", 0.5, True, ["T3"], "pass"),
    ]  # fmt: skip
    courses: dict[str, str] = {}
    for name, credits, in_gpa, term_names, final in spec:
        course = await api.course(
            pid, [terms[t] for t in term_names], code=name.upper(), credits=credits,
            include_in_gpa=in_gpa,
        )  # fmt: skip
        courses[name] = course["id"]
        if final == "pass":
            body: dict[str, Any] = {"basis": "pass_fail", "pass_fail_result": "pass"}
        else:
            body = {"gradebook_enabled": False, "manual_percentage": final}
        await api.call("PATCH", f"/courses/{course['id']}/grade", json=body)
    return {"program": pid, "terms": terms, "courses": courses}


async def test_term_and_program_summaries(api: Api):
    ids = await build_program(api)
    pid, terms = ids["program"], ids["terms"]

    t1 = await api.call("GET", f"/terms/{terms['T1']}/grade-summary")
    assert (t1["gpa"], t1["average_percentage"], t1["credits_counted"]) == (3.35, 78.5, 1.0)
    assert [c["code"] for c in t1["courses"]] == ["C1", "C2", "C3"]
    c3 = t1["courses"][2]
    assert (c3["year_long"], c3["attributed_credits"], c3["counts_in_gpa"]) == (True, 0.0, True)
    assert t1["credits_total"] == 1.0

    t2 = await api.call("GET", f"/terms/{terms['T2']}/grade-summary")
    assert (t2["gpa"], t2["average_percentage"], t2["excluded_count"]) == (2.767, 71.333, 1)
    assert (t2["credits_total"], t2["credits_earned"]) == (2.0, 2.0)
    t3 = await api.call("GET", f"/terms/{terms['T3']}/grade-summary")
    assert (t3["gpa"], t3["credits_earned"], t3["excluded_count"]) == (None, 0.5, 2)
    assert [c["status"] for c in t3["courses"]] == ["in_progress", "passed"]

    program = await api.call("GET", f"/programs/{pid}/grade-summary")
    assert (program["gpa"], program["average_percentage"]) == (3.0, 74.2)
    assert (program["credits_counted"], program["credits_earned"]) == (2.5, 3.5)
    assert (program["credits_required"], program["progress"]) == (10, 0.35)
    assert (program["term_count"], program["graded_course_count"]) == (3, 4)
    assert [(t["name"], t["gpa"], t["cumulative_gpa"]) for t in program["terms"]] == [
        ("T1", 3.35, 3.35), ("T2", 2.767, 3.0), ("T3", None, 3.0)
    ]  # fmt: skip

    # The user's rule for year-long courses moves the credits between terms.
    await api.call(
        "PUT", f"/programs/{pid}/grading-scale", json={"year_course_attribution": "split_evenly"}
    )
    t1 = await api.call("GET", f"/terms/{terms['T1']}/grade-summary")
    assert (t1["gpa"], t1["credits_counted"]) == (3.333, 1.5)
    t2 = await api.call("GET", f"/terms/{terms['T2']}/grade-summary")
    assert t2["gpa"] == 2.5
    assert (await api.call("GET", f"/programs/{pid}/grade-summary"))["gpa"] == 3.0

    grades = await api.call("GET", f"/programs/{pid}/course-grades")
    assert grades["max_points"] == 4.0
    by_code = {g["code"]: g for g in grades["items"]}
    assert (by_code["C1"]["points"], by_code["C1"]["letter"]) == (4.0, "A")
    assert by_code["C7"]["status"] == "passed"
    assert by_code["C7"]["points"] is None
    assert by_code["C6"]["status"] == "in_progress"


async def test_in_progress_courses_count_only_when_asked(api: Api):
    _, course = await one_course(api, credits=1)
    cid = course["id"]
    await api.assessment(cid, "Done", 50, score_percentage=90)
    await api.assessment(cid, "Later", 50)
    term_id = course["term_ids"][0]
    plain = await api.call("GET", f"/terms/{term_id}/grade-summary")
    assert plain["gpa"] is None
    included = await api.call(
        "GET", f"/terms/{term_id}/grade-summary", params={"include_in_progress": True}
    )
    assert included["gpa"] == 4.0
    assert included["courses"][0]["status"] == "in_progress"


async def test_term_what_if_over_http(api: Api):
    ids = await build_program(api)
    t3 = ids["terms"]["T3"]
    c6 = ids["courses"]["c6"]
    result = await api.call(
        "POST", f"/terms/{t3}/grade-summary:simulate", json={"scores": {c6: 86}, "target_gpa": 3.7}
    )
    assert (result["gpa"], result["gap"], result["reachable"]) == (4.0, -0.3, True)
    assert result["ignored"] == []
    result = await api.call(
        "POST", f"/terms/{t3}/grade-summary:simulate", json={"scores": {"nope": 86}}
    )
    assert result["ignored"] == [{"id": "nope", "reason": "unknown"}]
    result = await api.call(
        "POST", f"/terms/{t3}/grade-summary:simulate", json={"scores": {}, "target_gpa": 3.7}
    )
    assert (result["gpa"], result["required_percentage"]) == (None, 80)


async def test_hidden_gpa_flag_travels_with_the_figures(api: Api):
    program, course = await one_course(api)
    await api.call("PUT", f"/programs/{program['id']}/grading-scale", json={"hide_gpa": True})
    assert (await api.gradebook(course["id"]))["scale"]["hide_gpa"] is True
    term_id = course["term_ids"][0]
    assert (await api.call("GET", f"/terms/{term_id}/grade-summary"))["hide_gpa"] is True
    assert (await api.call("GET", f"/programs/{program['id']}/grade-summary"))["hide_gpa"] is True


# --- clean-up and ownership -----------------------------------------------------------------


async def count(app: FastAPI, model: Any) -> int:
    async with app.state.session_factory() as db:
        return await db.scalar(select(func.count()).select_from(model)) or 0


async def test_deleting_courses_and_programs_removes_their_gradebooks(api: Api, app: FastAPI):
    program, course = await one_course(api)
    other = await api.course(program["id"], course["term_ids"])
    await api.assessment(course["id"], "A", 10)
    await api.assessment(other["id"], "B", 10)
    await api.gradebook(course["id"])
    assert await count(app, models.GradingAssessment) == 2
    assert await count(app, models.GradingCategory) == 14

    await api.call("DELETE", f"/courses/{course['id']}")
    assert await count(app, models.GradingAssessment) == 1
    assert await count(app, models.GradingCategory) == 7
    assert await count(app, models.GradingCourseResult) == 1

    await api.call("DELETE", f"/programs/{program['id']}")
    for model in (
        models.GradingAssessment,
        models.GradingCategory,
        models.GradingCourseResult,
        models.GradingScale,
    ):
        assert await count(app, model) == 0, model


async def test_other_peoples_data_is_not_found(
    api: Api, app: FastAPI, client: AsyncClient, make_user: MakeUser, login_as: LoginAs
):
    program, course = await one_course(api)
    term_id = course["term_ids"][0]
    a = await api.assessment(course["id"], "Quiz", 10)
    category = (await api.gradebook(course["id"]))["categories"][0]

    intruder = await make_user(email="intruder@example.com")
    await login_as(client, intruder)
    cid, pid = course["id"], program["id"]
    attempts: list[tuple[str, str, dict[str, Any]]] = [
        ("GET", f"/programs/{pid}/grading-scale", {}),
        ("PUT", f"/programs/{pid}/grading-scale", {"json": {"hide_gpa": True}}),
        ("GET", f"/courses/{cid}/gradebook", {}),
        ("PATCH", f"/courses/{cid}/grade", {"json": {"basis": "pass_fail"}}),
        ("POST", f"/courses/{cid}/grading-categories", {"json": {"name": "x"}}),
        ("PATCH", f"/grading-categories/{category['id']}", {"json": {"name": "x"}}),
        ("DELETE", f"/grading-categories/{category['id']}", {}),
        ("PUT", f"/courses/{cid}/grading-category-order", {"json": {"category_ids": []}}),
        ("GET", f"/courses/{cid}/assessments", {}),
        ("POST", f"/courses/{cid}/assessments", {"json": {"title": "x"}}),
        ("POST", f"/courses/{cid}/assessments:batch", {"json": {"assessments": [{"title": "x"}]}}),
        ("PATCH", f"/assessments/{a['id']}", {"json": {"score_percentage": 1}}),
        ("DELETE", f"/assessments/{a['id']}", {}),
        ("PUT", f"/courses/{cid}/assessment-order", {"json": {"assessment_ids": []}}),
        ("POST", f"/courses/{cid}/gradebook:simulate", {"json": {}}),
        ("POST", f"/courses/{cid}/gradebook:suggest", {"json": {}}),
        ("GET", f"/terms/{term_id}/grade-summary", {}),
        ("POST", f"/terms/{term_id}/grade-summary:simulate", {"json": {}}),
        ("GET", f"/programs/{pid}/grade-summary", {}),
        ("GET", f"/programs/{pid}/course-grades", {}),
    ]
    for method, url, kwargs in attempts:
        r = await client.request(method, url, **kwargs)
        assert r.status_code == 404, (method, url, r.text)
        assert r.json()["error"]["code"] == "common.not_found"

    async with system_ctx(app.state, intruder.id) as ctx:
        with pytest.raises(AppError) as info:
            await registry.invoke(
                ctx, "grading.assessment.find", {"query": "quiz", "course_id": cid}, "agent"
            )
        assert info.value.code == "common.not_found"
        # Without a course the search covers only the caller's own Programs: nothing here.
        found = await registry.invoke(ctx, "grading.assessment.find", {"query": "quiz"}, "agent")
        assert candidates(found) == []


def candidates(out: Any) -> list[Any]:
    assert isinstance(out, AssessmentCandidates)
    return out.items


# --- agent surface --------------------------------------------------------------------------


async def test_finding_assessments_by_name(api: Api, app: FastAPI):
    program, course = await one_course(api)
    other = await api.course(program["id"], course["term_ids"], code="MAT100")
    lab3 = await api.assessment(course["id"], "Lab 3", 5)
    await api.assessment(course["id"], "Lab 4", 5)
    midterm = await api.assessment(course["id"], "Midterm Exam", 20)
    other_lab = await api.assessment(other["id"], "Lab 3", 5)
    async with app.state.session_factory() as db:
        owner = await db.scalar(select(models.GradingScale.user_id))
    assert owner

    from semestra.core.context import ScopeRef

    async with system_ctx(app.state, owner) as ctx:
        ctx.actor = "agent"
        got = await registry.invoke(
            ctx, "grading.assessment.find", {"query": "lab3", "course_id": course["id"]}, "agent"
        )
        assert [i.id for i in candidates(got)][:1] == [lab3["id"]]
        assert candidates(got)[0].score == 1.0
        mid = await registry.invoke(
            ctx, "grading.assessment.find", {"query": "midterm", "course_id": course["id"]}, "agent"
        )
        assert candidates(mid)[0].id == midterm["id"]
        nothing = await registry.invoke(
            ctx, "grading.assessment.find", {"query": "zzzz", "course_id": course["id"]}, "agent"
        )
        assert candidates(nothing) == []

        # Program-wide, the course on screen comes first.
        ctx.scope = ScopeRef(program["id"], None, other["id"])
        wide = await registry.invoke(ctx, "grading.assessment.find", {"query": "lab 3"}, "agent")
        assert [i.id for i in candidates(wide)][:2] == [other_lab["id"], lab3["id"]]


async def test_finding_assessments_prefers_the_current_term(api: Api, app: FastAPI):
    program, old = await one_course(api, code="APS105", title="Computer Fundamentals")
    winter = await api.term(program["id"], "Winter", "2027-01-04", "2027-04-30")
    new = await api.course(program["id"], [winter["id"]], code="APS106", title="Programming")
    old_mid = await api.assessment(old["id"], "Midterm", 20, due_date="2026-10-15")
    new_mid = await api.assessment(new["id"], "Midterm", 20, due_date="2027-02-20")
    async with app.state.session_factory() as db:
        owner = await db.scalar(select(models.GradingScale.user_id))
    assert owner

    from semestra.core.context import ScopeRef

    async with system_ctx(app.state, owner) as ctx:
        ctx.scope = ScopeRef(program["id"], winter["id"], None)
        found = candidates(
            await registry.invoke(ctx, "grading.assessment.find", {"query": "midterm"}, "agent")
        )
    assert [c.id for c in found] == [new_mid["id"], old_mid["id"]]
    assert (found[0].course_code, found[0].course_title, found[0].in_current_term) == (
        "APS106",
        "Programming",
        True,
    )
    assert found[1].in_current_term is False


async def test_agent_tools_are_described_and_list_fields_can_be_selected(api: Api, app: FastAPI):
    names = {c.name for c in registry.list(expose="agent") if c.name.startswith("grading.")}
    assert {"grading.gradebook.get", "grading.assessment.find"} <= names
    assert "grading.assessment.find" not in {
        c.name for c in registry.list(expose="http") if c.name.startswith("grading.")
    }
    core = {c.name for c in registry.list() if c.agent_core and c.name.startswith("grading.")}
    assert core == {"grading.gradebook.get", "grading.assessment.find", "grading.assessment.update"}

    _, course = await one_course(api)
    await api.assessment(course["id"], "Quiz", 10, note="private")
    async with app.state.session_factory() as db:
        owner = await db.scalar(select(models.GradingScale.user_id))
    assert owner
    async with system_ctx(app.state, owner) as ctx:
        out = await registry.invoke(
            ctx,
            "grading.assessment.list",
            {"course_id": course["id"], "fields": ["title", "weight"]},
            "agent",
        )
        assert isinstance(out, dict)
        assert set(out["items"][0]) == {"id", "title", "weight"}


# --- calendar (M04) -------------------------------------------------------------------------


async def test_ungraded_deadlines_show_in_the_calendar(api: Api, app: FastAPI):
    program, course = await one_course(api, code="APS105H1")
    pid, cid = program["id"], course["id"]
    timed = await api.assessment(cid, "Lab 1", 10, due_date="2025-10-06", due_time="17:00")
    await api.assessment(cid, "Essay", 20, due_date="2025-10-08")
    await api.assessment(cid, "Quiz", 5, due_date="2025-10-07", score_percentage=80)
    await api.assessment(cid, "Midterm", 30, due_date="2025-11-01")
    got = await api.call(
        "GET",
        f"/programs/{pid}/calendar",
        params={"start": "2025-10-06", "end": "2025-10-13", "sources": ["grading.assessments"]},
    )
    items = [
        (o["title"], o["kind"], o["all_day"], o["start_at"], o["end_at"]) for o in got["items"]
    ]
    assert items == [
        ("APS105H1 · Lab 1", "deadline", False, "2025-10-06T21:00:00Z", None),
        ("APS105H1 · Essay", "deadline", True, "2025-10-08T04:00:00Z", "2025-10-09T04:00:00Z"),
    ]
    assert got["items"][0]["ref"] == {"entity": "grading.assessment", "id": timed["id"]}
    async with app.state.session_factory() as db:
        owner = await db.scalar(select(models.GradingScale.user_id))
    assert owner
    with collect_events(app, owner) as pushed:
        await api.call("PATCH", f"/assessments/{timed['id']}", json={"score_percentage": 90})
    assert {"type": "calendar.changed", "data": {"program_id": pid}} in [
        {"type": e["type"], "data": e["data"]} for e in pushed
    ]
