"""Lists, tasks, smart views, cleanup and tasks from assessments (M05 §8)."""

from collections.abc import Awaitable, Callable
from datetime import UTC, date, datetime, time
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import AsyncClient

from semestra.core.capability import registry
from semestra.core.context import Ctx, system_ctx
from semestra.core.errors import AppError
from semestra.modules.tasks import auto, service
from semestra.modules.tasks.auto import AssessmentInfo
from semestra.modules.tasks.schemas import TaskFindInput
from semestra.testing import Clock, MakeUser, UserHandle, collect_events

LoginAs = Callable[[AsyncClient, UserHandle], Awaitable[str]]


class Api:
    def __init__(self, client: AsyncClient) -> None:
        self.client = client

    async def call(self, method: str, url: str, status: int = 200, **kwargs: Any) -> Any:
        r = await self.client.request(method, url, **kwargs)
        assert r.status_code == status, r.text
        return r.json()

    async def setup(self) -> dict[str, Any]:
        """A Program with a fall, a winter and a summer term and three courses."""
        program = await self.call(
            "POST", "/programs", json={"name": "BASc", "timezone": "America/Toronto"}
        )
        pid = program["id"]
        terms = {}
        for key, name, start, end in (
            ("fall", "Fall 2025", "2025-09-04", "2025-12-20"),
            ("winter", "Winter 2026", "2026-01-06", "2026-04-30"),
        ):
            result = await self.call(
                "POST",
                f"/programs/{pid}/terms",
                json={"name": name, "start_date": start, "end_date": end},
            )
            terms[key] = result["term"]["id"]
        courses = {}
        for key, term_keys, code in (
            ("aps", ["winter"], "APS105H1"),
            ("year", ["fall", "winter"], "MAT137Y1"),
            ("fallonly", ["fall"], "CSC108H1"),
        ):
            course = await self.call(
                "POST",
                f"/programs/{pid}/courses",
                json={"title": code, "code": code, "term_ids": [terms[t] for t in term_keys]},
            )
            courses[key] = course["id"]
        return {"program": pid, "terms": terms, "courses": courses}

    async def task(self, pid: str, title: str = "Task", **body: Any) -> dict[str, Any]:
        return await self.call("POST", f"/programs/{pid}/tasks", json={"title": title, **body})

    async def titles(self, pid: str, **params: Any) -> list[str]:
        page = await self.call("GET", f"/programs/{pid}/tasks", params=params)
        return [t["title"] for t in page["items"]]


@pytest.fixture
async def user(client: AsyncClient, make_user: MakeUser, login_as: LoginAs) -> UserHandle:
    handle = await make_user()
    await login_as(client, handle)
    return handle


@pytest.fixture
async def api(client: AsyncClient, user: UserHandle) -> Api:
    del user
    return Api(client)


# --- lists ----------------------------------------------------------------------------------


async def test_list_crud_order_and_name_conflicts(api: Api):
    s = await api.setup()
    pid, winter = s["program"], s["terms"]["winter"]
    errands = await api.call("POST", f"/programs/{pid}/task-lists", json={"name": "Errands"})
    labs = await api.call(
        "POST", f"/programs/{pid}/task-lists", json={"name": "Labs", "term_id": winter}
    )
    assert (errands["position"], labs["position"]) == (0, 1)
    assert labs["term_id"] == winter

    conflict = await api.call(
        "POST", f"/programs/{pid}/task-lists", json={"name": " errands "}, status=409
    )
    assert conflict["error"]["code"] == "tasks.list_name_conflict"
    # The same name in a term is a different list.
    await api.call("POST", f"/programs/{pid}/task-lists", json={"name": "Errands", "term_id": winter})

    renamed = await api.call("PATCH", f"/task-lists/{labs['id']}", json={"name": "Lab work"})
    assert renamed["name"] == "Lab work"
    await api.call("PATCH", f"/task-lists/{errands['id']}", json={"name": "Lab work"}, status=200)
    await api.call(
        "PATCH", f"/task-lists/{errands['id']}", json={"name": "Labs", "term_id": winter}, status=200
    )

    order = await api.call(
        "PUT", f"/programs/{pid}/task-list-order", json={"list_ids": [labs["id"]]}
    )
    assert order["items"][0]["id"] == labs["id"]
    listed = await api.call("GET", f"/programs/{pid}/task-lists")
    assert [i["position"] for i in listed["items"]] == [0, 1, 2]


async def test_deleting_a_list_moves_or_deletes_its_tasks(api: Api):
    s = await api.setup()
    pid = s["program"]
    keep = await api.call("POST", f"/programs/{pid}/task-lists", json={"name": "Keep"})
    drop = await api.call("POST", f"/programs/{pid}/task-lists", json={"name": "Drop"})
    await api.task(pid, "a", list_id=keep["id"])
    await api.task(pid, "b", list_id=drop["id"])
    first = await api.call("DELETE", f"/task-lists/{keep['id']}")
    assert first == {"deleted_task_count": 0, "moved_task_count": 1}
    assert await api.titles(pid, view="inbox") == ["a"]
    second = await api.call("DELETE", f"/task-lists/{drop['id']}", params={"delete_tasks": True})
    assert second == {"deleted_task_count": 1, "moved_task_count": 0}
    assert await api.titles(pid, view="all") == ["a"]


# --- creating -------------------------------------------------------------------------------


async def test_term_follows_the_course_and_due_date_for_year_long_courses(api: Api):
    s = await api.setup()
    pid, courses, terms = s["program"], s["courses"], s["terms"]
    in_fall = await api.task(pid, course_id=courses["year"], due_date="2025-10-01")
    in_winter = await api.task(pid, course_id=courses["year"], due_date="2026-02-01")
    outside = await api.task(pid, course_id=courses["year"], due_date="2027-01-01")
    undated = await api.task(pid, course_id=courses["year"])  # the clock is in January 2026
    single = await api.task(pid, course_id=courses["fallonly"], due_date="2026-06-01")
    plain = await api.task(pid)
    assert in_fall["term_id"] == terms["fall"]
    assert in_winter["term_id"] == terms["winter"]
    assert outside["term_id"] == terms["winter"]  # outside every term: the running one
    assert undated["term_id"] == terms["winter"]
    assert single["term_id"] == terms["fall"]  # only term, even though the date is later
    assert plain["term_id"] is None

    moved = await api.call(
        "PATCH", f"/tasks/{in_winter['id']}", json={"due_date": "2025-11-01"}
    )
    assert moved["term_id"] == terms["fall"]  # changing the date re-infers the term
    pinned = await api.call(
        "PATCH",
        f"/tasks/{in_winter['id']}",
        json={"due_date": "2026-02-01", "term_id": terms["fall"]},
    )
    assert pinned["term_id"] == terms["fall"]


async def test_validation_errors(api: Api):
    s = await api.setup()
    pid = s["program"]
    other = await api.call(
        "POST", "/programs", json={"name": "Second", "timezone": "America/Toronto"}
    )
    foreign_course = await api.call(
        "POST",
        f"/programs/{other['id']}/terms",
        json={"name": "T", "start_date": "2026-01-01", "end_date": "2026-04-01"},
    )
    course = await api.call(
        "POST",
        f"/programs/{other['id']}/courses",
        json={"title": "X", "term_ids": [foreign_course["term"]["id"]]},
    )
    r = await api.call(
        "POST",
        f"/programs/{pid}/tasks",
        json={"title": "x", "course_id": course["id"]},
        status=422,
    )
    assert r["error"]["code"] == "tasks.course_not_in_program"
    r = await api.call(
        "POST", f"/programs/{pid}/tasks", json={"title": "x", "due_time": "09:00"}, status=422
    )
    assert r["error"]["code"] == "tasks.invalid_due"
    await api.call("POST", f"/programs/{pid}/tasks", json={"title": "  "}, status=422)
    created = await api.task(pid, "ok", due_date="2026-02-01", due_time="09:00:30")
    assert created["due_time"] == "09:00:00"
    cleared = await api.call("PATCH", f"/tasks/{created['id']}", json={"due_date": None})
    assert (cleared["due_date"], cleared["due_time"]) == (None, None)
    r = await api.call("PATCH", f"/tasks/{created['id']}", json={"due_time": "10:00"}, status=422)
    assert r["error"]["code"] == "tasks.invalid_due"
    r = await api.call("PATCH", f"/tasks/{created['id']}", json={"title": None}, status=422)
    assert r["error"]["code"] == "common.validation"


async def test_others_cannot_see_my_tasks(
    api: Api, client: AsyncClient, make_user: MakeUser, login_as: LoginAs
):
    s = await api.setup()
    mine = await api.task(s["program"], "private")
    stranger = await make_user(email="other@example.com")
    client.cookies.clear()
    await login_as(client, stranger)
    await api.call("GET", f"/tasks/{mine['id']}", status=404)
    await api.call("GET", f"/programs/{s['program']}/tasks", status=404)
    await api.call("DELETE", f"/tasks/{mine['id']}", status=404)


async def test_default_priority_comes_from_the_program_settings(api: Api):
    s = await api.setup()
    pid = s["program"]
    assert (await api.task(pid))["priority"] == "none"
    await api.call(
        "PATCH",
        f"/settings/tasks/program/{pid}",
        json={"values": {"default_priority": "high"}},
    )
    assert (await api.task(pid))["priority"] == "high"
    assert (await api.task(pid, priority="low"))["priority"] == "low"


async def test_create_many_skips_known_sources(api: Api):
    s = await api.setup()
    pid = s["program"]
    body = {
        "items": [
            {"title": "A", "source_kind": "lms", "source_ref": "1"},
            {"title": "B", "source_kind": "lms", "source_ref": "2"},
            {"title": "A again", "source_kind": "lms", "source_ref": "1"},
            {"title": "C"},
        ]
    }
    first = await api.call("POST", f"/programs/{pid}/tasks:batch", json=body)
    assert [t["title"] for t in first["created"]] == ["A", "B", "C"]
    assert first["skipped"] == [{"index": 2, "task_id": first["created"][0]["id"]}]
    second = await api.call("POST", f"/programs/{pid}/tasks:batch", json=body)
    assert [t["title"] for t in second["created"]] == ["C"]
    assert len(second["skipped"]) == 3


# --- views ----------------------------------------------------------------------------------


async def test_smart_views_and_counts(api: Api, clock: Clock):
    s = await api.setup()
    pid, courses = s["program"], s["courses"]
    clock.now = datetime(2026, 1, 15, 15, 0, tzinfo=UTC)  # 10:00 on Jan 15 in Toronto
    inbox = await api.call("POST", f"/programs/{pid}/task-lists", json={"name": "L"})
    await api.task(pid, "late", due_date="2026-01-14")
    await api.task(pid, "today", due_date="2026-01-15", due_time="18:00")
    await api.task(pid, "past today", due_date="2026-01-15", due_time="08:00")
    await api.task(pid, "later", due_date="2026-01-20", course_id=courses["aps"])
    flagged = await api.task(pid, "flag", flagged=True, list_id=inbox["id"])
    done = await api.task(pid, "done", due_date="2026-01-15")
    await api.call("POST", f"/tasks/{done['id']}:complete", json={})

    assert sorted(await api.titles(pid, view="today")) == ["late", "past today", "today"]
    assert await api.titles(pid, view="scheduled", sort="due") == [
        "late",
        "past today",
        "today",
        "later",
    ]
    assert await api.titles(pid, view="flagged") == ["flag"]
    assert await api.titles(pid, view="completed") == ["done"]
    assert sorted(await api.titles(pid, view="inbox")) == [
        "late",
        "later",
        "past today",
        "today",
    ]
    assert "done" not in await api.titles(pid, view="all")
    assert "done" in await api.titles(pid, view="all", include_completed=True)
    assert await api.titles(pid, course_id=courses["aps"]) == ["later"]
    assert await api.titles(pid, due_from="2026-01-15", due_to="2026-01-15", view="scheduled") == [
        "today",
        "past today",
    ] or sorted(
        await api.titles(pid, due_from="2026-01-15", due_to="2026-01-15", view="scheduled")
    ) == ["past today", "today"]

    counts = await api.call("GET", f"/programs/{pid}/task-counts")
    assert counts["today"] == 3
    assert counts["overdue"] == 2  # "late" and the timed task whose time has passed
    assert counts["scheduled"] == 4
    assert counts["all"] == 5
    assert counts["inbox"] == 4
    assert counts["flagged"] == 1
    assert counts["completed"] == 1
    assert counts["lists"] == {inbox["id"]: 1}
    assert counts["courses"] == {courses["aps"]: 1}
    assert flagged["flagged"]


async def test_today_and_overdue_follow_the_program_time_zone_across_midnight(
    api: Api, clock: Clock
):
    s = await api.setup()
    pid = s["program"]
    await api.task(pid, "due Jan 15", due_date="2026-01-15")
    clock.now = datetime(2026, 1, 16, 4, 30, tzinfo=UTC)  # 23:30 on Jan 15 in Toronto
    counts = await api.call("GET", f"/programs/{pid}/task-counts")
    assert (counts["today"], counts["overdue"]) == (1, 0)
    clock.now = datetime(2026, 1, 16, 5, 30, tzinfo=UTC)  # 00:30 on Jan 16
    counts = await api.call("GET", f"/programs/{pid}/task-counts")
    assert (counts["today"], counts["overdue"]) == (1, 1)
    page = await api.call("GET", f"/programs/{pid}/tasks", params={"view": "today"})
    assert page["items"][0]["overdue"] is True


async def test_term_views_include_tasks_without_a_term(api: Api):
    s = await api.setup()
    pid, terms, courses = s["program"], s["terms"], s["courses"]
    await api.task(pid, "winter", course_id=courses["aps"])
    await api.task(pid, "fall", course_id=courses["fallonly"])
    await api.task(pid, "nowhere")
    assert sorted(await api.titles(pid, term_id=terms["winter"])) == ["nowhere", "winter"]
    counts = await api.call("GET", f"/programs/{pid}/task-counts", params={"term_id": terms["fall"]})
    assert counts["all"] == 2


async def test_sorting_search_and_paging(api: Api):
    s = await api.setup()
    pid = s["program"]
    await api.task(pid, "banana", priority="low", due_date="2026-03-02")
    await api.task(pid, "Apple", priority="urgent")
    await api.task(pid, "cherry lab report", priority="high", due_date="2026-03-01")
    assert await api.titles(pid, sort="manual") == ["banana", "Apple", "cherry lab report"]
    assert await api.titles(pid, sort="title") == ["Apple", "banana", "cherry lab report"]
    assert await api.titles(pid, sort="due") == ["cherry lab report", "banana", "Apple"]
    assert await api.titles(pid, sort="priority") == ["Apple", "cherry lab report", "banana"]
    assert await api.titles(pid, sort="created") == ["cherry lab report", "Apple", "banana"]
    assert await api.titles(pid, search="labreport") == ["cherry lab report"]
    first = await api.call("GET", f"/programs/{pid}/tasks", params={"limit": 2})
    assert first["next_cursor"] == "2"
    rest = await api.call(
        "GET", f"/programs/{pid}/tasks", params={"limit": 2, "cursor": first["next_cursor"]}
    )
    assert len(rest["items"]) == 1 and rest["next_cursor"] is None


# --- completing, moving, deleting -----------------------------------------------------------


async def test_complete_reopen_and_events(api: Api, app: FastAPI, user: UserHandle):
    s = await api.setup()
    task = await api.task(s["program"], due_date="2026-02-01")
    with collect_events(app, user.id) as messages:
        done = await api.call("POST", f"/tasks/{task['id']}:complete", json={})
        again = await api.call("POST", f"/tasks/{task['id']}:complete", json={})
        reopened = await api.call(
            "POST", f"/tasks/{task['id']}:complete", json={"completed": False}
        )
    assert done["completed_at"] is not None and again["completed_at"] == done["completed_at"]
    assert reopened["completed_at"] is None
    types = [m["type"] for m in messages]
    assert types == [
        "tasks.item.completed",
        "calendar.changed",
        "tasks.item.updated",
        "calendar.changed",
    ]


async def test_move_between_lists_and_within_a_list(api: Api):
    s = await api.setup()
    pid, winter = s["program"], s["terms"]["winter"]
    shared = await api.call("POST", f"/programs/{pid}/task-lists", json={"name": "Shared"})
    termed = await api.call(
        "POST", f"/programs/{pid}/task-lists", json={"name": "Termed", "term_id": winter}
    )
    a = await api.task(pid, "a", list_id=shared["id"])
    b = await api.task(pid, "b", list_id=shared["id"])
    c = await api.task(pid, "c", list_id=shared["id"])
    assert await api.titles(pid, list_id=shared["id"]) == ["a", "b", "c"]
    await api.call("POST", f"/tasks/{c['id']}:move", json={"before_task_id": a["id"]})
    assert await api.titles(pid, list_id=shared["id"]) == ["c", "a", "b"]
    await api.call("POST", f"/tasks/{a['id']}:move", json={"before_task_id": b["id"]})
    await api.call("POST", f"/tasks/{b['id']}:move", json={})
    assert await api.titles(pid, list_id=shared["id"]) == ["c", "a", "b"]
    await api.call("POST", f"/tasks/{a['id']}:move", json={"before_task_id": c["id"]})
    assert await api.titles(pid, list_id=shared["id"]) == ["a", "c", "b"]

    moved = await api.call("POST", f"/tasks/{b['id']}:move", json={"list_id": termed["id"]})
    assert (moved["list_id"], moved["term_id"]) == (termed["id"], winter)
    back = await api.call("POST", f"/tasks/{b['id']}:move", json={"list_id": None})
    assert back["list_id"] is None
    await api.call(
        "POST", f"/tasks/{b['id']}:move", json={"list_id": None, "before_task_id": a["id"]}, status=404
    )


async def test_clear_completed_by_scope(api: Api):
    s = await api.setup()
    pid, courses = s["program"], s["courses"]
    lst = await api.call("POST", f"/programs/{pid}/task-lists", json={"name": "L"})
    done = [
        await api.task(pid, "in list", list_id=lst["id"]),
        await api.task(pid, "in course", course_id=courses["aps"]),
        await api.task(pid, "plain"),
    ]
    for t in done:
        await api.call("POST", f"/tasks/{t['id']}:complete", json={})
    await api.task(pid, "open")
    r = await api.call(
        "POST", f"/programs/{pid}/tasks:clear-completed", json={"list_id": lst["id"]}
    )
    assert r == {"deleted": 1}
    r = await api.call(
        "POST", f"/programs/{pid}/tasks:clear-completed", json={"course_id": courses["aps"]}
    )
    assert r == {"deleted": 1}
    r = await api.call("POST", f"/programs/{pid}/tasks:clear-completed", json={})
    assert r == {"deleted": 1}
    assert await api.titles(pid, view="all", include_completed=True) == ["open"]
    r = await api.call("POST", f"/programs/{pid}/tasks:clear-completed", json={})
    assert r == {"deleted": 0}


# --- cleanup after academic changes ---------------------------------------------------------


async def test_deleting_a_course_keeps_its_tasks(api: Api):
    s = await api.setup()
    pid, courses = s["program"], s["courses"]
    task = await api.task(pid, course_id=courses["aps"])
    await api.call("DELETE", f"/courses/{courses['aps']}")
    kept = await api.call("GET", f"/tasks/{task['id']}")
    assert kept["course_id"] is None


async def test_deleting_a_term_removes_its_lists_and_moves_tasks_to_the_inbox(api: Api):
    s = await api.setup()
    pid, terms = s["program"], s["terms"]
    termed = await api.call(
        "POST", f"/programs/{pid}/task-lists", json={"name": "Labs", "term_id": terms["winter"]}
    )
    shared = await api.call("POST", f"/programs/{pid}/task-lists", json={"name": "Shared"})
    in_termed = await api.task(pid, "in termed", list_id=termed["id"])
    in_shared = await api.task(pid, "in shared", list_id=shared["id"], term_id=terms["winter"])
    await api.call("DELETE", f"/terms/{terms['winter']}")
    lists = await api.call("GET", f"/programs/{pid}/task-lists")
    assert [i["id"] for i in lists["items"]] == [shared["id"]]
    moved = await api.call("GET", f"/tasks/{in_termed['id']}")
    assert (moved["list_id"], moved["term_id"]) == (None, None)
    kept = await api.call("GET", f"/tasks/{in_shared['id']}")
    assert (kept["list_id"], kept["term_id"]) == (shared["id"], None)


async def test_deleting_a_program_removes_its_lists_and_tasks(api: Api, app: FastAPI, user: UserHandle):
    s = await api.setup()
    pid = s["program"]
    await api.call("POST", f"/programs/{pid}/task-lists", json={"name": "L"})
    await api.task(pid)
    await api.call("DELETE", f"/programs/{pid}")
    async with system_ctx(app.state, user.id) as ctx:
        from sqlalchemy import func, select

        from semestra.modules.tasks.models import TasksItem, TasksList

        assert await ctx.db.scalar(select(func.count()).select_from(TasksItem)) == 0
        assert await ctx.db.scalar(select(func.count()).select_from(TasksList)) == 0


# --- calendar and agent surface -------------------------------------------------------------


async def test_due_in_range_for_the_calendar(app: FastAPI, api: Api, user: UserHandle):
    s = await api.setup()
    pid, courses = s["program"], s["courses"]
    await api.task(pid, "overdue", due_date="2026-01-10")
    await api.task(pid, "in", due_date="2026-01-20", course_id=courses["aps"])
    await api.task(pid, "edge", due_date="2026-02-01")
    finished = await api.task(pid, "finished", due_date="2026-01-21")
    await api.call("POST", f"/tasks/{finished['id']}:complete", json={})
    await api.task(pid, "undated")

    async def titles(**kwargs: Any) -> list[str]:
        async with system_ctx(app.state, user.id) as ctx:
            rows = await service.due_in_range(
                ctx, pid, date(2026, 1, 15), date(2026, 2, 1), **kwargs
            )
            return [r.title for r in rows]

    assert await titles() == ["in"]
    assert await titles(include_overdue=True) == ["overdue", "in"]
    assert await titles(include_completed=True) == ["in", "finished"]
    assert await titles(course_ids=frozenset([courses["aps"]])) == ["in"]


async def test_agent_find_and_field_selection(app: FastAPI, api: Api, user: UserHandle):
    s = await api.setup()
    pid = s["program"]
    await api.task(pid, "Write lab report", due_date="2026-02-01")
    await api.task(pid, "Buy milk")
    async with system_ctx(app.state, user.id) as ctx:
        found = await registry.invoke(
            ctx, "tasks.item.find", {"query": "lab report", "program_id": pid}, "agent"
        )
        assert [c["title"] for c in found["items"]] == ["Write lab report"]  # pyright: ignore[reportIndexIssue, reportArgumentType]
        slim = await registry.invoke(
            ctx, "tasks.item.query", {"program_id": pid, "fields": ["title"]}, "agent"
        )
        assert all(set(i) == {"id", "title"} for i in slim["items"])  # pyright: ignore[reportIndexIssue, reportArgumentType]
        with pytest.raises(AppError):
            await registry.invoke(ctx, "tasks.item.find", {"query": "x"}, "agent")
        fuzzy = await service.find_tasks(ctx, TaskFindInput(query="mlik", program_id=pid))
        assert fuzzy.items[0].title == "Buy milk"
    await api.call("GET", "/tasks/find", status=404)


# --- tasks from assessments -----------------------------------------------------------------


class FakeGrading:
    """Stands in for M03: a table of assessments the provider reads."""

    def __init__(self) -> None:
        self.items: dict[str, AssessmentInfo] = {}

    async def get(self, ctx: Ctx, assessment_id: str) -> AssessmentInfo | None:
        del ctx
        return self.items.get(assessment_id)

    async def open_in_program(self, ctx: Ctx, program_id: str) -> list[AssessmentInfo]:
        del ctx
        return [
            a
            for a in self.items.values()
            if a.program_id == program_id and a.due_at is not None and not a.scored
        ]


@pytest.fixture
def grading() -> FakeGrading:
    fake = FakeGrading()
    auto.set_assessment_provider(fake)
    yield fake  # pyright: ignore[reportReturnType]
    auto.set_assessment_provider(None)


def assessment(s: dict[str, Any], key: str, due: datetime | None, **kwargs: Any) -> AssessmentInfo:
    return AssessmentInfo(
        id=key,
        course_id=s["courses"]["aps"],
        program_id=s["program"],
        title=f"Assessment {key}",
        course_code="APS105H1",
        due_at=due,
        due_has_time=kwargs.pop("due_has_time", True),
        **kwargs,
    )


async def fire(app: FastAPI, user: UserHandle, kind: str, s: dict[str, Any], key: str) -> None:
    from semestra.core.events import Event, events

    await events.dispatch(
        app.state,
        Event(
            f"grading.assessment.{kind}",
            {"assessment_id": key, "program_id": s["program"], "course_id": s["courses"]["aps"]},
            user.id,
        ),
    )


async def enable_auto(api: Api, pid: str) -> None:
    await api.call(
        "PATCH",
        f"/settings/tasks/program/{pid}",
        json={"values": {"auto_tasks_from_assessments": True}},
    )


async def test_assessments_become_tasks_only_when_the_switch_is_on(
    app: FastAPI, api: Api, user: UserHandle, grading: FakeGrading
):
    s = await api.setup()
    pid = s["program"]
    grading.items["a1"] = assessment(s, "a1", datetime(2026, 2, 10, 15, 0, tzinfo=UTC))
    await fire(app, user, "created", s, "a1")
    assert await api.titles(pid) == []

    await enable_auto(api, pid)  # turning it on creates the tasks that are missing
    page = await api.call("GET", f"/programs/{pid}/tasks")
    [task] = page["items"]
    assert task["title"] == "APS105H1 · Assessment a1"
    assert (task["due_date"], task["due_time"]) == ("2026-02-10", "10:00:00")  # Toronto
    assert (task["priority"], task["source_kind"], task["source_ref"]) == ("medium", "assessment", "a1")
    assert task["course_id"] == s["courses"]["aps"]
    assert task["term_id"] == s["terms"]["winter"]

    await fire(app, user, "created", s, "a1")  # a repeated event does not duplicate
    await fire(app, user, "updated", s, "a1")
    assert await api.titles(pid) == ["APS105H1 · Assessment a1"]


async def test_assessment_changes_follow_through(
    app: FastAPI, api: Api, user: UserHandle, grading: FakeGrading
):
    s = await api.setup()
    pid = s["program"]
    await enable_auto(api, pid)
    grading.items["a1"] = assessment(s, "a1", datetime(2026, 2, 10, 15, 0, tzinfo=UTC))
    await fire(app, user, "created", s, "a1")
    [task] = (await api.call("GET", f"/programs/{pid}/tasks"))["items"]
    await api.call("PATCH", f"/tasks/{task['id']}", json={"priority": "urgent"})

    grading.items["a1"] = assessment(
        s, "a1", datetime(2026, 2, 12, 0, 0, tzinfo=UTC), due_has_time=False
    )
    await fire(app, user, "updated", s, "a1")
    moved = await api.call("GET", f"/tasks/{task['id']}")
    assert (moved["due_date"], moved["due_time"]) == ("2026-02-11", None)  # local date
    assert moved["priority"] == "urgent"  # the user's edit survives

    grading.items["a1"] = assessment(
        s, "a1", datetime(2026, 2, 12, 0, 0, tzinfo=UTC), due_has_time=False, scored=True
    )
    await fire(app, user, "updated", s, "a1")
    assert (await api.call("GET", f"/tasks/{task['id']}"))["completed_at"] is not None

    # A deleted assessment keeps its finished task but removes an unfinished one.
    del grading.items["a1"]
    await fire(app, user, "deleted", s, "a1")
    assert (await api.call("GET", f"/tasks/{task['id']}"))["completed_at"] is not None

    grading.items["a2"] = assessment(s, "a2", datetime(2026, 2, 20, 15, 0, tzinfo=UTC))
    await fire(app, user, "created", s, "a2")
    assert await api.titles(pid) == ["APS105H1 · Assessment a2"]
    del grading.items["a2"]
    await fire(app, user, "deleted", s, "a2")
    assert await api.titles(pid) == []

    # Losing the due date removes the unfinished task as well.
    grading.items["a3"] = assessment(s, "a3", datetime(2026, 2, 20, 15, 0, tzinfo=UTC))
    await fire(app, user, "created", s, "a3")
    grading.items["a3"] = assessment(s, "a3", None)
    await fire(app, user, "updated", s, "a3")
    assert await api.titles(pid) == []


async def test_backfill_skips_scored_and_undated_assessments(
    api: Api, app: FastAPI, user: UserHandle, grading: FakeGrading
):
    s = await api.setup()
    pid = s["program"]
    grading.items["open"] = assessment(s, "open", datetime(2026, 3, 1, 15, 0, tzinfo=UTC))
    grading.items["scored"] = assessment(
        s, "scored", datetime(2026, 3, 1, 15, 0, tzinfo=UTC), scored=True
    )
    grading.items["undated"] = assessment(s, "undated", None)
    await enable_auto(api, pid)
    assert await api.titles(pid) == ["APS105H1 · Assessment open"]
    async with system_ctx(app.state, user.id) as ctx:
        assert await auto.backfill(ctx, pid) == 0  # nothing left to create
