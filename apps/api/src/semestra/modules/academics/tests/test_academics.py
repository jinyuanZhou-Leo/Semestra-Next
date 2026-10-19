"""Programs, terms and courses over HTTP and the agent surface (M02 §8)."""

from collections.abc import Awaitable, Callable
from datetime import date
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import AsyncClient

from semestra.core.capability import registry
from semestra.core.context import Ctx, system_ctx
from semestra.core.errors import AppError
from semestra.core.events import Event, events
from semestra.modules.academics import service
from semestra.modules.academics.schemas import CourseCandidates
from semestra.modules.academics.scopes import resolve_scope
from semestra.modules.settings import ScopeChain
from semestra.testing import MakeUser, UserHandle, collect_events

LoginAs = Callable[[AsyncClient, UserHandle], Awaitable[str]]


class Api:
    """Small helpers over the HTTP API, asserting success unless told otherwise."""

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

    async def term(self, program_id: str, name: str, start: str, end: str, **body: Any) -> Any:
        result = await self.call(
            "POST",
            f"/programs/{program_id}/terms",
            json={"name": name, "start_date": start, "end_date": end, **body},
        )
        return result["term"]

    async def course(self, program_id: str, term_ids: list[str], **body: Any) -> Any:
        return await self.call(
            "POST",
            f"/programs/{program_id}/courses",
            json={"title": "Course", "term_ids": term_ids, **body},
        )


@pytest.fixture
async def api(client: AsyncClient, make_user: MakeUser, login_as: LoginAs) -> Api:
    user = await make_user()
    await login_as(client, user)
    return Api(client)


FALL = ("Fall 2025", "2025-09-04", "2025-12-20")
WINTER = ("Winter 2026", "2026-01-06", "2026-04-30")
SUMMER = ("Summer 2026", "2026-05-11", "2026-08-14")


async def setup_year(api: Api) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    program = await api.program()
    fall = await api.term(program["id"], *FALL)
    winter = await api.term(program["id"], *WINTER)
    return program, fall, winter


async def test_program_crud_counts_and_defaults(api: Api):
    program = await api.program(institution="UofT", default_course_credits=0.5)
    assert program["subject_colors"] == {}
    assert (program["term_count"], program["course_count"]) == (0, 0)
    term = await api.term(program["id"], *FALL)
    await api.course(program["id"], [term["id"]], code="APS105H1")
    listed = await api.call("GET", "/programs")
    assert [(p["name"], p["term_count"], p["course_count"]) for p in listed["items"]] == [
        ("BASc", 1, 1)
    ]
    updated = await api.call(
        "PATCH", f"/programs/{program['id']}", json={"institution": None, "name": "MEng"}
    )
    assert (updated["institution"], updated["name"]) == (None, "MEng")
    await api.call("PATCH", f"/programs/{program['id']}", 422, json={"name": None})
    await api.call("POST", "/programs", 422, json={"name": "X", "timezone": "Mars/Base"})


async def test_program_created_event_carries_setup_choices(api: Api, app: FastAPI):
    seen: list[dict[str, Any]] = []

    @events.subscribe("academics.program.created")
    async def _grab(ctx: Ctx, event: Event) -> None:  # pyright: ignore[reportUnusedFunction]
        seen.append(event.data)

    try:
        program = await api.program(setup={"grading.scale_preset": "us_4_0"})
    finally:
        events._subscribers["academics.program.created"].remove(_grab)  # pyright: ignore[reportPrivateUsage]
    assert seen == [{"program_id": program["id"], "setup": {"grading.scale_preset": "us_4_0"}}]


async def test_subject_colors_are_assigned_once_and_stay(api: Api):
    program, fall, _ = await setup_year(api)
    aps = await api.course(program["id"], [fall["id"]], code="aps105h1")
    mat = await api.course(program["id"], [fall["id"]], code="MAT187")
    aps2 = await api.course(program["id"], [fall["id"]], code="APS110")
    assert aps["subject_code"] == "APS"
    assert (aps["resolved_color"], mat["resolved_color"]) == ("subject-1", "subject-2")
    assert aps2["resolved_color"] == "subject-1"
    # Deleting courses never changes a subject's color.
    await api.call("DELETE", f"/courses/{aps['id']}")
    await api.call("DELETE", f"/courses/{aps2['id']}")
    csc = await api.course(program["id"], [fall["id"]], code="CSC148")
    assert csc["resolved_color"] == "subject-3"
    got = await api.call("GET", f"/programs/{program['id']}")
    assert got["subject_colors"]["APS"] == {"palette": 1}

    # The user's choice for a subject, and a course's own color, win.
    await api.call(
        "PUT",
        f"/programs/{program['id']}/subject-colors/MAT",
        json={"color": {"hex": "#112233"}},
    )
    assert (await api.call("GET", f"/courses/{mat['id']}"))["resolved_color"] == "#112233"
    own = await api.call(
        "PATCH", f"/courses/{mat['id']}", json={"color": {"palette": 9}, "credits": 0.25}
    )
    assert (own["resolved_color"], own["credits"]) == ("subject-9", 0.25)
    # The subject's color stays known for "use the subject color".
    assert own["subject_color"] == "#112233"
    back = await api.call("PATCH", f"/courses/{mat['id']}", json={"color": None})
    assert back["resolved_color"] == "#112233"


async def test_course_defaults_and_subject_follows_code(api: Api):
    program, fall, _ = await setup_year(api)
    course = await api.course(program["id"], [fall["id"]], code="ECE 241", title="Digital Systems")
    assert (course["credits"], course["include_in_gpa"], course["subject_code"]) == (
        0.5,
        True,
        "ECE",
    )
    renamed = await api.call("PATCH", f"/courses/{course['id']}", json={"code": "CSC 258"})
    assert renamed["subject_code"] == "CSC"
    manual = await api.call("PATCH", f"/courses/{course['id']}", json={"subject_code": "eng"})
    assert manual["subject_code"] == "ENG"
    kept = await api.call("PATCH", f"/courses/{course['id']}", json={"code": "MAT 101"})
    assert kept["subject_code"] == "ENG"  # set by hand: no longer follows the code


async def test_terms_are_sorted_and_current(api: Api):
    program = await api.program()
    winter = await api.term(program["id"], *WINTER)
    fall = await api.term(program["id"], *FALL)
    terms = (await api.call("GET", f"/programs/{program['id']}/terms"))["items"]
    assert [t["id"] for t in terms] == [fall["id"], winter["id"]]
    assert [t["is_current"] for t in terms] == [False, True]  # the test clock is 2026-01-15


async def test_term_validation(api: Api):
    program = await api.program()
    base = f"/programs/{program['id']}/terms"
    bad = {"name": "X", "start_date": "2026-05-01", "end_date": "2026-04-01"}
    r = await api.call("POST", base, 422, json=bad)
    assert r["error"]["code"] == "academics.term_date_range_invalid"
    out = {
        "name": "X",
        "start_date": "2026-01-05",
        "end_date": "2026-04-30",
        "breaks": [{"name": "RW", "start_date": "2026-05-01", "end_date": "2026-05-05"}],
    }
    assert (await api.call("POST", base, 422, json=out))["error"][
        "code"
    ] == "academics.break_out_of_range"
    overlap = {
        **out,
        "breaks": [
            {"name": "A", "start_date": "2026-02-16", "end_date": "2026-02-20"},
            {"name": "B", "start_date": "2026-02-20", "end_date": "2026-02-22"},
        ],
    }
    assert (await api.call("POST", base, 422, json=overlap))["error"][
        "code"
    ] == "academics.breaks_overlap"


async def test_year_long_course_appears_in_both_terms(api: Api):
    program, fall, winter = await setup_year(api)
    course = await api.course(program["id"], [winter["id"], fall["id"]], code="MAT 137Y1")
    assert course["term_ids"] == [fall["id"], winter["id"]]
    assert course["end_term_id"] == winter["id"]
    for term in (fall, winter):
        listed = await api.call(
            "GET", f"/programs/{program['id']}/courses", params={"term_id": term["id"]}
        )
        assert [c["id"] for c in listed["items"]] == [course["id"]]
    # Counted once in the Program.
    assert (await api.call("GET", f"/programs/{program['id']}"))["course_count"] == 1


async def test_course_terms_rules(api: Api):
    program, fall, winter = await setup_year(api)
    summer = await api.term(program["id"], *SUMMER)
    url = f"/programs/{program['id']}/courses"
    r = await api.call("POST", url, 422, json={"title": "X", "term_ids": []})
    assert r["error"]["code"] == "academics.course_requires_term"
    r = await api.call(
        "POST", url, 422, json={"title": "X", "term_ids": [fall["id"], summer["id"]]}
    )
    assert r["error"]["code"] == "academics.course_terms_not_adjacent"
    other = await api.program(name="Minor")
    other_term = await api.term(other["id"], *FALL)
    r = await api.call("POST", url, 422, json={"title": "X", "term_ids": [other_term["id"]]})
    assert r["error"]["code"] == "academics.course_terms_cross_program"

    course = await api.course(program["id"], [fall["id"]])
    moved = await api.call(
        "PUT", f"/courses/{course['id']}/terms", json={"term_ids": [fall["id"], winter["id"]]}
    )
    assert moved["term_ids"] == [fall["id"], winter["id"]]
    assert moved["planned_terms"] == 2


async def test_inserting_a_term_between_year_long_terms_is_refused(api: Api):
    program = await api.program()
    fall = await api.term(program["id"], *FALL)
    summer = await api.term(program["id"], *SUMMER)
    course = await api.course(program["id"], [fall["id"], summer["id"]])
    r = await api.call(
        "POST",
        f"/programs/{program['id']}/terms",
        422,
        json={"name": WINTER[0], "start_date": WINTER[1], "end_date": WINTER[2]},
    )
    assert r["error"] == {
        "code": "academics.course_terms_not_adjacent",
        "params": {"course_ids": [course["id"]]},
        "request_id": r["error"]["request_id"],
    }
    # Nothing was created.
    assert len((await api.call("GET", f"/programs/{program['id']}/terms"))["items"]) == 2

    # Moving a term's dates in between is refused the same way.
    third = await api.term(program["id"], "Next", "2026-09-01", "2026-12-20")
    r = await api.call(
        "PATCH",
        f"/terms/{third['id']}",
        422,
        json={"start_date": WINTER[1], "end_date": WINTER[2]},
    )
    assert r["error"]["code"] == "academics.course_terms_not_adjacent"


async def test_deleting_a_term_keeps_year_long_courses(api: Api, app: FastAPI):
    program, fall, winter = await setup_year(api)
    year = await api.course(program["id"], [fall["id"], winter["id"]], code="MAT137Y1")
    only = await api.course(program["id"], [fall["id"]], code="APS105")
    preview = await api.call("GET", f"/terms/{fall['id']}/delete-preview")
    assert preview == {
        "deleted_course_count": 1,
        "kept_course_count": 1,
        "deleted_course_ids": [only["id"]],
        "kept_course_ids": [year["id"]],
    }
    deleting: list[str] = []

    @events.subscribe("academics.course.deleting", in_transaction=True)
    async def _grab(ctx: Ctx, event: Event) -> None:  # pyright: ignore[reportUnusedFunction]
        deleting.append(event.data["course_id"])

    try:
        user_id = (await api.call("GET", "/account/me"))["id"]
        with collect_events(app, user_id) as pushed:
            result = await api.call("DELETE", f"/terms/{fall['id']}")
    finally:
        events._in_transaction["academics.course.deleting"].remove(_grab)  # pyright: ignore[reportPrivateUsage]
    assert result == {"deleted_course_count": 1, "kept_course_count": 1}
    assert deleting == [only["id"]]
    types = [(m["type"], m["data"].get("course_id") or m["data"].get("term_id")) for m in pushed]
    assert ("academics.course.deleted", only["id"]) in types
    assert ("academics.course.terms_changed", year["id"]) in types
    assert ("academics.term.deleted", fall["id"]) in types
    kept = await api.call("GET", f"/courses/{year['id']}")
    assert kept["term_ids"] == [winter["id"]]
    await api.call("GET", f"/courses/{only['id']}", 404)


async def test_deleting_a_program_announces_every_term_and_course(api: Api, app: FastAPI):
    program, fall, winter = await setup_year(api)
    course = await api.course(program["id"], [fall["id"], winter["id"]])
    in_tx: list[str] = []

    async def _grab(ctx: Ctx, event: Event) -> None:
        in_tx.append(event.type)

    for kind in ("course", "term", "program"):
        events.subscribe(f"academics.{kind}.deleting", in_transaction=True)(_grab)
    try:
        user_id = (await api.call("GET", "/account/me"))["id"]
        with collect_events(app, user_id) as pushed:
            await api.call("DELETE", f"/programs/{program['id']}")
    finally:
        for kind in ("course", "term", "program"):
            events._in_transaction[f"academics.{kind}.deleting"].remove(_grab)  # pyright: ignore[reportPrivateUsage]
    assert in_tx == [
        "academics.course.deleting",
        "academics.term.deleting",
        "academics.term.deleting",
        "academics.program.deleting",
    ]
    deleted = sorted((m["type"], next(iter(m["data"].values()))) for m in pushed)
    assert deleted == sorted(
        [
            ("academics.course.deleted", course["id"]),
            ("academics.term.deleted", fall["id"]),
            ("academics.term.deleted", winter["id"]),
            ("academics.program.deleted", program["id"]),
        ]
    )
    assert (await api.call("GET", "/programs"))["items"] == []


async def test_a_failing_cleanup_rolls_the_deletion_back(api: Api):
    program, fall, _ = await setup_year(api)
    course = await api.course(program["id"], [fall["id"]])

    @events.subscribe("academics.course.deleting", in_transaction=True)
    async def _fail(ctx: Ctx, event: Event) -> None:  # pyright: ignore[reportUnusedFunction]
        raise RuntimeError("cleanup failed")

    try:
        with pytest.raises(RuntimeError):
            await api.client.delete(f"/courses/{course['id']}")
    finally:
        events._in_transaction["academics.course.deleting"].remove(_fail)  # pyright: ignore[reportPrivateUsage]
    await api.call("GET", f"/courses/{course['id']}")


async def test_calendar_info_numbers_weeks(api: Api):
    program = await api.program()
    term = await api.term(
        program["id"],
        "Winter",
        "2026-01-05",
        "2026-02-27",
        breaks=[{"name": "Reading week", "start_date": "2026-02-16", "end_date": "2026-02-20"}],
    )
    info = await api.call("GET", f"/terms/{term['id']}/calendar-info")
    assert info["week_start"] == 7  # English and no preference: Sunday
    await api.call("PATCH", "/me/preferences", json={"week_start": 1})
    info = await api.call("GET", f"/terms/{term['id']}/calendar-info")
    assert info["week_start"] == 1
    assert [w["number"] for w in info["weeks"]] == [1, 2, 3, 4, 5, 6, None, 7]
    assert info["weeks"][6]["break_info"]["name"] == "Reading week"
    assert info["today"] == "2026-01-15"
    assert info["today_week"] == 1

    await api.call("PATCH", f"/terms/{term['id']}", json={"count_break_weeks": True})
    info = await api.call("GET", f"/terms/{term['id']}/calendar-info")
    assert [w["number"] for w in info["weeks"]][-2:] == [7, 8]


async def test_course_list_filters_search_order_and_paging(api: Api):
    program, fall, _ = await setup_year(api)
    a = await api.course(
        program["id"], [fall["id"]], code="APS105H1", title="Computer Fundamentals"
    )
    b = await api.course(
        program["id"], [fall["id"]], code="MAT186", title="Calculus I", alias="Calc"
    )
    c = await api.course(program["id"], [fall["id"]], code="APS111", title="Engineering Strategies")
    url = f"/programs/{program['id']}/courses"
    names = lambda r: [i["code"] for i in r["items"]]  # noqa: E731
    assert names(await api.call("GET", url, params={"search": "aps 1"})) == ["APS105H1", "APS111"]
    assert names(await api.call("GET", url, params={"search": "calc"})) == ["MAT186"]
    assert names(await api.call("GET", url, params={"subject_code": "mat"})) == ["MAT186"]
    page = await api.call("GET", url, params={"limit": 2})
    assert (names(page), page["next_cursor"]) == (["APS105H1", "APS111"], "2")
    rest = await api.call("GET", url, params={"limit": 2, "cursor": page["next_cursor"]})
    assert (names(rest), rest["next_cursor"]) == (["MAT186"], None)

    order = await api.call(
        "PUT", f"/terms/{fall['id']}/course-order", json={"course_ids": [b["id"], c["id"]]}
    )
    assert order["course_ids"] == [b["id"], c["id"], a["id"]]
    in_term = await api.call("GET", url, params={"term_id": fall["id"]})
    assert [i["id"] for i in in_term["items"]] == [b["id"], c["id"], a["id"]]


async def test_agent_surface_find_and_field_selection(api: Api, app: FastAPI, make_user: MakeUser):
    program, fall, _ = await setup_year(api)
    await api.course(program["id"], [fall["id"]], code="APS105H1", title="Computer Fundamentals")
    await api.course(program["id"], [fall["id"]], code="MAT137", title="Calculus", alias="Calc")
    user_id = (await api.call("GET", "/account/me"))["id"]
    async with system_ctx(app.state, user_id) as ctx:
        found = await registry.invoke(ctx, "academics.course.find", {"query": "aps 105"}, "agent")
        assert isinstance(found, CourseCandidates)
        assert [c.code for c in found.items] == ["APS105H1"]
        nickname = await registry.invoke(ctx, "academics.course.find", {"query": "calc"}, "agent")
        assert isinstance(nickname, CourseCandidates)
        assert nickname.items[0].code == "MAT137"
        listed = await registry.invoke(
            ctx,
            "academics.course.list",
            {"program_id": program["id"], "fields": ["code"]},
            "agent",
        )
        assert isinstance(listed, dict)
        assert [set(i) for i in listed["items"]] == [{"id", "code"}, {"id", "code"}]
    # Not reachable over HTTP.
    assert "academics.course.find" not in {c.name for c in registry.list(expose="http")}


async def test_other_users_data_is_not_found(
    api: Api, client: AsyncClient, make_user: MakeUser, login_as: LoginAs
):
    program, fall, _ = await setup_year(api)
    course = await api.course(program["id"], [fall["id"]])
    intruder = await make_user(email="eve@example.com")
    await login_as(client, intruder)
    for method, url in [
        ("GET", f"/programs/{program['id']}"),
        ("PATCH", f"/programs/{program['id']}"),
        ("DELETE", f"/programs/{program['id']}"),
        ("GET", f"/programs/{program['id']}/terms"),
        ("GET", f"/programs/{program['id']}/courses"),
        ("GET", f"/terms/{fall['id']}"),
        ("GET", f"/terms/{fall['id']}/calendar-info"),
        ("GET", f"/terms/{fall['id']}/delete-preview"),
        ("DELETE", f"/terms/{fall['id']}"),
        ("GET", f"/courses/{course['id']}"),
        ("PATCH", f"/courses/{course['id']}"),
        ("DELETE", f"/courses/{course['id']}"),
    ]:
        r = await client.request(method, url, json={} if method == "PATCH" else None)
        assert (r.status_code, r.json()["error"]["code"]) == (404, "common.not_found"), url
    mine = await api.program()
    r = await client.post(
        f"/programs/{mine['id']}/courses", json={"title": "X", "term_ids": [fall["id"]]}
    )
    assert r.status_code == 404
    r = await client.put(f"/terms/{fall['id']}/course-order", json={"course_ids": []})
    assert r.status_code == 404


async def test_scope_resolver_for_settings(api: Api, app: FastAPI):
    """M11's scope chain: a course resolves to its Program and the term running today."""
    program, fall, winter = await setup_year(api)
    year = await api.course(program["id"], [fall["id"], winter["id"]])
    single = await api.course(program["id"], [fall["id"]])
    user_id = (await api.call("GET", "/account/me"))["id"]
    async with system_ctx(app.state, user_id) as ctx:
        assert await resolve_scope(ctx, "program", program["id"]) == ScopeChain(program["id"])
        assert await resolve_scope(ctx, "term", fall["id"]) == ScopeChain(program["id"], fall["id"])
        # The clock is in January: the year-long course is in its winter term.
        assert await resolve_scope(ctx, "course", year["id"]) == ScopeChain(
            program["id"], winter["id"], year["id"]
        )
        assert await resolve_scope(ctx, "course", single["id"]) == ScopeChain(
            program["id"], fall["id"], single["id"]
        )
        with pytest.raises(AppError):
            await resolve_scope(ctx, "course", "missing")
    async with system_ctx(app.state, None) as anonymous:
        anonymous.user = (await make_other(app)).user
        with pytest.raises(AppError):
            await resolve_scope(anonymous, "program", program["id"])


async def make_other(app: FastAPI) -> Ctx:
    from semestra.modules.auth.models import AuthUser

    async with app.state.session_factory() as db:
        other = AuthUser(email="other@example.com", display_name="Other")
        db.add(other)
        await db.commit()
    async with system_ctx(app.state, other.id) as ctx:
        return ctx


async def test_term_wizard_creates_courses_and_continues_year_long_ones(api: Api, app: FastAPI):
    program = await api.program()
    fall = await api.term(program["id"], *FALL)
    year = await api.course(program["id"], [fall["id"]], code="MAT137Y1", planned_terms=2)
    created: list[str] = []

    @events.subscribe("academics.course.created")
    async def _grab(ctx: Ctx, event: Event) -> None:  # pyright: ignore[reportUnusedFunction]
        created.append(event.data["course_id"])

    try:
        result = await api.call(
            "POST",
            f"/programs/{program['id']}/terms",
            json={
                "name": WINTER[0],
                "start_date": WINTER[1],
                "end_date": WINTER[2],
                "courses": [{"code": "ECE 244", "title": "Programming"}, {"title": "Seminar"}],
                "continue_course_ids": [year["id"]],
            },
        )
    finally:
        events._subscribers["academics.course.created"].remove(_grab)  # pyright: ignore[reportPrivateUsage]
    winter = result["term"]
    assert result["continued_course_ids"] == [year["id"]]
    assert created == result["course_ids"]
    assert len(created) == 2
    assert winter["course_count"] == 3
    assert (await api.call("GET", f"/courses/{year['id']}"))["term_ids"] == [
        fall["id"],
        winter["id"],
    ]

    # A course can only be continued from the term right before.
    fall_only = await api.course(program["id"], [fall["id"]], code="APS105")
    later = await api.call(
        "POST",
        f"/programs/{program['id']}/terms",
        422,
        json={
            "name": "Fall 2026",
            "start_date": "2026-09-08",
            "end_date": "2026-12-20",
            "continue_course_ids": [fall_only["id"]],
        },
    )
    assert later["error"]["code"] == "academics.course_terms_not_adjacent"


async def test_names_are_trimmed_and_credit_goals_may_exceed_course_credits(api: Api):
    r = await api.call("POST", "/programs", 422, json={"name": "   ", "timezone": "UTC"})
    assert r["error"]["code"] == "common.validation"
    program = await api.program(name="  BASc  ", credit_requirement=120)
    assert (program["name"], program["credit_requirement"]) == ("BASc", 120)
    term = await api.term(program["id"], *FALL)
    await api.call(
        "POST",
        f"/programs/{program['id']}/courses",
        422,
        json={"title": "  ", "term_ids": [term["id"]]},
    )


async def test_week_of_a_day_outside_the_term_is_none(api: Api, app: FastAPI):
    _, fall, _ = await setup_year(api)  # Fall starts on Thursday 2025-09-04
    user_id = (await api.call("GET", "/account/me"))["id"]
    async with system_ctx(app.state, user_id) as ctx:
        term = await service.get_term_row(ctx, fall["id"])
        assert await service.term_week_of(ctx, term, date(2025, 9, 2)) is None
        assert await service.term_week_of(ctx, term, date(2025, 9, 5)) == 1


async def test_course_websites_are_http_addresses(api: Api):
    program, fall, _ = await setup_year(api)
    course = await api.course(program["id"], [fall["id"]], website_url=" q.utoronto.ca/x ")
    assert course["website_url"] == "https://q.utoronto.ca/x"
    for bad in ("ftp://files.example.com", "data://text/html,hi", "https://"):
        await api.call("PATCH", f"/courses/{course['id']}", 422, json={"website_url": bad})
    cleared = await api.call("PATCH", f"/courses/{course['id']}", json={"website_url": None})
    assert cleared["website_url"] is None
