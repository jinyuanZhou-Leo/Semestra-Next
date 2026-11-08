"""The module's own logic with a fake provider (M09 §11): nothing here knows about Canvas."""

from datetime import UTC, datetime
from typing import Any
from unittest.mock import ANY

import pytest
from fastapi import FastAPI
from sqlalchemy import select

from semestra.core.context import system_ctx
from semestra.core.errors import AppError, not_found
from semestra.modules.imports.service import committing as imports_committing
from semestra.modules.lms import imports as lms_imports
from semestra.modules.lms import service
from semestra.modules.lms.errors import lms_error
from semestra.modules.lms.models import LmsConnection, LmsImportedRef
from semestra.modules.lms.schemas.dto import LmsCalendarEvent
from semestra.modules.lms.schemas.io import CoursesImportInput
from semestra.modules.lms.tests.conftest import Api, FakeProvider
from semestra.testing import collect_events

pytestmark = pytest.mark.usefixtures("fake")


async def setup_program(api: Api) -> tuple[str, str, str]:
    program_id = await api.program()
    term_id = await api.term(program_id)
    connection = await api.connection()
    await api.bind(program_id, connection["id"])
    return program_id, term_id, connection["id"]


def by_type(session: dict[str, Any], type_: str) -> list[dict[str, Any]]:
    return [i for i in session["items"] if i["type"] == type_]


async def test_connection_secrets_never_leave(api: Api, app: FastAPI):
    created = await api.connection(display_name="My school")
    assert created["credentials_hint"] == {"token": "go…"}
    assert created["account_name"] == "Ada Student"
    assert created["status"] == "connected"
    listed = await api.call("GET", "/lms/connections")
    for body in (created, listed):
        assert "good-token-1" not in str(body)
    async with system_ctx(app.state) as ctx:
        row = await ctx.db.get(LmsConnection, created["id"])
        assert row is not None
        assert row.credentials_encrypted is not None
        assert row.credentials_encrypted.startswith("v1:")
        assert "good-token-1" not in row.credentials_encrypted
    # Checked before saving: a bad token saves nothing.
    err = await api.call(
        "POST", "/lms/connections", 400,
        json={"provider": "fake", "config": {"base_url": "https://x.edu"},
              "credentials": {"token": "bad"}},
    )  # fmt: skip
    assert err["error"]["code"] == "lms.invalid_credentials"
    assert len((await api.call("GET", "/lms/connections"))["items"]) == 1
    err = await api.call(
        "POST", "/lms/connections", 422,
        json={"provider": "moodle", "config": {}, "credentials": {}},
    )  # fmt: skip
    assert err["error"]["code"] == "lms.provider_unknown"
    providers = await api.call("GET", "/lms/providers")
    assert {"canvas", "fake"} <= {p["kind"] for p in providers["items"]}


async def test_validate_and_recheck(api: Api, fake: FakeProvider):
    check = await api.call(
        "POST", "/lms/connections:validate",
        json={"provider": "fake", "config": {"base_url": "https://x.edu"},
              "credentials": {"token": "good-token-2"}},
    )  # fmt: skip
    assert check["ok"]
    assert check["summary"]["account_name"] == "Ada Student"
    created = await api.connection()
    fake.valid_tokens.clear()  # the token was revoked on the LMS
    check = await api.call(
        "POST", "/lms/connections:validate", json={"connection_id": created["id"]}
    )
    assert not check["ok"]
    assert check["error_code"] == "lms.invalid_credentials"
    assert check["connection"]["status"] == "error"
    # A new token fixes it.
    fake.valid_tokens.add("good-token-2")
    updated = await api.call(
        "PATCH",
        f"/lms/connections/{created['id']}",
        json={"credentials": {"token": "good-token-2"}},
    )
    assert updated["status"] == "connected"
    assert updated["last_error_code"] is None


async def test_binding_and_link_rules(api: Api):
    program_id = await api.program()
    term_id = await api.term(program_id)
    course_a = await api.course(program_id, term_id)
    course_b = await api.course(program_id, term_id, code="MAT186H1", title="Calculus")
    conn = (await api.connection())["id"]
    other = (await api.connection(token="good-token-2"))["id"]

    # No binding yet: links are refused and the state says so.
    state = await api.call("GET", f"/courses/{course_a}/lms-link")
    assert state == {"course_id": course_a, "link": None, "program_connection_id": None}
    err = await api.link(course_a, "101", 409)
    assert err["error"]["code"] == "lms.program_not_configured"

    await api.bind(program_id, conn)
    state = await api.link(course_a, "101")
    assert state["link"]["external_name"] == "Computer Fundamentals"
    assert state["link"]["connection_id"] == conn
    links = await api.call("GET", f"/programs/{program_id}/lms-links")
    assert [(li["course_id"], li["provider"]) for li in links["items"]] == [(course_a, "fake")]
    # One external course, one course of the Program.
    err = await api.link(course_b, "101", 409)
    assert err["error"] == {
        "code": "lms.course_already_linked",
        "params": {"course_id": course_a},
        "request_id": err["error"]["request_id"],
    }
    # With links the binding cannot change or go.
    err = await api.bind(program_id, other, 409)
    assert err["error"]["code"] == "lms.program_has_links"
    assert err["error"]["params"] == {"count": 1}
    err = await api.call("DELETE", f"/programs/{program_id}/lms-binding", 409)
    assert err["error"]["code"] == "lms.program_has_links"
    binding = await api.call("GET", f"/programs/{program_id}/lms-binding")
    assert binding["connection_id"] == conn
    assert binding["link_count"] == 1

    # External courses say which course they are linked to.
    courses = await api.call("GET", f"/programs/{program_id}/lms/courses")
    assert [(c["external_id"], c["linked_course_id"]) for c in courses["items"]] == [
        ("101", course_a),
        ("102", None),
    ]
    past = await api.call("GET", f"/programs/{program_id}/lms/courses?include_past=true")
    assert len(past["items"]) == 3

    # Sync, toggle and unlink.
    state = await api.call("POST", f"/courses/{course_a}/lms-link:sync")
    assert state["link"]["last_error_code"] is None
    state = await api.call("PATCH", f"/courses/{course_a}/lms-link", json={"sync_enabled": False})
    assert state["link"]["sync_enabled"] is False
    state = await api.call("DELETE", f"/courses/{course_a}/lms-link")
    assert state["link"] is None
    await api.bind(program_id, other)  # no links left: the binding can change


async def test_delete_connection(api: Api):
    program_id, term_id, conn = await setup_program(api)
    course = await api.course(program_id, term_id)
    await api.link(course, "101")
    err = await api.call("DELETE", f"/lms/connections/{conn}", 409)
    assert err["error"] == {
        "code": "lms.connection_in_use",
        "params": {"programs": [program_id]},
        "request_id": err["error"]["request_id"],
    }
    done = await api.call("DELETE", f"/lms/connections/{conn}?detach_all=true")
    assert (done["unbound_programs"], done["unlinked_courses"]) == (1, 1)
    assert (await api.call("GET", f"/courses/{course}/lms-link"))["link"] is None
    assert (await api.call("GET", "/lms/connections"))["items"] == []


async def test_reads_are_cleaned_and_cached(api: Api, fake: FakeProvider):
    program_id, term_id, _ = await setup_program(api)
    course = await api.course(program_id, term_id)
    err = await api.call("GET", f"/courses/{course}/lms/announcements", 409)
    assert err["error"]["code"] == "lms.course_not_linked"
    await api.link(course, "101")

    news = await api.call("GET", f"/courses/{course}/lms/announcements")
    html = news["items"][0]["html"]
    assert "<script" not in html
    assert "alert" not in html
    assert 'data-lms-kind="page"' in html
    assert 'data-lms-ref="intro"' in html
    assert '<img data-lms-kind="file" data-lms-ref="77"' in html  # loaded through the proxy
    assert 'rel="noopener noreferrer"' in html
    assert 'target="_blank"' in html
    page = await api.call("GET", f"/courses/{course}/lms/pages/intro")
    assert "<iframe" not in page["html"]
    assert '<h1 style="color:#123">' in page["html"]  # layout-changing properties dropped
    # Relative addresses point at the platform, as they do there, not at the app.
    assert 'href="https://fake/courses/101/pages/cover.html"' in page["html"]
    assert 'src="https://fake/images/logo.png"' in page["html"]

    fake.calls.clear()
    await api.call("GET", f"/courses/{course}/lms/announcements")
    assert fake.calls == []  # from the cache
    await api.call("GET", f"/courses/{course}/lms/announcements?refresh=true")
    assert fake.calls == [("announcements", ["101"])]

    overview = await api.call("GET", f"/courses/{course}/lms")
    assert overview["provider"] == "fake"
    assert "quizzes" in overview["features"]
    assert overview["navigation"][0]["kind"] == "home"
    for path in ("grades", "modules", "modules/m1/items", "pages", "quizzes", "syllabus",
                 "files/f1"):  # fmt: skip
        await api.call("GET", f"/courses/{course}/lms/{path}")
    r = await api.client.get(f"/courses/{course}/lms/files/f1/content")
    assert r.status_code == 200
    assert r.content == b"hello"
    assert r.headers["content-disposition"].startswith("inline")
    r = await api.client.get(f"/courses/{course}/lms/files/f1/content?download=true")
    assert r.headers["content-disposition"].startswith("attachment")
    r = await api.client.get(f"/courses/{course}/lms/files/f1/content?check=true")
    assert r.status_code == 204
    assert r.content == b""


async def test_unsupported_feature(api: Api, fake: FakeProvider, monkeypatch: pytest.MonkeyPatch):
    program_id, term_id, _ = await setup_program(api)
    course = await api.course(program_id, term_id)
    await api.link(course, "101")
    monkeypatch.setattr(type(fake), "features", frozenset({"courses", "assignments"}))
    err = await api.call("GET", f"/courses/{course}/lms/quizzes", 409)
    assert err["error"]["code"] == "lms.feature_unsupported"
    assert err["error"]["params"] == {"feature": "quizzes"}


async def test_import_courses_creates_links_in_the_commit(api: Api):
    program_id, term_id, conn = await setup_program(api)
    started = await api.call(
        "POST", f"/programs/{program_id}/lms/imports:courses",
        json={"external_course_ids": ["101", "102"], "term_id": term_id},
    )  # fmt: skip
    assert started["count"] == 2
    session = await api.call("GET", f"/imports/{started['session_id']}")
    assert session["source_kind"] == "lms"
    assert session["status"] == "ready"
    first = by_type(session, "course")[0]["data"]
    assert (first["title"], first["code"], first["alias"]) == (
        "Computer Fundamentals",
        "APS105H1",
        "APS105H1 S LEC0101",
    )
    done = await api.commit(started["session_id"])
    assert done["failed"] == 0
    courses = await api.call("GET", f"/programs/{program_id}/lms/courses")
    linked = {c["external_id"]: c["linked_course_id"] for c in courses["items"]}
    assert linked["101"]
    assert linked["102"]
    state = await api.call("GET", f"/courses/{linked['101']}/lms-link")
    assert state["link"]["connection_id"] == conn
    # Already linked courses are not offered again.
    err = await api.call(
        "POST", f"/programs/{program_id}/lms/imports:courses", 422,
        json={"external_course_ids": ["101"], "term_id": term_id},
    )  # fmt: skip
    assert err["error"]["code"] == "import.no_content"


async def test_agent_cannot_import_courses_for_the_wizard(api: Api, app: FastAPI):
    program_id, _, _ = await setup_program(api)
    me = await api.call("GET", "/account/me")
    async with system_ctx(app.state, me["id"]) as ctx:
        ctx.actor = "agent"
        with pytest.raises(AppError) as err:
            await lms_imports.import_courses(
                ctx,
                CoursesImportInput(
                    program_id=program_id, external_course_ids=["101"], term_wizard=True
                ),
            )
    assert err.value.code == "common.validation"
    assert err.value.params["errors"] == [{"loc": ["term_wizard"], "code": "wizard_only"}]


async def test_import_courses_rolls_back_with_its_links(api: Api, monkeypatch: pytest.MonkeyPatch):
    program_id, term_id, _ = await setup_program(api)
    started = await api.call(
        "POST", f"/programs/{program_id}/lms/imports:courses",
        json={"external_course_ids": ["101"], "term_id": term_id},
    )  # fmt: skip

    async def broken(*args: Any, **kwargs: Any) -> Any:
        raise AppError("common.internal", 500)

    monkeypatch.setattr(service, "create_link", broken)
    await api.commit(started["session_id"], 500)
    courses = await api.call("GET", f"/programs/{program_id}/courses")
    assert courses["items"] == []  # the course went with the failed link


async def test_a_stale_course_import_rolls_back_instead_of_duplicating(api: Api):
    program_id, term_id, _ = await setup_program(api)
    body = {"external_course_ids": ["101"], "term_id": term_id}
    first = await api.call("POST", f"/programs/{program_id}/lms/imports:courses", json=body)
    second = await api.call("POST", f"/programs/{program_id}/lms/imports:courses", json=body)
    assert (await api.commit(first["session_id"]))["failed"] == 0
    err = await api.commit(second["session_id"], 409)
    assert err["error"]["code"] == "lms.course_already_linked"
    courses = await api.call("GET", f"/programs/{program_id}/courses")
    assert len(courses["items"]) == 1


async def test_a_link_is_refused_when_the_binding_moved_during_the_lookup(
    api: Api, app: FastAPI, fake: FakeProvider, monkeypatch: pytest.MonkeyPatch
):
    program_id, term_id, _ = await setup_program(api)
    course = await api.course(program_id, term_id)
    other = await api.connection(display_name="Other")
    original = type(fake).get_course

    async def moving(self: FakeProvider, *args: Any) -> Any:
        # Another request rebinds the Program while the platform is being asked.
        async with system_ctx(app.state) as ctx:
            from semestra.modules.lms.models import LmsProgramBinding

            row = await ctx.db.get(LmsProgramBinding, program_id)
            assert row is not None
            row.connection_id = other["id"]
            await ctx.db.commit()
        return await original(self, *args)

    monkeypatch.setattr(type(fake), "get_course", moving)
    err = await api.link(course, "101", 409)
    assert err["error"]["code"] == "lms.program_not_configured"
    state = await api.call("GET", f"/courses/{course}/lms-link")
    assert state["link"] is None


async def test_import_assignments_once_and_updates(api: Api, app: FastAPI, fake: FakeProvider):
    program_id, term_id, conn = await setup_program(api)
    course = await api.course(program_id, term_id)
    await api.link(course, "101")
    me = await api.call("GET", "/account/me")
    with collect_events(app, me["id"]) as messages:
        started = await api.call(
            "POST", f"/courses/{course}/lms/imports:assignments",
            json={"external_ids": ["a1", "a2", "a3"]},
        )  # fmt: skip
    # Nothing needed a decision: saved at once.
    assert (started["committed"], started["failed"]) == (True, 0)
    # The course's "new on the platform" list changed with it.
    recorded = [m["data"] for m in messages if m["type"] == "lms.course.imports_recorded"]
    assert recorded == [{"course_id": course}]
    session = await api.call("GET", f"/imports/{started['session_id']}")
    categories = by_type(session, "category")
    assert [(c["data"]["name"], c["data"]["weight_total"]) for c in categories] == [
        ("Labs", 20),
        ("Exams", 80),
    ]
    assessments = by_type(session, "assessment")
    assert [(a["data"]["title"], a["data"]["weight"]) for a in assessments] == [
        ("Lab 1", 5),
        ("Lab 2", 15),
        ("Midterm", 80),
    ]
    lab1 = assessments[0]["data"]
    # Due times are in the Program's time zone.
    assert (lab1["due_date"], lab1["due_time"]) == ("2026-02-06", "23:59:00")
    assert lab1["source_ref"] == f"lms:{conn}:assignment:a1"
    listed = await api.call("GET", f"/courses/{course}/lms/assignments")
    assert all(a["imported_as"]["kind"] == "assessment" for a in listed["items"])
    gradebook = await api.call("GET", f"/courses/{course}/assessments")
    assert len(gradebook["items"]) == 3

    # Importing the same assignments again creates nothing.
    err = await api.call(
        "POST", f"/courses/{course}/lms/imports:assignments", 422,
        json={"external_ids": ["a1"]},
    )  # fmt: skip
    assert err["error"]["code"] == "import.no_content"

    # No changes, then the due date and the name of Lab 1 change on the LMS.
    assert (await api.call("GET", f"/courses/{course}/lms/updates"))["count"] == 0
    fake.course_assignments["101"][0] = fake.course_assignments["101"][0].model_copy(
        update={"name": "Lab 1 (revised)", "points": 20,
                "due_at": datetime(2026, 2, 13, 4, 59, tzinfo=UTC)}
    )  # fmt: skip
    updates = await api.call("GET", f"/courses/{course}/lms/updates?refresh=true")
    # Lab 2 changed nothing itself, but its share of the Labs' points fell: 15% -> 12%.
    assert updates["count"] == 2
    assert set(updates["items"][0]["changes"]) == {"title", "due_at", "points", "weight"}
    assert updates["items"][1]["changes"] == {"weight": {"old": 15, "new": 12}}
    review = await api.call("POST", f"/courses/{course}/lms/updates:review")
    patch = await api.call("GET", f"/imports/{review['session_id']}")
    item, lab2_item = patch["items"]
    assert lab2_item["data"]["changes"]["weight"] == {"old": 15, "new": 12, "apply": True}
    assert item["type"] == "assessment_patch"
    assert item["data"]["changes"]["due_date"] == {
        "old": "2026-02-06",
        "new": "2026-02-12",
        "apply": True,
    }
    # 20 of the Labs' 50 points: 8% of the grade instead of the 5% it has now.
    assert item["data"]["changes"]["weight"] == {"old": 5, "new": 8, "apply": True}
    done = await api.commit(review["session_id"])
    assert done["failed"] == 0
    lab = next(a for a in (await api.call("GET", f"/courses/{course}/assessments"))["items"]
               if a["title"].startswith("Lab 1"))  # fmt: skip
    assert lab["title"] == "Lab 1 (revised)"
    assert lab["due_date"] == "2026-02-12"
    assert (await api.call("GET", f"/courses/{course}/lms/updates"))["count"] == 0

    # A patch that fails to apply keeps the change on offer.
    fake.course_assignments["101"][2] = fake.course_assignments["101"][2].model_copy(
        update={"name": "Midterm (moved)"}
    )
    review = await api.call("POST", f"/courses/{course}/lms/updates:review")

    async def broken(*_: Any) -> dict[str, Any]:
        raise AppError("grading.assessment_not_found", 404)

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(imports_committing, "_write", broken)
        done = await api.commit(review["session_id"])
    assert done["failed"] == 1
    updates = await api.call("GET", f"/courses/{course}/lms/updates")
    assert [set(u["changes"]) for u in updates["items"]] == [{"title"}]

    # Deleting the assessment lets the assignment be imported again.
    await api.call("DELETE", f"/assessments/{lab['id']}")
    again = await api.call(
        "POST", f"/courses/{course}/lms/imports:assignments", json={"external_ids": ["a1"]}
    )
    assert again["count"] >= 1


async def test_calendar_overlay(api: Api, fake: FakeProvider, app: FastAPI):
    program_id, term_id, _ = await setup_program(api)
    course_a = await api.course(program_id, term_id)
    course_b = await api.course(program_id, term_id, code="MAT186H1", title="Calculus")
    await api.link(course_a, "101")
    await api.link(course_b, "102")
    when = datetime(2026, 2, 6, 15, 0, tzinfo=UTC)
    fake.events = [
        LmsCalendarEvent(external_id="e1", external_course_id="101",
                         title="Review session", start_at=when, html="<p>Room <b>5</b></p>"),
        LmsCalendarEvent(external_id="e2", external_course_id="102",
                         title="Tutorial", start_at=when),
    ]  # fmt: skip

    async def overlay() -> list[dict[str, Any]]:
        out = await api.call(
            "GET",
            f"/programs/{program_id}/calendar?start=2026-02-01&end=2026-02-10&sources=lms.events",
        )
        return out["items"]

    fake.calls.clear()
    items = await overlay()
    assert sorted(i["title"] for i in items) == [
        "APS105H1 · Review session",
        "MAT186H1 · Tutorial",
    ]
    review = next(i for i in items if i["title"].endswith("Review session"))
    assert review["meta"]["note"] == "Room 5"
    assert review["kind"] == "event"
    # Both courses in one call to the provider.
    assert [c for c in fake.calls if c[0] == "calendar_events"] == [
        ("calendar_events", ["101", "102"])
    ]

    # Sync off: the course leaves the overlay.
    await api.call("PATCH", f"/courses/{course_b}/lms-link", json={"sync_enabled": False})
    assert [i["title"] for i in await overlay()] == ["APS105H1 · Review session"]


async def test_deleting_a_course_removes_its_link(api: Api, app: FastAPI):
    program_id, term_id, _ = await setup_program(api)
    course = await api.course(program_id, term_id)
    await api.link(course, "101")
    assert (await api.client.delete(f"/courses/{course}")).is_success
    binding = await api.call("GET", f"/programs/{program_id}/lms-binding")
    assert binding["link_count"] == 0
    # Deleting the Program removes its binding too.
    assert (await api.client.delete(f"/programs/{program_id}")).is_success
    async with system_ctx(app.state) as ctx:
        from semestra.modules.lms.models import LmsProgramBinding

        assert (await ctx.db.scalars(select(LmsProgramBinding))).all() == []


async def test_save_to_course_needs_the_files_module(api: Api):
    program_id, term_id, _ = await setup_program(api)
    course = await api.course(program_id, term_id)
    await api.link(course, "101")
    try:
        import semestra.modules.files.service  # noqa: F401  # pyright: ignore[reportMissingImports]
    except ImportError:
        err = await api.call("POST", f"/courses/{course}/lms/files/f1:save", 409, json={})
        assert err["error"]["params"] == {"feature": "save_to_course"}


async def test_import_snapshot_helpers():
    assert lms_imports.course_code("APS105H1 S LEC0101") == "APS105H1"
    assert lms_imports.course_code("csc 108") == "CSC108"
    assert lms_imports.course_code("Intro Seminar") == "Intro Seminar"
    assert lms_imports._weights(  # pyright: ignore[reportPrivateUsage]
        [
            {"external_id": "x", "group_id": "g", "group_weight": 30, "points": 0},
            {"external_id": "y", "group_id": "g", "group_weight": 30, "points": 0},
            {"external_id": "z", "group_id": None, "group_weight": None, "points": 5},
        ]
    ) == {"x": 15, "y": 15}


async def test_portability_round_trip(api: Api, app: FastAPI):
    from semestra.modules.lms import portability

    program_id, term_id, conn = await setup_program(api)
    course = await api.course(program_id, term_id)
    await api.link(course, "101")
    async with system_ctx(app.state) as ctx:
        row = await ctx.db.get(LmsConnection, conn)
        assert row is not None
        user_id = row.user_id

    class Writer:
        payload: Any = None

        def write_json(self, obj: Any) -> None:
            self.payload = obj

    writer = Writer()
    async with system_ctx(app.state, user_id) as ctx:
        await portability.export(ctx, writer)
        await portability.purge(ctx)
        await ctx.db.commit()
    assert "good-token-1" not in str(writer.payload)
    assert await portability.preview(writer.payload) == {
        "connections": 1, "bindings": 1, "links": 1, "refs": 0,
    }  # fmt: skip
    identity = {program_id: program_id, course: course}
    async with system_ctx(app.state, user_id) as ctx:
        report = await portability.import_(ctx, writer.payload, identity)
        await ctx.db.commit()
    assert report.imported == {"connections": 1, "bindings": 1, "links": 1, "refs": 0}
    listed = (await api.call("GET", "/lms/connections"))["items"]
    assert len(listed) == 1
    assert listed[0]["has_credentials"] is False
    assert listed[0]["last_error_code"] == "lms.credentials_missing"


async def test_deleted_tasks_can_be_imported_again(api: Api, app: FastAPI):
    from semestra.core.events import Event
    from semestra.modules.lms.subscribers import on_task_deleted

    program_id, term_id, _ = await setup_program(api)
    course = await api.course(program_id, term_id)
    link = (await api.link(course, "101"))["link"]
    async with system_ctx(app.state) as ctx:
        owner = await ctx.db.get(LmsConnection, link["connection_id"])
        assert owner is not None
        for n in ("1", "2", "3"):
            ref = LmsImportedRef(
                user_id=owner.user_id,
                link_id=link["id"],
                external_kind="assignment",
                external_id=n,
                target_kind="task",
                target_id=f"t{n}",
                snapshot={},
                imported_at=datetime(2026, 1, 1, tzinfo=UTC),
            )
            ctx.db.add(ref)
        await ctx.db.commit()
    async with system_ctx(app.state, owner.user_id) as ctx:
        # One task, then a bulk clear (M05 sends `task_ids`).
        await on_task_deleted(ctx, Event("tasks.item.deleted", {"task_id": "t1"}, owner.user_id))
        await on_task_deleted(ctx, Event("tasks.item.deleted", {"task_ids": ["t2"]}, owner.user_id))
        await ctx.db.commit()
        left = await ctx.db.scalars(select(LmsImportedRef.target_id))
        assert list(left) == ["t3"]


async def test_saved_token_never_goes_to_a_new_address(api: Api, fake: FakeProvider):
    from structlog.testing import capture_logs

    with capture_logs() as logs:
        created = await api.connection()
    assert "good-token-1" not in str(logs)
    fake.calls.clear()
    moved = {"base_url": "https://typo.example.com"}
    err = await api.call("PATCH", f"/lms/connections/{created['id']}", 409, json={"config": moved})
    assert err["error"]["code"] == "lms.credentials_missing"
    check = await api.call(
        "POST", "/lms/connections:validate", json={"connection_id": created["id"], "config": moved}
    )
    assert check["error_code"] == "lms.credentials_missing"
    assert fake.calls == []  # nothing was sent anywhere
    # With a token typed again the address can change.
    updated = await api.call(
        "PATCH",
        f"/lms/connections/{created['id']}",
        json={"config": moved, "credentials": {"token": "good-token-1"}},
    )
    assert updated["config"]["base_url"] == "https://typo.example.com"


async def test_refresh_survives_a_broken_connection(
    api: Api, app: FastAPI, fake: FakeProvider, monkeypatch: pytest.MonkeyPatch
):
    first = await api.connection(display_name="Broken")
    second = await api.connection(display_name="Fine")
    original = type(fake).validate

    async def flaky(self: FakeProvider, io: Any, cfg: Any, creds: Any) -> Any:
        if not flaky.failed:
            flaky.failed = True
            raise RuntimeError("provider bug")
        return await original(self, io, cfg, creds)

    flaky.failed = False
    monkeypatch.setattr(type(fake), "validate", flaky)
    fake.valid_tokens.clear()  # the second check records an error
    async with system_ctx(app.state) as ctx:
        await service.refresh_all(ctx)
        await ctx.db.commit()
        rows = {r.id: r for r in await ctx.db.scalars(select(LmsConnection))}
    assert rows[first["id"]].status == "connected"
    assert rows[second["id"]].last_error_code == "lms.invalid_credentials"


async def test_a_saved_address_that_stops_being_the_api_breaks_the_connection(
    api: Api, app: FastAPI, fake: FakeProvider, monkeypatch: pytest.MonkeyPatch
):
    conn = await api.connection()

    async def moved(*_: Any) -> Any:
        raise lms_error("lms.invalid_config", field="base_url", reason="redirect")

    monkeypatch.setattr(fake, "validate", moved)
    async with system_ctx(app.state) as ctx:
        await service.refresh_all(ctx)
        await ctx.db.commit()
        row = await ctx.db.get(LmsConnection, conn["id"])
        assert row is not None
        assert (row.status, row.last_error_code) == ("error", "lms.invalid_config")


async def test_course_import_links_only_through_the_current_binding(api: Api):
    program_id, term_id, _ = await setup_program(api)
    started = await api.call(
        "POST", f"/programs/{program_id}/lms/imports:courses",
        json={"external_course_ids": ["101"], "term_id": term_id},
    )  # fmt: skip
    # The Program moves to another connection before the review is saved.
    other = await api.connection(display_name="Other")
    await api.bind(program_id, other["id"])
    done = await api.commit(started["session_id"])
    assert done["failed"] == 0
    courses = await api.call("GET", f"/programs/{program_id}/lms/courses")
    assert all(c["linked_course_id"] is None for c in courses["items"])


async def test_assignment_import_rolls_back_when_the_course_was_relinked(api: Api):
    program_id, term_id, _ = await setup_program(api)
    course = await api.course(program_id, term_id)
    await api.link(course, "101")
    started = await held_for_review(api, f"/courses/{course}/lms/imports:assignments", ["a1"])
    # Replacing a link has to be asked for; the error names the current one.
    err = await api.link(course, "102", 409)
    assert err["error"]["code"] == "lms.course_link_exists"
    assert err["error"]["params"]["external_course_id"] == "101"
    assert err["error"]["params"]["external_name"] == "Computer Fundamentals"
    await api.link(course, "101")  # the same link again is fine
    await api.link(course, "102", replace=True)  # the session's link row is gone
    err = await api.commit(started["session_id"], 409)
    assert err["error"]["code"] == "lms.course_not_linked"
    assert (await api.call("GET", f"/courses/{course}/assessments"))["items"] == []


async def test_an_assignment_imported_as_the_other_kind_meanwhile_rolls_back(
    api: Api, app: FastAPI
):
    program_id, term_id, _ = await setup_program(api)
    course = await api.course(program_id, term_id)
    link = (await api.link(course, "101"))["link"]
    started = await held_for_review(
        api, f"/courses/{course}/lms/imports:assignments", ["a1"], switch_to_task=True
    )
    # Another session put it into the gradebook after this one was opened.
    async with system_ctx(app.state) as ctx:
        owner = await ctx.db.get(LmsConnection, link["connection_id"])
        assert owner is not None
        ctx.db.add(
            LmsImportedRef(user_id=owner.user_id, link_id=link["id"], external_kind="assignment",
                           external_id="a1", target_kind="assessment", target_id="as1",
                           snapshot={}, imported_at=datetime(2026, 1, 15, tzinfo=UTC))
        )  # fmt: skip
        await ctx.db.commit()
    err = await api.commit(started["session_id"], 409)
    assert err["error"]["code"] == "lms.assignment_already_imported"
    assert (await api.call("GET", f"/programs/{program_id}/tasks"))["items"] == []


async def test_a_host_without_the_api_is_a_config_error_on_save(
    api: Api, fake: FakeProvider, monkeypatch: pytest.MonkeyPatch
):
    async def missing(*_: Any) -> Any:
        raise lms_error("lms.not_found")

    monkeypatch.setattr(fake, "validate", missing)
    payload = {"provider": "fake", "config": {"base_url": "https://fake.example.edu"},
               "credentials": {"token": "good-token-1"}}  # fmt: skip
    err = await api.call("POST", "/lms/connections", 422, json=payload)
    assert err["error"]["code"] == "lms.invalid_config"


async def test_check_results_announce_error_changes_within_a_status(
    api: Api, app: FastAPI, monkeypatch: pytest.MonkeyPatch
):
    conn = await api.connection()
    seen: list[tuple[str, str | None]] = []

    async def changed(ctx: Any, row: LmsConnection) -> None:
        seen.append((row.status, row.last_error_code))

    monkeypatch.setattr(service, "_status_changed", changed)
    async with system_ctx(app.state) as ctx:
        row = await ctx.db.get(LmsConnection, conn["id"])
        assert row is not None
        for code in ("lms.unreachable", "lms.unreachable", "lms.rate_limited", None, None):
            await service._record(ctx, row, code)  # pyright: ignore[reportPrivateUsage]
    # Still "connected" throughout, but each new error and the recovery are announced once.
    assert seen == [
        ("connected", "lms.unreachable"),
        ("connected", "lms.rate_limited"),
        ("connected", None),
    ]


async def test_point_changes_of_an_unweighted_course_are_not_updates(api: Api, fake: FakeProvider):
    program_id, term_id, _ = await setup_program(api)
    course = await api.course(program_id, term_id)
    await api.link(course, "101")
    items = fake.course_assignments["101"]
    items[:] = [a.model_copy(update={"group_weight": None}) for a in items]
    started = await api.call(
        "POST", f"/courses/{course}/lms/imports:assignments", json={"external_ids": ["a1"]}
    )
    # Without group weights there is no weight to take: the import waits for one.
    assert not started["committed"]
    session = await api.call("GET", f"/imports/{started['session_id']}")
    (item,) = by_type(session, "assessment")
    assert [i["code"] for i in item["issues"]] == ["import.weight_missing"]
    await api.commit(started["session_id"])
    items[0] = items[0].model_copy(update={"points": 99})
    assert (await api.call("GET", f"/courses/{course}/lms/updates?refresh=true"))["count"] == 0


async def test_a_refused_resource_leaves_the_connection_alone(
    api: Api, fake: FakeProvider, monkeypatch: pytest.MonkeyPatch
):
    program_id, term_id, conn = await setup_program(api)
    course = await api.course(program_id, term_id)
    await api.link(course, "101")

    async def refused(*_: Any) -> Any:
        raise lms_error("lms.forbidden")  # e.g. Pages turned off in this course

    monkeypatch.setattr(type(fake), "pages", refused)
    err = await api.call("GET", f"/courses/{course}/lms/pages", 409)
    assert err["error"] == {
        "code": "lms.area_hidden", "params": {"area": "pages"}, "request_id": ANY
    }
    [row] = (await api.call("GET", "/lms/connections"))["items"]
    assert (row["id"], row["status"], row["last_error_code"]) == (conn, "connected", None)


async def test_assignment_groups_with_the_same_name_stay_apart(api: Api, fake: FakeProvider):
    program_id, term_id, _ = await setup_program(api)
    course = await api.course(program_id, term_id)
    await api.link(course, "101")
    items = fake.course_assignments["101"]
    items[2] = items[2].model_copy(update={"group_name": "Labs"})  # g2, also called "Labs"
    started = await api.call(
        "POST", f"/courses/{course}/lms/imports:assignments",
        json={"external_ids": ["a1", "a2", "a3"]},
    )  # fmt: skip
    session = await api.call("GET", f"/imports/{started['session_id']}")
    categories = by_type(session, "category")
    assert [(c["data"]["name"], c["data"]["weight_total"]) for c in categories] == [
        ("Labs", 20),
        ("Labs", 80),
    ]
    assert len({c["data"]["key"] for c in categories}) == 2
    refs = [a["data"]["category_ref"] for a in by_type(session, "assessment")]
    assert refs[0] == refs[1] != refs[2]


async def test_assistant_cards_name_the_lms_side(api: Api, app: FastAPI, fake: FakeProvider):
    # The confirmation cards (M12 §3.5) say which LMS course, assignments and connection, by
    # name, from the cached reads only; never an external id, never a call to the LMS.
    from semestra.core.capability import registry
    from semestra.modules.agent.display import make_preview

    program_id, term_id, conn = await setup_program(api)
    course_id = await api.course(program_id, term_id)
    connection = await api.call("GET", f"/programs/{program_id}/lms-binding")
    me = await api.call("GET", "/account/me")

    async def card(name: str, args: dict[str, Any]) -> dict[str, Any]:
        async with system_ctx(app.state, me["id"]) as ctx:
            ctx.actor = "agent"
            return await make_preview(ctx, registry.get(name), args)

    # Nothing read yet: the cards count, without asking the LMS.
    fake.calls.clear()
    imported = await card(
        "lms.course.import",
        {"program_id": program_id, "external_course_ids": ["101", "90"], "term_id": term_id},
    )
    assert imported["changes"] == [{"field": "lms_courses", "after": 2}]
    assert fake.calls == []

    await api.call("GET", f"/programs/{program_id}/lms/courses?include_past=true")
    linked = await card(
        "lms.course.link.set", {"course_id": course_id, "external_course_id": "101"}
    )
    assert linked["changes"][0] == {
        "field": "lms_course",
        "after": "APS105H1 S LEC0101 · Computer Fundamentals · Winter 2026",
    }
    assert {"field": "connection", "after": connection["connection"]["display_name"]} in linked[
        "changes"
    ]
    imported = await card(
        "lms.course.import",
        {"program_id": program_id, "external_course_ids": ["101", "90"], "term_id": term_id},
    )
    [courses] = imported["changes"]
    assert courses["field"] == "lms_courses"
    assert courses["count"] == 2
    assert courses["after"][1] == "OLD100 · Old course · Fall 2025"  # a past course too
    assert "'101'" not in str(imported)

    link = (await api.link(course_id, "101"))["link"]
    # A course already in the Program is skipped by the import, so the card leaves it out.
    imported = await card(
        "lms.course.import",
        {"program_id": program_id, "external_course_ids": ["101", "90"], "term_id": term_id},
    )
    assert imported["changes"] == [
        {"field": "lms_courses", "after": ["OLD100 · Old course · Fall 2025"], "count": 1}
    ]

    async with system_ctx(app.state) as ctx:
        ctx.db.add(
            LmsImportedRef(user_id=me["id"], link_id=link["id"], external_kind="assignment",
                           external_id="a3", target_kind="assessment", target_id="x",
                           snapshot={}, imported_at=datetime(2026, 1, 15, tzinfo=UTC))
        )  # fmt: skip
        await ctx.db.commit()
    args = {"course_id": course_id, "external_ids": ["a1", "a3", "a2"]}
    fake.calls.clear()
    # Not read yet: how many are new (a3 was imported before).
    assert (await card("lms.assignment.import", args))["changes"][0] == {
        "field": "lms_assignments",
        "after": 2,
    }
    assert fake.calls == []
    await api.call("GET", f"/courses/{course_id}/lms/assignments")
    assignments = await card("lms.assignment.import", args)
    assert assignments["changes"][0] == {
        "field": "lms_assignments",
        "after": ["Lab 1", "Lab 2"],
        "count": 2,
    }
    assert assignments["target"] == "APS105H1 Computer Fundamentals"
    unlinked = await card("lms.course.link.delete", {"course_id": course_id})
    assert unlinked["changes"] == [
        {
            "field": "lms_course",
            "before": "APS105H1 S LEC0101 · Computer Fundamentals · Winter 2026",
            "after": None,
        }
    ]
    saved = await card("lms.file.save_to_course", {"course_id": course_id, "file_id": "f9"})
    assert saved["changes"] == [{"field": "folder", "after": None}]
    await api.call("GET", f"/courses/{course_id}/lms/files/f9")
    saved = await card("lms.file.save_to_course", {"course_id": course_id, "file_id": "f9"})
    assert saved["changes"] == [
        {"field": "lms_file", "after": "notes.txt"},
        {"field": "folder", "after": None},
    ]
    cleared = await card("lms.program.binding.clear", {"program_id": program_id})
    assert cleared["changes"][0]["before"] == connection["connection"]["display_name"]
    assert conn not in str(cleared)


async def test_handed_in_assignments_finish_their_to_dos_once(
    api: Api, fake: FakeProvider, app: FastAPI
):
    from semestra.core.jobs import run_periodic
    from semestra.modules.lms.schemas.dto import Submission

    program_id, term_id, _ = await setup_program(api)
    course = await api.course(program_id, term_id)
    await api.link(course, "101")
    # Worth no points: imported as a to-do of its own.
    midterm = fake.course_assignments["101"][2]
    fake.course_assignments["101"][2] = midterm.model_copy(update={"points": 0})
    started = await api.call(
        "POST", f"/courses/{course}/lms/imports:assignments",
        json={"external_ids": ["a1", "a2", "a3"]},
    )  # fmt: skip
    assert started["committed"]
    assert started["failed"] == 0

    async def open_titles() -> list[str]:
        page = await api.call("GET", f"/programs/{program_id}/tasks")
        return sorted(t["title"] for t in page["items"])

    assert await open_titles() == ["APS105H1 · Lab 1", "APS105H1 · Lab 2", "Midterm"]

    def hand_in(*ids: str) -> None:
        for i, a in enumerate(fake.course_assignments["101"]):
            if a.external_id in ids:
                when = datetime(2026, 2, 1, tzinfo=UTC)
                fake.course_assignments["101"][i] = a.model_copy(
                    update={"submission": Submission(state="submitted", submitted_at=when)}
                )

    # Handed in: the assessment's to-do and the imported task are finished on the next read.
    hand_in("a1", "a3")
    await api.call("GET", f"/courses/{course}/lms/assignments?refresh=true")
    assert await open_titles() == ["APS105H1 · Lab 2"]

    # Opened again by hand, a to-do stays open: each assignment counts once.
    done = await api.call(
        "GET", f"/programs/{program_id}/tasks", params={"completed": "only"}
    )  # fmt: skip
    lab1 = next(t for t in done["items"] if t["title"] == "APS105H1 · Lab 1")
    await api.call("POST", f"/tasks/{lab1['id']}:complete", json={"completed": False})
    await api.call("GET", f"/courses/{course}/lms/assignments?refresh=true")
    assert await open_titles() == ["APS105H1 · Lab 1", "APS105H1 · Lab 2"]

    # Turned off, nothing happens (and nothing is recorded) ...
    await api.call("PATCH", "/me/settings/lms", json={"values": {"complete_submitted": False}})
    hand_in("a2")
    await api.call("GET", f"/courses/{course}/lms/assignments?refresh=true")
    await run_periodic(app.state, "lms.complete_submitted")
    assert await open_titles() == ["APS105H1 · Lab 1", "APS105H1 · Lab 2"]
    # ... and turned on again, the hourly round catches up without anyone opening the course.
    await api.call("PATCH", "/me/settings/lms", json={"values": {"complete_submitted": True}})
    await run_periodic(app.state, "lms.complete_submitted")
    assert await open_titles() == ["APS105H1 · Lab 1"]


async def test_an_assignment_handed_in_before_its_import_has_its_to_do_finished(
    api: Api, fake: FakeProvider
):
    from semestra.modules.lms.schemas.dto import Submission

    program_id, term_id, _ = await setup_program(api)
    course = await api.course(program_id, term_id)
    await api.link(course, "101")
    lab1 = fake.course_assignments["101"][0]
    when = datetime(2026, 2, 1, tzinfo=UTC)
    fake.course_assignments["101"][0] = lab1.model_copy(
        update={"submission": Submission(state="submitted", submitted_at=when)}
    )
    started = await api.call(
        "POST", f"/courses/{course}/lms/imports:assignments", json={"external_ids": ["a1"]}
    )
    assert started["committed"]
    # The assessment's to-do exists by the commit, so the read's hand-in check finds it.
    page = await api.call("GET", f"/programs/{program_id}/tasks", params={"completed": "only"})
    assert [t["title"] for t in page["items"]] == ["APS105H1 · Lab 1"]


async def test_a_terms_new_assignments_come_from_the_cache(api: Api):
    program_id, term_id, _ = await setup_program(api)
    course = await api.course(program_id, term_id)
    await api.link(course, "101")
    path = f"/terms/{term_id}/lms/new-assignments"
    # Not read yet: the page reads that course itself instead of waiting here.
    assert await api.call("GET", path) == {"items": [], "total": 0, "unread": [course]}
    listed = await api.call("GET", f"/courses/{course}/lms/assignments")
    found = await api.call("GET", path)
    assert found["unread"] == []
    assert [(i["course_id"], i["external_ids"]) for i in found["items"]] == [
        (course, listed["new_ids"])
    ]


async def test_importing_again_resumes_the_import_waiting_for_review(api: Api):
    program_id, term_id, _ = await setup_program(api)
    course = await api.course(program_id, term_id)
    await api.link(course, "101")
    await api.call("POST", f"/courses/{course}/assessments", json={"title": "Lab 1", "weight": 5})
    path = f"/courses/{course}/lms/imports:assignments"
    first = await api.call("POST", path, json={"external_ids": ["a1"]})
    assert not first["committed"]
    # Closed and imported again: the same review, with only what is new added to it.
    again = await api.call("POST", path, json={"external_ids": ["a1"]})
    assert (again["session_id"], again["count"]) == (first["session_id"], 0)
    more = await api.call("POST", path, json={"external_ids": ["a1", "a2"]})
    assert more["session_id"] == first["session_id"]
    session = await api.call("GET", f"/imports/{first['session_id']}")
    assert [i["data"]["title"] for i in by_type(session, "assessment")] == ["Lab 1", "Lab 2"]
    (labs,) = by_type(session, "category")
    assert {i["data"]["category_ref"] for i in by_type(session, "assessment")} == {
        f"item:{labs['id']}"
    }
    await api.commit(first["session_id"])
    book = await api.call("GET", f"/courses/{course}/assessments")
    # The duplicate was left out; Lab 2 joined the course's Labs category.
    assert sorted(a["title"] for a in book["items"]) == ["Lab 1", "Lab 2"]


async def held_for_review(
    api: Api, path: str, external_ids: list[str], *, switch_to_task: bool = False
) -> dict[str, Any]:
    """Starts an assignment import that waits for review (as one with an open issue would), to
    act on it before its commit."""
    from semestra.modules.imports import service as imports_service

    async def held(*_: Any) -> None:
        return None

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(imports_service, "commit_if_clean", held)
        started = await api.call("POST", path, json={"external_ids": external_ids})
    assert not started["committed"]
    if switch_to_task:
        session = await api.call("GET", f"/imports/{started['session_id']}")
        for item in by_type(session, "assessment"):
            await api.call(
                "PATCH", f"/imports/{session['id']}/items/{item['id']}", json={"type": "task"}
            )
    return started


async def test_one_import_puts_each_assignment_in_one_place(api: Api, fake: FakeProvider):
    """Worth points: an assessment with its to-do. Worth none: a to-do, which "Add to gradebook"
    turns into an assessment that keeps the to-do (M09 §4)."""
    from semestra.modules.lms.schemas.dto import Assignment

    program_id, term_id, _ = await setup_program(api)
    course = await api.course(program_id, term_id)
    await api.link(course, "101")
    fake.course_assignments["101"].append(
        Assignment(external_id="a4", name="Reading 9", points=0,
                   due_at=datetime(2026, 3, 6, 4, 59, tzinfo=UTC))
    )  # fmt: skip
    started = await api.call(
        "POST", f"/courses/{course}/lms/imports:assignments", json={"external_ids": ["a3", "a4"]}
    )
    assert started["committed"]

    async def state() -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
        listed = await api.call("GET", f"/courses/{course}/lms/assignments")
        book = await api.call("GET", f"/courses/{course}/assessments")
        tasks = await api.call("GET", f"/programs/{program_id}/tasks")
        imported = {a["external_id"]: a["imported_as"] for a in listed["items"]}
        return imported, book["items"], tasks["items"]

    imported, book, tasks = await state()
    assert imported["a3"]["kind"] == "assessment"
    assert imported["a4"]["kind"] == "task"
    assert [a["title"] for a in book] == ["Midterm"]
    by_title = {t["title"]: t for t in tasks}
    assert by_title["APS105H1 · Midterm"]["assessment_id"] == book[0]["id"]
    reading = by_title["Reading 9"]
    assert reading["assessment_id"] is None
    assert reading["id"] == imported["a4"]["id"]
    # New: not imported and due later. Imported ones are no longer new.
    listed = await api.call("GET", f"/courses/{course}/lms/assignments")
    assert listed["new_ids"] == ["a1", "a2"]

    # Only an assignment imported as a to-do can be added to the gradebook.
    err = await api.call(
        "POST", f"/courses/{course}/lms/imports:gradebook", 422, json={"external_ids": ["a3"]}
    )
    assert err["error"]["code"] == "import.no_content"
    added = await api.call(
        "POST", f"/courses/{course}/lms/imports:gradebook", json={"external_ids": ["a4"]}
    )
    # Worth no points, so no weight to take: the review asks for one.
    assert not added["committed"]
    session = await api.call("GET", f"/imports/{added['session_id']}")
    (item,) = by_type(session, "assessment")
    await api.call(
        "PATCH", f"/imports/{session['id']}/items/{item['id']}", json={"data": {"weight": 5}}
    )
    await api.commit(added["session_id"])
    imported, book, tasks = await state()
    reading_assessment = next(a for a in book if a["title"] == "Reading 9")
    # The same to-do, now the assessment's; the record points at the assessment.
    assert imported["a4"] == {"kind": "assessment", "id": reading_assessment["id"]}
    kept = next(t for t in tasks if t["id"] == reading["id"])
    assert kept["assessment_id"] == reading_assessment["id"]
    assert len(tasks) == 2


async def test_an_undated_to_do_added_to_the_gradebook_goes(api: Api, fake: FakeProvider):
    """An assessment without a due date has no to-do, so the one it takes over is removed and
    nothing is left that the import record no longer points at."""
    from semestra.modules.lms.schemas.dto import Assignment

    program_id, term_id, _ = await setup_program(api)
    course = await api.course(program_id, term_id)
    await api.link(course, "101")
    fake.course_assignments["101"].append(Assignment(external_id="a5", name="Reading", points=0))
    path = f"/courses/{course}/lms/imports"
    assert (await api.call("POST", f"{path}:assignments", json={"external_ids": ["a5"]}))[
        "committed"
    ]
    added = await api.call("POST", f"{path}:gradebook", json={"external_ids": ["a5"]})
    session = await api.call("GET", f"/imports/{added['session_id']}")
    (item,) = by_type(session, "assessment")
    await api.call(
        "PATCH", f"/imports/{session['id']}/items/{item['id']}", json={"data": {"weight": 5}}
    )
    await api.commit(added["session_id"])
    assert (await api.call("GET", f"/programs/{program_id}/tasks"))["items"] == []
    book = await api.call("GET", f"/courses/{course}/assessments")
    assert [a["title"] for a in book["items"]] == ["Reading"]


async def test_part_of_a_group_is_saved_with_its_category_total_shown(api: Api):
    """Canvas splits a group's weight over all its assignments; importing one of them leaves
    the category short, which the review shows without holding the import back."""
    program_id, term_id, _ = await setup_program(api)
    course = await api.course(program_id, term_id)
    await api.link(course, "101")
    started = await api.call(
        "POST", f"/courses/{course}/lms/imports:assignments", json={"external_ids": ["a1"]}
    )
    assert started["committed"]
    session = await api.call("GET", f"/imports/{started['session_id']}")
    (category,) = by_type(session, "category")
    assert session["summary"]["category_weights"] == [
        {"item_id": category["id"], "expected": 20.0, "total": 5.0, "ok": False}
    ]


async def test_an_import_that_needs_a_decision_waits_for_review(api: Api):
    """A gradebook entry of the same name is a decision for the user: the import is not saved,
    and an item can be switched between assessment and to-do in the review."""
    program_id, term_id, _ = await setup_program(api)
    course = await api.course(program_id, term_id)
    await api.link(course, "101")
    await api.call(
        "POST", f"/courses/{course}/assessments", json={"title": "Midterm", "weight": 30}
    )
    started = await api.call(
        "POST", f"/courses/{course}/lms/imports:assignments", json={"external_ids": ["a3"]}
    )
    assert not started["committed"]
    session = await api.call("GET", f"/imports/{started['session_id']}")
    assert session["status"] == "ready"
    (item,) = by_type(session, "assessment")
    assert [i["code"] for i in item["issues"]] == ["import.duplicate_assessment"]
    # Left out by default, so it adds nothing to the course's weight total.
    assert item["decision"] == "reject"
    assert session["summary"]["weights"] == []
    ticked = await api.call(
        "PATCH", f"/imports/{session['id']}/items/{item['id']}", json={"decision": "accept"}
    )
    # Ticked, the total counts what the gradebook has: 30 + 80.
    assert ticked["summary"]["weights"] == [
        {"course_ref": f"course:{course}", "total": 110.0, "existing": 1, "ok": False}
    ]
    switched = await api.call(
        "PATCH", f"/imports/{session['id']}/items/{item['id']}", json={"type": "task"}
    )
    task = next(i for i in switched["items"] if i["id"] == item["id"])
    assert (task["type"], task["data"]["title"]) == ("task", "Midterm")
    back = await api.call(
        "PATCH", f"/imports/{session['id']}/items/{item['id']}", json={"type": "assessment"}
    )
    restored = next(i for i in back["items"] if i["id"] == item["id"])
    # The weight and category come back with it.
    assert (restored["data"]["weight"], restored["data"]["category_ref"]) == (
        item["data"]["weight"], item["data"]["category_ref"]
    )  # fmt: skip
