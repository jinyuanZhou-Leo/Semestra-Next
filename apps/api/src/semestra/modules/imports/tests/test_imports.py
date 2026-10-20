"""Import sessions over HTTP and the agent surface (M08 §9)."""

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic import BaseModel

from semestra.core.capability import registry
from semestra.core.context import system_ctx
from semestra.core.errors import AppError
from semestra.modules import ai
from semestra.modules.imports import extraction, service
from semestra.modules.imports.tests.test_imports_rules import ACORN
from semestra.testing import MakeUser, UserHandle

LoginAs = Callable[[AsyncClient, UserHandle], Awaitable[str]]

WINTER = {
    "name": "Winter 2026",
    "start_date": "2026-01-05",
    "end_date": "2026-04-24",
    "breaks": [{"name": "Reading week", "start_date": "2026-02-14", "end_date": "2026-02-22"}],
}


def ev(value: Any, page: int = 1, quote: str | None = None) -> dict[str, Any]:
    return {
        "value": value,
        "evidence": {"page": page, "quote": quote or str(value)},
        "confidence": 0.9,
    }


SYLLABUS = {
    "course": {
        "code": ev("APS105H1"),
        "title": ev("Computer Fundamentals"),
        "credits": ev(0.5),
        "instructors": [{"name": ev("Ada Lovelace"), "email": ev("ada@example.edu")}],
        "description": ev("Programming in C."),
    },
    "grading": {
        "categories": [
            {"name": ev("Labs"), "weight": ev(20)},
            {"name": ev("Reflection journal"), "weight": ev(5)},
        ],
        "assessments": [
            {"title": ev("Lab 1"), "category": ev("Labs"), "weight": ev(10),
             "due_text": ev("Week 3, Friday")},
            {"title": ev("Lab 2"), "category": ev("Labs"), "weight": ev(10),
             "due_text": ev("TBA")},
            {"title": ev("Journal"), "category": ev("Reflection journal"), "weight": ev(5),
             "due_date": ev("2026-04-01")},
            {"title": ev("Midterm"), "weight": ev(25), "due_text": ev("Week 7, Thursday")},
            {"title": ev("Final exam"), "weight": ev(35)},
        ],
    },
    "meetings": [
        {"type": ev("Lecture"), "weekday": ev(2), "start_time": ev("09:00"),
         "end_time": ev("10:00"), "location": ev("BA 1130")},
        {"type": ev("Lab"), "weekday": ev(4), "start_time": ev("14:00"), "end_time": ev("16:00")},
    ],
    "important_dates": [
        {"title": ev("Midterm"), "date_text": ev("Week 7")},
        {"title": ev("Drop deadline"), "date_text": ev("March 9"), "kind": ev("deadline")},
        {"title": ev("No class: holiday"), "date": ev("2026-02-16"), "kind": ev("no_class")},
    ],
}  # fmt: skip


class Api:
    def __init__(self, client: AsyncClient) -> None:
        self.client = client

    async def call(self, method: str, url: str, status: int = 200, **kwargs: Any) -> Any:
        r = await self.client.request(method, url, **kwargs)
        assert r.status_code == status, r.text
        return r.json()

    async def program(self) -> str:
        program = await self.call(
            "POST", "/programs", json={"name": "BASc", "timezone": "America/Toronto"}
        )
        return program["id"]

    async def term(self, program_id: str) -> str:
        return (await self.call("POST", f"/programs/{program_id}/terms", json=WINTER))["term"]["id"]

    async def course(self, program_id: str, term_id: str, **body: Any) -> dict[str, Any]:
        payload = {"title": "Computer Fundamentals", "code": "APS105H1", "term_ids": [term_id]}
        return await self.call("POST", f"/programs/{program_id}/courses", json={**payload, **body})

    async def upload(self, name: str, data: bytes, mime: str) -> str:
        r = await self.call("POST", "/imports/uploads", files={"file": (name, data, mime)})
        return r["id"]

    async def create(self, program_id: str, status: int = 200, **body: Any) -> Any:
        return await self.call("POST", f"/programs/{program_id}/imports", status, json=body)

    async def commit(self, session_id: str, status: int = 200, **body: Any) -> Any:
        return await self.call("POST", f"/imports/{session_id}:commit", status, json=body)


@pytest.fixture
async def api(client: AsyncClient, make_user: MakeUser, login_as: LoginAs) -> Api:
    await login_as(client, await make_user())
    return Api(client)


@pytest.fixture
def fake_ai(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    """AI is "available" and extraction returns `SYLLABUS` (or what the test puts first)."""
    answers: list[dict[str, Any]] = []
    calls: list[dict[str, Any]] = []

    async def available(ctx: Any, purpose: str) -> bool:
        return True

    async def run_extract(ctx: Any, purpose: str, schema: Any, **kwargs: Any) -> Any:
        calls.append({"purpose": purpose, **kwargs})
        value = answers.pop(0) if answers else SYLLABUS
        return ai.Extraction(value=schema.model_validate(value))

    monkeypatch.setattr(ai, "available", available)
    monkeypatch.setattr(extraction, "run_extract", run_extract)
    return answers


def by_type(session: dict[str, Any], type_: str) -> list[dict[str, Any]]:
    return [i for i in session["items"] if i["type"] == type_]


def issue_codes(item: dict[str, Any]) -> list[str]:
    return [i["code"] for i in item["issues"]]


async def test_ics_import_creates_courses_and_meetings_once(api: Api):
    program_id = await api.program()
    term_id = await api.term(program_id)
    upload = await api.upload("acorn.ics", ACORN, "text/calendar")
    session = await api.create(
        program_id, source_kind="ics", target={"kind": "term", "term_id": term_id},
        upload_ids=[upload],
    )  # fmt: skip
    assert session["status"] == "ready"
    assert [c["data"]["code"] for c in by_type(session, "course")] == ["APS105H1", "MAT188H1"]
    assert len(by_type(session, "meeting")) == 4
    assert session["summary"]["counts"] == {"course": 2, "meeting": 4, "event": 2}
    # The reading week has no course; its date is known.
    assert all(not i["issues"] for i in session["items"])

    done = await api.commit(session["id"])
    assert done["created"] == 8
    assert done["failed"] == 0
    assert done["session"]["status"] == "committed"
    courses = await api.call("GET", f"/programs/{program_id}/courses")
    aps = next(c for c in courses["items"] if c["code"] == "APS105H1")
    meetings = (await api.call("GET", f"/courses/{aps['id']}/meetings"))["items"]
    lec = next(m for m in meetings if m["weekday"] == 1)
    assert (lec["start_week"], lec["end_week"], lec["section_code"]) == (1, 13, "LEC0101")
    assert next(m for m in meetings if m["type_code"] == "TUT")["recurrence"] == "biweekly"

    # Committing again writes nothing (idempotent).
    again = await api.commit(session["id"])
    assert (again["created"], again["updated"], again["failed"]) == (0, 0, 0)

    # A second import of the same file keeps the existing courses and updates the meetings.
    upload = await api.upload("acorn.ics", ACORN, "text/calendar")
    second = await api.create(
        program_id, source_kind="ics", target={"kind": "term", "term_id": term_id},
        upload_ids=[upload],
    )  # fmt: skip
    course_items = by_type(second, "course")
    assert all(c["decision"] == "reject" for c in course_items)
    assert all("import.duplicate_course" in issue_codes(c) for c in course_items)
    assert all(m["data"]["course_ref"].startswith("course:") for m in by_type(second, "meeting"))
    result = await api.commit(second["id"])
    assert result["failed"] == 0
    courses = await api.call("GET", f"/programs/{program_id}/courses")
    assert len(courses["items"]) == 2
    meetings = (await api.call("GET", f"/courses/{aps['id']}/meetings"))["items"]
    assert len(meetings) == 3


async def test_bad_uploads_and_sources(api: Api):
    program_id = await api.program()
    term_id = await api.term(program_id)
    r = await api.client.post(
        "/imports/uploads", files={"file": ("a.exe", b"MZ", "application/x-msdownload")}
    )
    assert r.status_code == 415
    upload = await api.upload("bad.ics", b"garbage", "text/calendar")
    err = await api.create(
        program_id, 422, source_kind="ics", target={"kind": "term", "term_id": term_id},
        upload_ids=[upload],
    )  # fmt: skip
    assert err["error"]["code"] in ("import.ics_invalid", "import.no_content")
    # AI sources need a configured model.
    err = await api.create(
        program_id, 409, source_kind="text", target={"kind": "term", "term_id": term_id},
        text="Midterm on March 3",
    )  # fmt: skip
    assert err["error"]["code"] == "ai.not_configured"


async def test_waiting_for_extraction_takes_one_call(
    api: Api, fake_ai: list[dict[str, Any]], run_jobs, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(service, "WAIT_POLL_SECONDS", 0.05)
    program_id = await api.program()
    term_id = await api.term(program_id)
    session = await api.create(
        program_id, source_kind="text", target={"kind": "term", "term_id": term_id},
        text="APS105 syllabus ...",
    )  # fmt: skip
    url = f"/imports/{session['id']}"
    # Nothing finishes it: the wait ends at the limit with the session still extracting.
    timed_out = await api.call("GET", url, params={"wait_seconds": 1})
    assert timed_out["status"] == "extracting"

    async def finish_soon() -> None:
        await asyncio.sleep(0.2)
        await run_jobs()

    waited, _ = await asyncio.gather(
        api.call("GET", url, params={"wait_seconds": 20}), finish_soon()
    )
    assert waited["status"] == "ready"
    assert waited["items"]
    await api.call("GET", url, 422, params={"wait_seconds": 26})

    # Discarding it while someone waits ends the wait with the new status.
    other = await api.create(
        program_id, source_kind="text", target={"kind": "term", "term_id": term_id},
        text="MAT188 syllabus ...",
    )  # fmt: skip

    async def discard_soon() -> None:
        await asyncio.sleep(0.2)
        await api.call("POST", f"/imports/{other['id']}:discard")

    waited, _ = await asyncio.gather(
        api.call("GET", f"/imports/{other['id']}", params={"wait_seconds": 20}), discard_soon()
    )
    assert waited["status"] == "discarded"


async def test_syllabus_for_existing_course(api: Api, fake_ai: list[dict[str, Any]], run_jobs):
    program_id = await api.program()
    term_id = await api.term(program_id)
    course = await api.course(program_id, term_id, title="APS 105")
    session = await api.create(
        program_id, source_kind="text",
        target={"kind": "course", "course_id": course["id"], "term_id": term_id},
        text="APS105 syllabus ...",
    )  # fmt: skip
    assert session["status"] == "extracting"
    await run_jobs()
    session = await api.call("GET", f"/imports/{session['id']}")
    assert session["status"] == "ready"

    (patch,) = by_type(session, "course_patch")
    # Changing the course itself is opt-in outside "Update course info".
    assert patch["decision"] == "reject"
    assert set(patch["data"]["changes"]) == {"title", "instructors", "description"}
    assert patch["data"]["changes"]["title"] == {
        "old": "APS 105", "new": "Computer Fundamentals", "apply": True
    }  # fmt: skip
    assert patch["evidence"]["title"]["quote"] == "Computer Fundamentals"
    assert patch["confidence"]["title"] == "high"

    cats = by_type(session, "category")
    assert [(c["data"]["name"], c["data"]["key"]) for c in cats] == [
        ("Labs", "lab"),
        ("Reflection journal", "reflection-journal"),
    ]
    assessments = {a["data"]["title"]: a for a in by_type(session, "assessment")}
    assert assessments["Lab 1"]["data"]["due_date"] == "2026-01-23"  # week 3 Friday
    assert assessments["Midterm"]["data"]["due_date"] == "2026-02-26"  # week 7 skips reading week
    assert assessments["Lab 2"]["data"]["category_ref"] == f"item:{cats[0]['id']}"
    assert assessments["Midterm"]["data"]["category_ref"] == "key:exam"
    assert "import.date_unresolved" in issue_codes(assessments["Lab 2"])
    # 10 + 10 + 5 + 25 + 35 = 85: flagged on the first assessment (the course already exists).
    weights = [i for a in assessments.values() for i in a["issues"] if i["code"].endswith("100")]
    assert weights == [{"code": "import.weights_not_100", "params": {"total": 85.0}}]
    # Important dates: an assessment twin is dropped, a deadline becomes a task.
    assert [t["data"]["title"] for t in by_type(session, "task")] == ["Drop deadline"]
    assert by_type(session, "task")[0]["data"]["due_date"] == "2026-03-09"
    assert [e["data"]["title"] for e in by_type(session, "event")] == ["No class: holiday"]
    meetings = by_type(session, "meeting")
    assert [m["data"]["type_code"] for m in meetings] == ["LEC", "PRA"]

    # A misspelt field is refused, not silently dropped.
    lab2 = assessments["Lab 2"]
    err = await api.call(
        "PATCH", f"/imports/{session['id']}/items/{lab2['id']}", 422,
        json={"data": {"weigth": 20}},
    )  # fmt: skip
    errors = err["error"]["params"]["errors"]
    assert errors == [{"loc": ["data", "weigth"], "code": "extra_forbidden"}]
    err = await api.call(
        "PATCH", f"/imports/{session['id']}/items/{lab2['id']}", 422,
        json={"data": {"weigth": None}},
    )  # fmt: skip
    assert err["error"]["params"]["errors"] == [
        {"loc": ["data", "weigth"], "code": "extra_forbidden"}
    ]
    # A bulk decision needs at least one filter.
    err = await api.call(
        "POST", f"/imports/{session['id']}/items:decide", 422, json={"decision": "reject"}
    )
    assert err["error"]["params"]["errors"][0]["code"] == "filter_required"

    # Fix the weights and the date by hand; the issues go away.
    session = await api.call(
        "PATCH", f"/imports/{session['id']}/items/{lab2['id']}",
        json={"data": {"due_date": "2026-02-13"}},
    )  # fmt: skip
    final = next(a for a in by_type(session, "assessment") if a["data"]["title"] == "Final exam")
    session = await api.call(
        "PATCH", f"/imports/{session['id']}/items/{final['id']}", json={"data": {"weight": 50}}
    )
    assert session["summary"]["issues"] == {}
    # Tasks are covered by test_pdf_syllabus_with_a_task.
    decided = await api.call(
        "POST", f"/imports/{session['id']}/items:decide", json={"decision": "reject",
                                                                  "types": ["task"]},
    )  # fmt: skip
    assert decided["changed"] == 1
    await api.call(
        "PATCH", f"/imports/{session['id']}/items/{patch['id']}", json={"decision": "accept"}
    )

    done = await api.commit(session["id"])
    assert done["failed"] == 0, [i["result"] for i in done["session"]["items"] if i["result"]]
    book = await api.call("GET", f"/courses/{course['id']}/gradebook")
    titles = sorted(a["title"] for a in book["assessments"])
    assert titles == ["Final exam", "Journal", "Lab 1", "Lab 2", "Midterm"]
    keys = {c["key"] for c in book["categories"]}
    assert {"lab", "exam", "reflection-journal"} <= keys
    lab_id = next(c["id"] for c in book["categories"] if c["key"] == "lab")
    assert {a["category_id"] for a in book["assessments"] if a["title"].startswith("Lab")} == {
        lab_id
    }
    updated = await api.call("GET", f"/courses/{course['id']}")
    assert updated["title"] == "Computer Fundamentals"
    assert updated["instructors"][0]["name"] == "Ada Lovelace"
    meetings = (await api.call("GET", f"/courses/{course['id']}/meetings"))["items"]
    assert [(m["weekday"], m["type_code"]) for m in meetings] == [(2, "LEC"), (4, "PRA")]

    # Importing the same syllabus again: no duplicates.
    second = await api.create(
        program_id, source_kind="text",
        target={"kind": "course", "course_id": course["id"], "term_id": term_id},
        text="APS105 syllabus ...",
    )  # fmt: skip
    await run_jobs()
    second = await api.call("GET", f"/imports/{second['id']}")
    assert all(
        a["decision"] == "reject" and "import.duplicate_assessment" in issue_codes(a)
        for a in by_type(second, "assessment")
    )
    await api.call(
        "POST", f"/imports/{second['id']}/items:decide",
        json={"decision": "reject", "types": ["task", "event"]},
    )  # fmt: skip
    again = await api.commit(second["id"])
    assert again["failed"] == 0
    book = await api.call("GET", f"/courses/{course['id']}/gradebook")
    assert len(book["assessments"]) == 5
    meetings = (await api.call("GET", f"/courses/{course['id']}/meetings"))["items"]
    assert len(meetings) == 2


async def test_wizard_session_commits_after_the_term_exists(
    api: Api, fake_ai: list[dict[str, Any]], run_jobs
):
    program_id = await api.program()
    upload = await api.upload("aps105.txt", b"APS105 syllabus", "text/plain")
    session = await api.create(
        program_id, source_kind="syllabus",
        target={"kind": "term_wizard", "start_date": "2026-01-05", "end_date": "2026-04-24"},
        upload_ids=[upload],
    )  # fmt: skip
    await run_jobs()
    session = await api.call("GET", f"/imports/{session['id']}")
    assert session["source_refs"][0]["status"] == "done"
    (course_item,) = by_type(session, "course")
    assert course_item["data"]["code"] == "APS105H1"
    midterm = next(a for a in by_type(session, "assessment") if a["data"]["title"] == "Midterm")
    # Plain weeks from the wizard's dates (breaks are not known yet).
    assert midterm["data"]["due_date"] == "2026-02-19"
    evidence = midterm["evidence"]["title"]
    assert evidence["upload_id"] == upload

    # Not committable before the wizard created the term.
    err = await api.commit(session["id"], 422)
    assert err["error"]["code"] == "import.term_unresolved"

    created = await api.call(
        "POST", f"/programs/{program_id}/terms",
        json={**WINTER, "courses": [{"code": "APS105H1", "title": "Computer Fundamentals"}]},
    )  # fmt: skip
    course_id = created["course_ids"][0]
    await api.call(
        "POST", f"/imports/{session['id']}/items:decide", json={"decision": "reject",
                                                                  "types": ["task"]},
    )  # fmt: skip
    done = await api.commit(
        session["id"], wizard_courses=[{"item_id": course_item["id"], "course_id": course_id}]
    )
    assert done["failed"] == 0, [i["result"] for i in done["session"]["items"] if i["result"]]
    assert done["session"]["target"]["term_id"] == created["term"]["id"]
    meetings = (await api.call("GET", f"/courses/{course_id}/meetings"))["items"]
    assert {m["term_id"] for m in meetings} == {created["term"]["id"]}
    book = await api.call("GET", f"/courses/{course_id}/gradebook")
    assert len(book["assessments"]) == 5
    # The uploaded syllabus is not left behind in the import's own storage forever: without
    # M07 it stays with the session until the session expires.
    history = await api.call("GET", f"/programs/{program_id}/imports")
    assert [h["status"] for h in history["items"]] == ["committed"]


async def test_failed_items_are_retried_alone(api: Api, fake_ai: list[dict[str, Any]], run_jobs):
    program_id = await api.program()
    term_id = await api.term(program_id)
    session = await api.create(
        program_id, source_kind="text", target={"kind": "term", "term_id": term_id},
        text="syllabus",
    )  # fmt: skip
    await run_jobs()
    session = await api.call("GET", f"/imports/{session['id']}")
    await api.call(
        "POST", f"/imports/{session['id']}/items:decide", json={"decision": "reject",
                                                                  "types": ["task"]},
    )  # fmt: skip
    # The holiday event loses its date: it fails on commit, everything else is written.
    holiday = by_type(session, "event")[0]
    await api.call(
        "PATCH", f"/imports/{session['id']}/items/{holiday['id']}", json={"data": {"date": None}}
    )
    done = await api.commit(session["id"])
    assert done["failed"] == 1
    failed = next(i for i in done["session"]["items"] if i["id"] == holiday["id"])
    assert failed["result"]["error_code"] == "import.date_unresolved"
    created = done["created"]
    assert created > 5

    # Fixing it and committing again only writes that one.
    await api.call(
        "PATCH", f"/imports/{session['id']}/items/{holiday['id']}",
        json={"data": {"date": "2026-02-16"}},
    )  # fmt: skip
    again = await api.commit(session["id"])
    assert (again["created"], again["failed"]) == (1, 0)
    events = await api.call(
        "GET", f"/programs/{program_id}/events", params={"start": "2026-02-01", "end": "2026-03-01"}
    )
    assert [e["title"] for e in events["items"]] == ["No class: holiday"]


async def test_commit_hook_failure_rolls_back(
    app: FastAPI, api: Api, monkeypatch: pytest.MonkeyPatch
):
    program_id = await api.program()
    term_id = await api.term(program_id)

    async def hook(ctx: Any, session: Any, created: dict[str, str]) -> None:
        assert created
        raise RuntimeError("hook failed")

    monkeypatch.setitem(service._commit_hooks, "ics", [hook])  # pyright: ignore[reportPrivateUsage]
    upload = await api.upload("acorn.ics", ACORN, "text/calendar")
    session = await api.create(
        program_id, source_kind="ics", target={"kind": "term", "term_id": term_id},
        upload_ids=[upload],
    )  # fmt: skip
    with pytest.raises(RuntimeError):
        await api.client.post(f"/imports/{session['id']}:commit", json={})
    courses = await api.call("GET", f"/programs/{program_id}/courses")
    assert courses["items"] == []


async def test_agent_adds_items_and_session_closes(app: FastAPI, api: Api):
    program_id = await api.program()
    term_id = await api.term(program_id)
    me = await api.call("GET", "/account/me")
    async with system_ctx(app.state, me["id"]) as ctx:
        ctx.actor = "agent"
        created = await registry.invoke(
            ctx,
            "imports.session.create",
            {"program_id": program_id, "source_kind": "agent",
             "target": {"kind": "term", "term_id": term_id}},
            "agent",
        )  # fmt: skip
        assert isinstance(created, dict)
        session_id = created["id"]
        await registry.invoke(
            ctx,
            "imports.item.add_many",
            {"session_id": session_id, "items": [
                {"key": "c", "type": "course", "data": {"title": "Linear Algebra",
                                                          "code": "MAT188H1"}},
                {"type": "assessment", "data": {"course_ref": "item:c", "title": "Quiz 1",
                                                 "weight": 100, "category_ref": "key:quiz"}},
            ]},
            "agent",
        )  # fmt: skip
        with pytest.raises(AppError) as err:
            await registry.invoke(
                ctx,
                "imports.item.add_many",
                {"session_id": session_id, "items": [
                    {"type": "meeting", "data": {"course_ref": "item:nope", "weekday": 1,
                                                  "start_time": "09:00", "end_time": "10:00"}}
                ]},
                "agent",
            )  # fmt: skip
        assert err.value.code == "import.course_ref_missing"
        # Each type has its own fields: a misspelt or made-up one is refused, not dropped.
        with pytest.raises(AppError) as err:
            await registry.invoke(
                ctx,
                "imports.item.add_many",
                {"session_id": session_id, "items": [
                    {"type": "meeting", "data": {"course_ref": "item:c", "weekday": 1,
                                                  "start_time": "09:00", "end_time": "10:00",
                                                  "skip_breaks": True}}
                ]},
                "agent",
            )  # fmt: skip
        assert err.value.code == "common.validation"
        assert any("skip_breaks" in e["loc"] for e in err.value.params["errors"])
        await ctx.db.commit()

    session = await api.call("GET", f"/imports/{session_id}")
    assert session["status"] == "ready"
    assert session["summary"]["issues"] == {}
    done = await api.commit(session_id)
    assert (done["created"], done["failed"]) == (2, 0)
    # Closed sessions refuse changes.
    item = session["items"][1]
    err = await api.call(
        "PATCH", f"/imports/{session_id}/items/{item['id']}", 409, json={"decision": "reject"}
    )
    assert err["error"]["code"] == "import.session_closed"
    err = await api.call("POST", f"/imports/{session_id}:discard", 409)
    assert err["error"]["code"] == "import.session_closed"


async def test_discard_removes_uploads(app: FastAPI, api: Api):
    program_id = await api.program()
    term_id = await api.term(program_id)
    upload = await api.upload("acorn.ics", ACORN, "text/calendar")
    content = await api.client.get(f"/imports/uploads/{upload}/content")
    assert content.status_code == 200
    assert content.content == ACORN
    session = await api.create(
        program_id, source_kind="ics", target={"kind": "term", "term_id": term_id},
        upload_ids=[upload],
    )  # fmt: skip
    usage = await api.call("GET", "/storage/usage")
    assert usage["by_module"]["imports"] == len(ACORN)
    discarded = await api.call("POST", f"/imports/{session['id']}:discard")
    assert discarded["status"] == "discarded"
    assert (await api.client.get(f"/imports/uploads/{upload}/content")).status_code == 404
    err = await api.commit(session["id"], 409)
    assert err["error"]["code"] == "import.session_closed"


async def test_timetable_screenshot(api: Api, fake_ai: list[dict[str, Any]], run_jobs):
    program_id = await api.program()
    term_id = await api.term(program_id)
    await api.course(program_id, term_id)
    fake_ai.append(
        {
            "cells": [
                {"course_code": ev("APS105H1"), "type": ev("LEC"), "section": ev("LEC0101"),
                 "weekday": ev(1), "start_time": ev("10:00"), "end_time": ev("11:00")},
                {"course_code": ev("ECE110H1"), "title": ev("Electrical Fundamentals"),
                 "type": ev("Tutorial"), "weekday": ev(3), "start_time": ev("13:00"),
                 "end_time": ev("15:00"), "location": ev("GB 119")},
                {"course_code": ev("XXX"), "weekday": ev(9), "start_time": ev("13:00"),
                 "end_time": ev("12:00")},
            ]
        }
    )  # fmt: skip
    upload = await api.upload("week.png", b"\x89PNG fake", "image/png")
    session = await api.create(
        program_id, source_kind="timetable_image", target={"kind": "term", "term_id": term_id},
        upload_ids=[upload],
    )  # fmt: skip
    await run_jobs()
    session = await api.call("GET", f"/imports/{session['id']}")
    assert session["status"] == "ready"
    courses = by_type(session, "course")
    assert [(c["data"]["code"], c["decision"]) for c in courses] == [
        ("APS105H1", "reject"),
        ("ECE110H1", "accept"),
    ]
    meetings = by_type(session, "meeting")
    assert [(m["data"]["type_code"], m["data"]["weekday"]) for m in meetings] == [
        ("LEC", 1),
        ("TUT", 3),
    ]
    done = await api.commit(session["id"])
    assert (done["created"], done["failed"]) == (3, 0)


async def test_course_info_keeps_only_the_field_changes(
    api: Api, fake_ai: list[dict[str, Any]], run_jobs
):
    program_id = await api.program()
    term_id = await api.term(program_id)
    course = await api.course(program_id, term_id, title="APS 105")
    session = await api.create(
        program_id, source_kind="text", target={"kind": "course", "course_id": course["id"]},
        text="APS105 syllabus ...", source_meta={"only": "course_info"},
    )  # fmt: skip
    await run_jobs()
    session = await api.call("GET", f"/imports/{session['id']}")
    assert session["status"] == "ready"
    assert [i["type"] for i in session["items"]] == ["course_patch"]
    done = await api.commit(session["id"])
    assert (done["updated"], done["failed"]) == (1, 0)
    updated = await api.call("GET", f"/courses/{course['id']}")
    assert updated["title"] == "Computer Fundamentals"


async def test_ics_into_one_course_takes_only_its_meetings(api: Api):
    program_id = await api.program()
    term_id = await api.term(program_id)
    course = await api.course(program_id, term_id, code="MAT188H1", title="Linear Algebra")
    upload = await api.upload("acorn.ics", ACORN, "text/calendar")
    session = await api.create(
        program_id, source_kind="ics",
        target={"kind": "course", "course_id": course["id"], "term_id": term_id},
        upload_ids=[upload],
    )  # fmt: skip
    assert by_type(session, "course") == []
    meetings = by_type(session, "meeting")
    assert {m["data"]["course_ref"] for m in meetings} == {f"course:{course['id']}"}
    assert all(not m["issues"] for m in meetings)
    # The file's other course (APS105) is listed but switched off.
    decisions = sorted(m["decision"] for m in meetings)
    assert decisions == ["accept", "reject", "reject", "reject"]  # MAT188: 1, APS105: 3
    assert all(e["data"].get("course_ref") for e in by_type(session, "event"))


async def test_wizard_drops_what_belongs_to_removed_courses(
    api: Api, fake_ai: list[dict[str, Any]], run_jobs
):
    program_id = await api.program()
    session = await api.create(
        program_id, source_kind="text",
        target={"kind": "term_wizard", "start_date": "2026-01-05", "end_date": "2026-04-24"},
        text="APS105 syllabus",
    )  # fmt: skip
    await run_jobs()
    await api.call("POST", f"/programs/{program_id}/terms", json=WINTER)
    # The user removed the only course row in the wizard: nothing of it is written or failed.
    done = await api.commit(session["id"], wizard_courses=[])
    assert (done["created"], done["failed"]) == (0, 0)
    assert all(i["decision"] == "reject" for i in done["session"]["items"] if i["type"] != "event")


async def test_course_page_timetable_keeps_other_courses_off(
    api: Api, fake_ai: list[dict[str, Any]], run_jobs
):
    program_id = await api.program()
    term_id = await api.term(program_id)
    course = await api.course(program_id, term_id)
    fake_ai.append(
        {
            "cells": [
                {"course_code": ev("APS105H1"), "type": ev("LEC"), "weekday": ev(1),
                 "start_time": ev("10:00"), "end_time": ev("11:00")},
                {"course_code": ev("ECE110H1"), "type": ev("LEC"), "weekday": ev(3),
                 "start_time": ev("13:00"), "end_time": ev("15:00")},
            ]
        }
    )  # fmt: skip
    upload = await api.upload("week.png", b"\x89PNG fake", "image/png")
    session = await api.create(
        program_id, source_kind="timetable_image",
        target={"kind": "course", "course_id": course["id"], "term_id": term_id},
        upload_ids=[upload],
    )  # fmt: skip
    await run_jobs()
    session = await api.call("GET", f"/imports/{session['id']}")
    assert by_type(session, "course") == []
    assert [(m["data"]["weekday"], m["decision"]) for m in by_type(session, "meeting")] == [
        (1, "accept"),
        (3, "reject"),
    ]


async def test_image_syllabus_goes_to_the_vision_model(
    api: Api, fake_ai: list[dict[str, Any]], run_jobs, monkeypatch: pytest.MonkeyPatch
):
    seen: list[dict[str, Any]] = []
    real = extraction.run_extract

    async def spy(ctx: Any, purpose: str, schema: Any, **kwargs: Any) -> Any:
        seen.append({"purpose": purpose, "images": len(kwargs.get("images") or [])})
        return await real(ctx, purpose, schema, **kwargs)

    monkeypatch.setattr(extraction, "run_extract", spy)
    program_id = await api.program()
    upload = await api.upload("syllabus.png", b"\x89PNG fake", "image/png")
    session = await api.create(
        program_id, source_kind="syllabus",
        target={"kind": "term_wizard", "start_date": "2026-01-05", "end_date": "2026-04-24"},
        upload_ids=[upload],
    )  # fmt: skip
    await run_jobs()
    session = await api.call("GET", f"/imports/{session['id']}")
    assert session["source_refs"][0]["status"] == "done"
    assert seen == [{"purpose": "vision", "images": 1}]
    assert by_type(session, "course")[0]["data"]["code"] == "APS105H1"


async def test_untitled_syllabus_does_not_rename_the_course(
    api: Api, fake_ai: list[dict[str, Any]], run_jobs
):
    program_id = await api.program()
    term_id = await api.term(program_id)
    course = await api.course(program_id, term_id, title="Programming Fundamentals")
    untitled = {**SYLLABUS, "course": {**SYLLABUS["course"], "title": ev(None)}}
    fake_ai.append(untitled)
    session = await api.create(
        program_id, source_kind="text", target={"kind": "course", "course_id": course["id"]},
        text="APS105 ...", source_meta={"only": "course_info"},
    )  # fmt: skip
    await run_jobs()
    session = await api.call("GET", f"/imports/{session['id']}")
    (patch,) = by_type(session, "course_patch")
    assert "title" not in patch["data"]["changes"]
    assert patch["decision"] == "accept"
    # Instructors are added to the course's list.
    assert [i["name"] for i in patch["data"]["changes"]["instructors"]["new"]] == ["Ada Lovelace"]

    # A new course without a title is named after its code.
    fake_ai.append(untitled)
    wizard = await api.create(
        await api.program(), source_kind="text",
        target={"kind": "term_wizard", "start_date": "2026-09-01", "end_date": "2026-12-20"},
        text="APS105 ...",
    )  # fmt: skip
    await run_jobs()
    wizard = await api.call("GET", f"/imports/{wizard['id']}")
    assert by_type(wizard, "course")[0]["data"]["title"] == "APS105H1"


async def test_course_info_up_to_date(api: Api, fake_ai: list[dict[str, Any]], run_jobs):
    program_id = await api.program()
    term_id = await api.term(program_id)
    course = await api.course(
        program_id, term_id, title="Computer Fundamentals", description="Programming in C.",
        instructors=[{"name": "Ada Lovelace", "email": "ada@example.edu"}],
    )  # fmt: skip
    session = await api.create(
        program_id, source_kind="text", target={"kind": "course", "course_id": course["id"]},
        text="APS105 ...", source_meta={"only": "course_info"},
    )  # fmt: skip
    await run_jobs()
    session = await api.call("GET", f"/imports/{session['id']}")
    assert (session["status"], session["error_code"]) == ("failed", "import.no_changes")


async def test_discard_while_reading_stays_discarded(
    api: Api, fake_ai: list[dict[str, Any]], run_jobs, monkeypatch: pytest.MonkeyPatch
):
    program_id = await api.program()
    session = await api.create(
        program_id, source_kind="text",
        target={"kind": "term_wizard", "start_date": "2026-01-05", "end_date": "2026-04-24"},
        text="APS105 ...",
    )  # fmt: skip
    real = extraction.run_extract

    async def discard_meanwhile(ctx: Any, purpose: str, schema: Any, **kwargs: Any) -> Any:
        await api.call("POST", f"/imports/{session['id']}:discard")
        return await real(ctx, purpose, schema, **kwargs)

    monkeypatch.setattr(extraction, "run_extract", discard_meanwhile)
    await run_jobs()
    after = await api.call("GET", f"/imports/{session['id']}")
    assert after["status"] == "discarded"
    assert after["items"] == []


async def test_pdf_syllabus_with_a_task(api: Api, fake_ai: list[dict[str, Any]], run_jobs):
    """With M05 and M07 present: a PDF is read by M07's parser and a deadline becomes a task."""
    from semestra.modules.files.tests.conftest import make_pdf

    program_id = await api.program()
    term_id = await api.term(program_id)
    course = await api.course(program_id, term_id)
    pdf = make_pdf(["APS105 Computer Fundamentals", "Drop deadline: March 9"])
    upload = await api.upload("syllabus.pdf", pdf, "application/pdf")
    session = await api.create(
        program_id, source_kind="syllabus",
        target={"kind": "course", "course_id": course["id"], "term_id": term_id},
        upload_ids=[upload],
    )  # fmt: skip
    await run_jobs()
    session = await api.call("GET", f"/imports/{session['id']}")
    assert session["source_refs"][0]["status"] == "done"
    (task,) = by_type(session, "task")
    await api.call(
        "POST", f"/imports/{session['id']}/items:decide",
        json={"decision": "reject", "types": ["assessment", "category", "meeting", "event"]},
    )  # fmt: skip
    done = await api.commit(session["id"])
    assert (done["created"], done["failed"]) == (1, 0)
    created = next(i for i in done["session"]["items"] if i["id"] == task["id"])
    got = await api.call("GET", f"/tasks/{created['result']['created_id']}")
    assert (got["title"], got["due_date"], got["course_id"]) == (
        "Drop deadline", "2026-03-09", course["id"]
    )  # fmt: skip


async def test_meeting_outside_its_term_fails_instead_of_landing_in_week_one(
    app: FastAPI, api: Api
):
    program_id = await api.program()
    term_id = await api.term(program_id)
    me = await api.call("GET", "/account/me")
    async with system_ctx(app.state, me["id"]) as ctx:
        ctx.actor = "agent"
        created = await registry.invoke(
            ctx,
            "imports.session.create",
            {"program_id": program_id, "source_kind": "agent",
             "target": {"kind": "term", "term_id": term_id}},
            "agent",
        )  # fmt: skip
        assert isinstance(created, dict)
        session_id = created["id"]
        await registry.invoke(
            ctx,
            "imports.item.add_many",
            {"session_id": session_id, "items": [
                {"key": "c", "type": "course", "data": {"title": "Linear Algebra",
                                                          "code": "MAT188H1"}},
                # A fall meeting in a winter term.
                {"type": "meeting", "data": {"course_ref": "item:c", "weekday": 1,
                                              "start_time": "09:00", "end_time": "10:00",
                                              "first_date": "2026-09-08",
                                              "last_date": "2026-12-07"}},
            ]},
            "agent",
        )  # fmt: skip
        await ctx.db.commit()
    # The review flags it before the commit; the commit still refuses it.
    session = await api.call("GET", f"/imports/{session_id}")
    meeting = by_type(session, "meeting")[0]
    assert [i["code"] for i in meeting["issues"]] == ["import.outside_term"]
    done = await api.commit(session_id)
    assert (done["created"], done["failed"]) == (1, 1)
    failed = next(i for i in done["session"]["items"] if i["type"] == "meeting")
    assert failed["result"]["error_code"] == "import.outside_term"


FALL = {"name": "Fall 2026", "start_date": "2026-09-07", "end_date": "2026-12-31", "breaks": []}


async def test_a_course_item_takes_its_meetings_to_its_own_term(app: FastAPI, api: Api):
    # One session for a file covering two terms: the course item's `term_ids` decide where it
    # goes, and its meetings are checked against that term, as the commit places them.
    program_id = await api.program()
    winter = await api.term(program_id)
    fall = (await api.call("POST", f"/programs/{program_id}/terms", json=FALL))["term"]["id"]
    me = await api.call("GET", "/account/me")

    async def agent(name: str, args: dict[str, Any]) -> dict[str, Any]:
        async with system_ctx(app.state, me["id"]) as ctx:
            ctx.actor = "agent"
            out = await registry.invoke(ctx, name, args, "agent")
            await ctx.db.commit()
        return out.model_dump(mode="json") if isinstance(out, BaseModel) else out

    session = await agent(
        "imports.session.create",
        {"program_id": program_id, "source_kind": "agent",
         "target": {"kind": "term", "term_id": winter}},
    )  # fmt: skip
    session_id = session["id"]
    added = await agent(
        "imports.item.add_many",
        {"session_id": session_id, "ready": True, "items": [
            {"key": "w", "type": "course", "data": {"title": "Calculus", "code": "MAT194H1"}},
            {"type": "meeting", "data": {"course_ref": "item:w", "weekday": 2,
                                          "start_time": "09:00", "end_time": "10:00",
                                          "first_date": "2026-01-06", "last_date": "2026-04-07"}},
            {"key": "f", "type": "course", "data": {"title": "Linear Algebra",
                                                      "code": "MAT188H1"}},
            {"type": "meeting", "data": {"course_ref": "item:f", "weekday": 1,
                                          "start_time": "09:00", "end_time": "10:00",
                                          "first_date": "2026-09-14", "last_date": "2026-12-07"}},
            # A full-year course's fall meeting goes to fall, though the target is winter.
            {"key": "y", "type": "course", "data": {"title": "Analysis", "code": "MAT157Y1",
                                                      "term_ids": [fall, winter]}},
            {"type": "meeting", "data": {"course_ref": "item:y", "weekday": 3,
                                          "start_time": "11:00", "end_time": "12:00",
                                          "first_date": "2026-09-16", "last_date": "2026-12-02"}},
        ]},
    )  # fmt: skip
    assert added["summary"]["issues"] == {"import.outside_term": 1}
    fall_course = next(i for i in added["items"] if i["data"].get("code") == "MAT188H1")

    moved = await agent(
        "imports.item.update",
        {"session_id": session_id, "item_id": fall_course["id"], "data": {"term_ids": [fall]}},
    )
    assert moved["summary"]["issues"] == {}

    # The confirmation card says what the commit writes, by name and count, without ids.
    # Items still to decide are counted, since the commit leaves them out.
    year_meeting = next(i for i in added["items"] if i["data"].get("first_date") == "2026-09-16")
    await agent(
        "imports.item.update",
        {"session_id": session_id, "item_id": year_meeting["id"], "decision": "pending"},
    )
    async with system_ctx(app.state, me["id"]) as ctx:
        preview = await service.commit_preview(ctx, session_id)
    assert preview == {
        "target": "Winter 2026",
        "changes": [
            {"field": "import_course", "after": ["MAT194H1", "MAT188H1", "MAT157Y1"]},
            {"field": "import_meeting", "after": 2},
            {"field": "import_pending", "after": 1},
        ],
    }
    await agent(
        "imports.item.update",
        {"session_id": session_id, "item_id": year_meeting["id"], "decision": "accept"},
    )

    done = await api.commit(session_id)
    assert (done["created"], done["failed"]) == (6, 0)
    courses = await api.call("GET", f"/programs/{program_id}/courses")
    terms = {c["code"]: sorted(c["term_ids"]) for c in courses["items"]}
    assert terms == {"MAT194H1": [winter], "MAT188H1": [fall], "MAT157Y1": sorted([fall, winter])}


@pytest.mark.parametrize("tool", ["imports.item.decide_many", "imports.item.update"])
async def test_rejecting_a_course_rejects_what_belongs_to_it(app: FastAPI, api: Api, tool: str):
    program_id = await api.program()
    term_id = await api.term(program_id)
    upload = await api.upload("acorn.ics", ACORN, "text/calendar")
    session = await api.create(
        program_id, source_kind="ics", target={"kind": "term", "term_id": term_id},
        upload_ids=[upload],
    )  # fmt: skip
    course = by_type(session, "course")[0]
    own = [
        i["id"] for i in session["items"] if i["data"].get("course_ref") == f"item:{course['id']}"
    ]
    assert own
    me = await api.call("GET", "/account/me")
    async with system_ctx(app.state, me["id"]) as ctx:
        ctx.actor = "agent"
        args: dict[str, Any] = {"session_id": session["id"], "decision": "reject"}
        if tool == "imports.item.update":
            args["item_id"] = course["id"]
        else:
            args["item_ids"] = [course["id"]]
        out = await registry.invoke(ctx, tool, args, "agent")
        await ctx.db.commit()
    if tool == "imports.item.decide_many":
        assert isinstance(out, dict)
        assert out["changed"] == 1 + len(own)
    after = await api.call("GET", f"/imports/{session['id']}")
    rejected = {i["id"] for i in after["items"] if i["decision"] == "reject"}
    assert rejected == {course["id"], *own}


async def test_agent_cannot_start_the_term_wizard(app: FastAPI, api: Api):
    program_id = await api.program()
    me = await api.call("GET", "/account/me")
    async with system_ctx(app.state, me["id"]) as ctx:
        ctx.actor = "agent"
        with pytest.raises(AppError) as err:
            await registry.invoke(
                ctx,
                "imports.session.create",
                {"program_id": program_id, "source_kind": "agent",
                 "target": {"kind": "term_wizard", "start_date": "2026-01-05",
                            "end_date": "2026-04-24"}},
                "agent",
            )  # fmt: skip
    assert err.value.code == "common.validation"


async def test_the_assistant_reads_an_import_a_part_at_a_time(app: FastAPI, api: Api):
    program_id = await api.program()
    term_id = await api.term(program_id)
    upload = await api.upload("acorn.ics", ACORN, "text/calendar")
    session = await api.create(
        program_id, source_kind="ics", target={"kind": "term", "term_id": term_id},
        upload_ids=[upload],
    )  # fmt: skip
    meeting = by_type(session, "meeting")[0]
    me = await api.call("GET", "/account/me")

    async def agent(name: str, args: dict[str, Any]) -> dict[str, Any]:
        async with system_ctx(app.state, me["id"]) as ctx:
            ctx.actor = "agent"
            out = await registry.invoke(ctx, name, args, "agent")
            await ctx.db.commit()
        return out.model_dump(mode="json") if isinstance(out, BaseModel) else out

    # By default: the summary and a page of items without evidence or confidence.
    page = await agent("imports.session.get", {"session_id": session["id"], "limit": 3})
    assert page["summary"]["counts"] == {"course": 2, "meeting": 4, "event": 2}
    assert len(page["items"]) == 3
    assert page["next_cursor"] == "3"
    # `result` is null until the commit, and list items leave out null fields.
    assert set(page["items"][0]) == {"id", "type", "data", "decision", "issues"}
    rest = await agent("imports.session.get", {"session_id": session["id"], "cursor": "3"})
    assert len(rest["items"]) == 5
    assert rest["next_cursor"] is None

    one = await agent(
        "imports.session.get",
        {"session_id": session["id"], "item_ids": [meeting["id"]], "fields": ["decision"]},
    )
    assert one["items"] == [{"id": meeting["id"], "decision": "accept"}]
    courses = await agent("imports.session.get", {"session_id": session["id"], "types": ["course"]})
    assert {i["type"] for i in courses["items"]} == {"course"}

    # A change gives back the changed item only; a bulk decision none.
    changed = await agent(
        "imports.item.update",
        {"session_id": session["id"], "item_id": meeting["id"], "data": {"location": "BA 1"}},
    )
    assert [i["id"] for i in changed["items"]] == [meeting["id"]]
    assert changed["items"][0]["data"]["location"] == "BA 1"
    bulk = await agent(
        "imports.item.decide_many",
        {"session_id": session["id"], "decision": "reject", "types": ["event"]},
    )
    assert bulk["changed"] == 2
    assert set(bulk["session"]) == {"id", "summary"}

    # The session itself comes without bookkeeping, and items without their source refs.
    assert set(page) == {"id", "status", "error_code", "source_refs", "summary", "items",
                         "next_cursor"}  # fmt: skip
    assert all("source_ref" not in i["data"] for i in page["items"] + rest["items"])

    # The app still gets the whole session.
    full = await api.call("GET", f"/imports/{session['id']}")
    assert len(full["items"]) == 8
    assert "evidence" in full["items"][0]


async def test_http_with_a_token_gets_the_whole_session(app: FastAPI, api: Api):
    # Trimmed results are for assistant and MCP tool calls, not for HTTP callers using a token.
    program_id = await api.program()
    term_id = await api.term(program_id)
    upload = await api.upload("acorn.ics", ACORN, "text/calendar")
    session = await api.create(
        program_id, source_kind="ics", target={"kind": "term", "term_id": term_id},
        upload_ids=[upload],
    )  # fmt: skip
    body = {"name": "Script", "scopes": ["write"]}
    token = (await api.call("POST", "/account/tokens", json=body))["token"]
    auth = {"Authorization": f"Bearer {token}"}
    async with AsyncClient(transport=ASGITransport(app), base_url="https://test") as other:
        got = await other.get(f"/imports/{session['id']}", headers=auth)
        assert got.status_code == 200, got.text
        assert len(got.json()["items"]) == len(session["items"])
        item = session["items"][0]
        patched = await other.patch(
            f"/imports/{session['id']}/items/{item['id']}", json={"decision": "reject"},
            headers=auth,
        )  # fmt: skip
        assert patched.status_code == 200, patched.text
        assert len(patched.json()["items"]) == len(session["items"])


def test_agent_output_paths_reach_into_lists():
    from semestra.core.agent_output import _keep_paths  # pyright: ignore[reportPrivateUsage]

    dumped = {
        "failed": 1,
        "session": {
            "id": "s",
            "items": [{"id": "i", "type": "course", "evidence": "long", "position": 3}],
        },
    }
    kept = _keep_paths(dumped, ("failed", "session.id", "session.items.id", "session.items.type"))
    assert kept == {"failed": 1, "session": {"id": "s", "items": [{"id": "i", "type": "course"}]}}
