"""Lists, tasks, smart views, cleanup and tasks from assessments (M05 §8)."""

from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any, cast
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import event

from semestra.core.capability import registry
from semestra.core.context import system_ctx
from semestra.core.errors import AppError
from semestra.modules.schedule.calendar import Occurrence, OccurrenceQuery, collect
from semestra.modules.tasks import auto, service
from semestra.modules.tasks.calendar import due_source
from semestra.modules.tasks.schemas import Task, TaskFindInput
from semestra.modules.tasks.settings import TasksSettings
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
    await api.call(
        "POST", f"/programs/{pid}/task-lists", json={"name": "Errands", "term_id": winter}
    )

    renamed = await api.call("PATCH", f"/task-lists/{labs['id']}", json={"name": "Lab work"})
    assert renamed["name"] == "Lab work"
    await api.call("PATCH", f"/task-lists/{errands['id']}", json={"name": "Lab work"}, status=200)
    await api.call(
        "PATCH",
        f"/task-lists/{errands['id']}",
        json={"name": "Labs", "term_id": winter},
        status=200,
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

    moved = await api.call("PATCH", f"/tasks/{in_winter['id']}", json={"due_date": "2025-11-01"})
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
        "/me/settings/tasks",
        json={"scope_type": "program", "scope_id": pid, "values": {"default_priority": "high"}},
    )
    assert (await api.task(pid))["priority"] == "high"
    assert (await api.task(pid, priority="low"))["priority"] == "low"


async def test_default_priority_offers_four_levels_and_reads_urgent_as_high(api: Api):
    # A default saved as `urgent` before the app offered four levels keeps working, as high.
    assert TasksSettings.model_validate({"default_priority": "urgent"}).default_priority == "high"
    s = await api.setup()
    pid = s["program"]
    await api.call(
        "PATCH",
        "/me/settings/tasks",
        json={"scope_type": "program", "scope_id": pid, "values": {"default_priority": "urgent"}},
    )
    assert (await api.task(pid))["priority"] == "high"
    schema = TasksSettings.model_json_schema()["properties"]["default_priority"]
    assert schema["enum"] == ["none", "low", "medium", "high"]


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
    assert "done" in await api.titles(pid, view="all", completed="include")
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
    counts = await api.call(
        "GET", f"/programs/{pid}/task-counts", params={"term_id": terms["fall"]}
    )
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
    assert len(rest["items"]) == 1
    assert rest["next_cursor"] is None


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
    assert done["completed_at"] is not None
    assert again["completed_at"] == done["completed_at"]
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
        "POST",
        f"/tasks/{b['id']}:move",
        json={"list_id": None, "before_task_id": a["id"]},
        status=404,
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
    assert await api.titles(pid, view="all", completed="include") == ["open"]
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


async def test_deleting_a_program_removes_its_lists_and_tasks(
    api: Api, app: FastAPI, user: UserHandle
):
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


async def test_the_calendar_source_lists_unfinished_dated_tasks(
    app: FastAPI, api: Api, user: UserHandle
):
    s = await api.setup()
    pid, courses = s["program"], s["courses"]
    await api.task(pid, "overdue", due_date="2026-01-10")
    await api.task(pid, "in", due_date="2026-01-20", due_time="09:30", course_id=courses["aps"])
    await api.task(pid, "edge", due_date="2026-02-01")
    finished = await api.task(pid, "finished", due_date="2026-01-21")
    await api.call("POST", f"/tasks/{finished['id']}:complete", json={})
    await api.task(pid, "undated")
    zone = ZoneInfo("America/Toronto")

    async def occurrences(**kwargs: Any) -> list[Occurrence]:
        q = OccurrenceQuery(
            program_id=pid,
            range_start=datetime(2026, 1, 15, tzinfo=zone).astimezone(UTC),
            range_end=datetime(2026, 2, 1, tzinfo=zone).astimezone(UTC),
            **kwargs,
        )
        async with system_ctx(app.state, user.id) as ctx:
            return await due_source(ctx, q)

    [item] = await occurrences()
    assert (item.title, item.kind, item.all_day, item.status) == ("in", "task", False, None)
    assert item.start_at == datetime(2026, 1, 20, 9, 30, tzinfo=zone).astimezone(UTC)
    assert item.color_ref is not None
    assert item.course_id == courses["aps"]
    late = await occurrences(include_overdue=True)
    assert [(o.title, o.status) for o in late] == [("overdue", "overdue"), ("in", None)]
    assert late[0].all_day
    assert [o.title for o in await occurrences(course_ids=frozenset([courses["aps"]]))] == ["in"]
    # The calendar collects it with the other sources.
    async with system_ctx(app.state, user.id) as ctx:
        merged = await collect(
            ctx,
            OccurrenceQuery(
                pid,
                datetime(2026, 1, 15, tzinfo=zone).astimezone(UTC),
                datetime(2026, 2, 1, tzinfo=zone).astimezone(UTC),
            ),
            ["tasks.due"],
        )
    assert [o.title for o in merged] == ["in"]


@pytest.mark.parametrize("zone_name", ["Pacific/Auckland", "Pacific/Pago_Pago"])
async def test_the_calendar_source_keeps_the_local_days_far_from_utc(
    app: FastAPI, api: Api, user: UserHandle, zone_name: str
):
    program = await api.call("POST", "/programs", json={"name": "Far", "timezone": zone_name})
    pid = program["id"]
    await api.task(pid, "day before", due_date="2026-01-14")
    await api.task(pid, "late the day before", due_date="2026-01-14", due_time="23:30")
    await api.task(pid, "early first day", due_date="2026-01-15", due_time="00:30")
    await api.task(pid, "first day", due_date="2026-01-15")
    await api.task(pid, "late last day", due_date="2026-01-31", due_time="23:30")
    await api.task(pid, "day after", due_date="2026-02-01")
    await api.task(pid, "early day after", due_date="2026-02-01", due_time="00:30")
    zone = ZoneInfo(zone_name)
    q = OccurrenceQuery(
        program_id=pid,
        range_start=datetime(2026, 1, 15, tzinfo=zone).astimezone(UTC),
        range_end=datetime(2026, 2, 1, tzinfo=zone).astimezone(UTC),
    )
    async with system_ctx(app.state, user.id) as ctx:
        titles = {o.title for o in await due_source(ctx, q)}
    assert titles == {"early first day", "first day", "late last day"}


async def test_the_calendar_reads_courses_once_however_many_have_tasks(app: FastAPI, api: Api):
    s = await api.setup()
    pid, terms = s["program"], s["terms"]
    statements: list[str] = []

    def count(*args: Any) -> None:
        statements.append(args[2])

    async def calendar_queries() -> int:
        statements.clear()
        await api.call(
            "GET", f"/programs/{pid}/calendar", params={"start": "2026-01-12", "end": "2026-01-19"}
        )
        return len(statements)

    await api.task(pid, "one", due_date="2026-01-14", course_id=s["courses"]["aps"])
    event.listen(app.state.engine.sync_engine, "before_cursor_execute", count)
    try:
        before = await calendar_queries()
        for n in range(5):
            course = await api.call(
                "POST",
                f"/programs/{pid}/courses",
                json={"title": f"C{n}", "code": f"CSC{n}00H1", "term_ids": [terms["winter"]]},
            )
            await api.task(pid, f"t{n}", due_date="2026-01-15", course_id=course["id"])
        assert await calendar_queries() == before
    finally:
        event.remove(app.state.engine.sync_engine, "before_cursor_execute", count)


async def test_only_completed_returns_the_finished_tasks_of_a_view(api: Api):
    s = await api.setup()
    pid = s["program"]
    await api.task(pid, "open")
    done = await api.task(pid, "done")
    await api.call("POST", f"/tasks/{done['id']}:complete", json={})
    assert await api.titles(pid, view="all", completed="only") == ["done"]
    assert await api.titles(pid, view="inbox", completed="only") == ["done"]
    assert await api.titles(pid, view="today", completed="only") == []  # it has no date
    # The old flags are refused, not ignored (an old client would lose its completed tasks).
    error = await api.call("GET", f"/programs/{pid}/tasks?only_completed=true", status=422)
    assert error["error"]["params"]["errors"][0]["code"] == "renamed"


async def test_clear_completed_in_a_term_includes_tasks_without_a_term(api: Api):
    s = await api.setup()
    pid, winter, fall = s["program"], s["terms"]["winter"], s["terms"]["fall"]
    done = [
        await api.task(pid, "no term"),
        await api.task(pid, "winter", term_id=winter),
        await api.task(pid, "fall", term_id=fall),
    ]
    for t in done:
        await api.call("POST", f"/tasks/{t['id']}:complete", json={})
    r = await api.call("POST", f"/programs/{pid}/tasks:clear-completed", json={"term_id": winter})
    assert r == {"deleted": 2}  # what the winter view shows: its own and the term-less ones
    assert await api.titles(pid, view="completed") == ["fall"]


async def test_completed_count_in_a_term_includes_tasks_without_a_term(api: Api):
    s = await api.setup()
    pid, winter, fall = s["program"], s["terms"]["winter"], s["terms"]["fall"]
    for title, term_id in (("no term", None), ("winter", winter), ("fall", fall)):
        task = await api.task(pid, title, term_id=term_id)
        await api.call("POST", f"/tasks/{task['id']}:complete", json={})
    await api.task(pid, "open", term_id=winter)
    counts = await api.call("GET", f"/programs/{pid}/task-counts", params={"term_id": winter})
    assert counts["completed"] == 2
    assert (await api.call("GET", f"/programs/{pid}/task-counts"))["completed"] == 3


async def test_agent_find_and_field_selection(app: FastAPI, api: Api, user: UserHandle):
    s = await api.setup()
    pid = s["program"]
    await api.task(pid, "Write lab report", due_date="2026-02-01")
    await api.task(pid, "Buy milk")
    async with system_ctx(app.state, user.id) as ctx:
        found = await registry.invoke(
            ctx, "tasks.item.find", {"query": "lab report", "program_id": pid}, "agent"
        )
        assert [c["title"] for c in cast("dict[str, Any]", found)["items"]] == ["Write lab report"]
        slim = await registry.invoke(
            ctx, "tasks.item.query", {"program_id": pid, "fields": ["title"]}, "agent"
        )
        assert all(set(i) == {"id", "title"} for i in cast("dict[str, Any]", slim)["items"])
        with pytest.raises(AppError):
            await registry.invoke(ctx, "tasks.item.find", {"query": "x"}, "agent")
        fuzzy = await service.find_tasks(ctx, TaskFindInput(query="milk", program_id=pid))
        assert fuzzy.items[0].title == "Buy milk"
        made = await registry.invoke(
            ctx, "tasks.item.create", {"program_id": pid, "title": "Read ch. 3"}, "agent"
        )
        made_id = cast("dict[str, Any]", made)["id"]
        full = await registry.invoke(ctx, "tasks.item.get", {"task_id": made_id}, "http")
        assert cast("Task", full).source_kind == "agent"
        # Refused in the check, so before the assistant's confirmation card.
        for kind in ("assessment", "lms"):
            with pytest.raises(AppError) as refused:
                await registry.validate(
                    ctx,
                    registry.get("tasks.item.create_many"),
                    {"program_id": pid, "items": [{"title": "x", "source_kind": kind}]},
                    "agent",
                )
            assert refused.value.params["errors"] == [
                {"loc": ["items", 0, "source_kind"], "code": "not_allowed"}
            ]
    await api.call("GET", "/tasks/find", status=404)


# --- tasks from assessments -----------------------------------------------------------------


async def assessment(api: Api, course_id: str, title: str, **body: Any) -> dict[str, Any]:
    return await api.call(
        "POST", f"/courses/{course_id}/assessments", json={"title": title, **body}
    )


async def enable_auto(api: Api, pid: str) -> None:
    await api.call(
        "PATCH",
        "/me/settings/tasks",
        json={
            "scope_type": "program",
            "scope_id": pid,
            "values": {"auto_tasks_from_assessments": True},
        },
    )


async def test_assessments_become_tasks_only_when_the_switch_is_on(api: Api):
    s = await api.setup()
    pid, aps = s["program"], s["courses"]["aps"]
    await assessment(api, aps, "Midterm", due_date="2026-02-10", due_time="10:00")
    await assessment(api, aps, "Scored", due_date="2026-02-11", score_percentage=90)
    await assessment(api, aps, "Undated")
    assert await api.titles(pid) == []

    await enable_auto(api, pid)  # turning it on creates the tasks that are missing
    [task] = (await api.call("GET", f"/programs/{pid}/tasks"))["items"]
    assert task["title"] == "APS105H1 · Midterm"
    assert (task["due_date"], task["due_time"]) == ("2026-02-10", "10:00:00")
    assert (task["priority"], task["source_kind"]) == ("medium", "assessment")
    assert (task["course_id"], task["term_id"]) == (aps, s["terms"]["winter"])

    other = await assessment(api, aps, "Quiz", due_date="2026-02-12")
    titles = await api.titles(pid)
    assert sorted(titles) == ["APS105H1 · Midterm", "APS105H1 · Quiz"]
    await api.call("PATCH", f"/assessments/{other['id']}", json={"title": "Quiz 1"})
    assert len(await api.titles(pid)) == 2  # an update does not duplicate it


async def test_assessment_changes_follow_through(app: FastAPI, api: Api, user: UserHandle):
    s = await api.setup()
    pid, aps = s["program"], s["courses"]["aps"]
    await enable_auto(api, pid)
    a = await assessment(api, aps, "Essay", due_date="2026-02-10")
    [task] = (await api.call("GET", f"/programs/{pid}/tasks"))["items"]
    assert (task["due_date"], task["due_time"]) == ("2026-02-10", None)
    await api.call("PATCH", f"/tasks/{task['id']}", json={"priority": "urgent"})
    # Title, date and course follow the assessment: changing them on the task is refused,
    # sending them unchanged (a whole form) is fine.
    err = await api.call(
        "PATCH", f"/tasks/{task['id']}", 409, json={"due_date": "2026-02-12", "flagged": True}
    )
    assert err["error"] == {
        "code": "tasks.managed_by_assessment",
        "params": {"assessment_id": a["id"], "fields": ["due"]},
        "request_id": err["error"]["request_id"],
    }
    await api.call(
        "PATCH", f"/tasks/{task['id']}", json={"title": task["title"], "due_date": "2026-02-10"}
    )
    # The assistant gets the same answer before its confirmation card.
    async with system_ctx(app.state, user.id) as ctx:
        with pytest.raises(AppError) as refused:
            await registry.validate(
                ctx,
                registry.get("tasks.item.update"),
                {"task_id": task["id"], "title": "Essay draft"},
                "agent",
            )
    assert refused.value.code == "tasks.managed_by_assessment"

    await api.call(
        "PATCH", f"/assessments/{a['id']}", json={"due_date": "2026-02-14", "due_time": "23:00"}
    )
    moved = await api.call("GET", f"/tasks/{task['id']}")
    assert (moved["due_date"], moved["due_time"]) == ("2026-02-14", "23:00:00")
    assert moved["priority"] == "urgent"  # the user's edit survives

    await api.call("PATCH", f"/assessments/{a['id']}", json={"score_percentage": 88})
    assert (await api.call("GET", f"/tasks/{task['id']}"))["completed_at"] is not None

    # Deleting the assessment keeps its finished task but removes an unfinished one.
    await api.call("DELETE", f"/assessments/{a['id']}")
    assert (await api.call("GET", f"/tasks/{task['id']}"))["completed_at"] is not None
    open_one = await assessment(api, aps, "Lab", due_date="2026-03-01")
    assert len(await api.titles(pid)) == 1
    await api.call("DELETE", f"/assessments/{open_one['id']}")
    assert await api.titles(pid) == []

    # Losing the due date removes the unfinished task as well.
    third = await assessment(api, aps, "Project", due_date="2026-03-05")
    assert len(await api.titles(pid)) == 1
    await api.call("PATCH", f"/assessments/{third['id']}", json={"due_date": None})
    assert await api.titles(pid) == []


async def test_assessment_tasks_are_not_a_second_calendar_entry(
    app: FastAPI, api: Api, user: UserHandle
):
    s = await api.setup()
    pid, aps = s["program"], s["courses"]["aps"]
    await enable_auto(api, pid)
    await assessment(api, aps, "Midterm", due_date="2026-02-10")
    await api.task(pid, "Own task", due_date="2026-02-10")
    zone = ZoneInfo("America/Toronto")
    async with system_ctx(app.state, user.id) as ctx:
        merged = await collect(
            ctx,
            OccurrenceQuery(
                pid,
                datetime(2026, 2, 1, tzinfo=zone).astimezone(UTC),
                datetime(2026, 3, 1, tzinfo=zone).astimezone(UTC),
            ),
            ["tasks.due", "grading.assessments"],
        )
    assert sorted((o.source, o.title) for o in merged) == [
        ("grading.assessments", "APS105H1 · Midterm"),
        ("tasks.due", "Own task"),
    ]


async def test_a_second_run_of_the_backfill_creates_nothing(
    api: Api, app: FastAPI, user: UserHandle
):
    s = await api.setup()
    pid, aps = s["program"], s["courses"]["aps"]
    await assessment(api, aps, "One", due_date="2026-03-01")
    await enable_auto(api, pid)
    async with system_ctx(app.state, user.id) as ctx:
        assert await auto.backfill(ctx, pid) == 0
    assert len(await api.titles(pid)) == 1


# --- review fixes (2026-10-22 module review) ------------------------------------------------


async def test_deleting_a_course_settles_the_tasks_of_its_assessments(api: Api):
    s = await api.setup()
    pid, aps = s["program"], s["courses"]["aps"]
    await enable_auto(api, pid)
    await assessment(api, aps, "Midterm", due_date="2026-02-10")
    done = await assessment(api, aps, "Quiz", due_date="2026-02-01")
    await api.call("PATCH", f"/assessments/{done['id']}", json={"score_percentage": 80})
    own = await api.task(pid, "Own", course_id=aps)
    await api.call("DELETE", f"/courses/{aps}")
    # The unfinished assessment task goes with the assessment; the finished one stays as an
    # ordinary task that can be edited; the user's own task only loses the course.
    page = await api.call("GET", f"/programs/{pid}/tasks", params={"completed": "include"})
    rows = {t["title"]: t for t in page["items"]}
    assert sorted(rows) == ["APS105H1 · Quiz", "Own"]
    quiz = rows["APS105H1 · Quiz"]
    assert (quiz["source_kind"], quiz["source_ref"], quiz["course_id"]) == ("manual", None, None)
    await api.call("PATCH", f"/tasks/{quiz['id']}", json={"title": "Quiz notes"})
    assert rows["Own"]["id"] == own["id"]
    assert rows["Own"]["course_id"] is None


async def test_tasks_made_while_the_switch_was_on_keep_following_their_assessment(api: Api):
    s = await api.setup()
    pid, aps = s["program"], s["courses"]["aps"]
    await enable_auto(api, pid)
    a = await assessment(api, aps, "Essay", due_date="2026-02-10")
    await api.call(
        "PATCH",
        "/me/settings/tasks",
        json={
            "scope_type": "program",
            "scope_id": pid,
            "values": {"auto_tasks_from_assessments": False},
        },
    )
    await api.call("PATCH", f"/assessments/{a['id']}", json={"due_date": "2026-02-20"})
    [task] = (await api.call("GET", f"/programs/{pid}/tasks"))["items"]
    assert task["due_date"] == "2026-02-20"
    await assessment(api, aps, "New one", due_date="2026-03-01")  # no new task while off
    assert len(await api.titles(pid)) == 1
    await api.call("DELETE", f"/assessments/{a['id']}")
    assert await api.titles(pid) == []


async def test_only_turning_the_switch_on_brings_back_deleted_assessment_tasks(api: Api):
    s = await api.setup()
    pid, aps = s["program"], s["courses"]["aps"]
    await enable_auto(api, pid)
    await assessment(api, aps, "Essay", due_date="2026-02-10")
    [task] = (await api.call("GET", f"/programs/{pid}/tasks"))["items"]
    await api.call("DELETE", f"/tasks/{task['id']}")
    for values in ({"default_priority": "low"}, {"auto_tasks_from_assessments": True}):
        await api.call(
            "PATCH",
            "/me/settings/tasks",
            json={"scope_type": "program", "scope_id": pid, "values": values},
        )
    assert await api.titles(pid) == []  # another setting, or the switch saved as it was


async def test_deleting_a_list_with_its_tasks_announces_them(
    api: Api, app: FastAPI, user: UserHandle
):
    s = await api.setup()
    pid = s["program"]
    drop = await api.call("POST", f"/programs/{pid}/task-lists", json={"name": "Drop"})
    a = await api.task(pid, "a", list_id=drop["id"], due_date="2026-02-01")
    b = await api.task(pid, "b", list_id=drop["id"])
    with collect_events(app, user.id) as messages:
        await api.call("DELETE", f"/task-lists/{drop['id']}", params={"delete_tasks": True})
    [deleted] = [m["data"] for m in messages if m["type"] == "tasks.item.deleted"]
    assert sorted(deleted["task_ids"]) == sorted([a["id"], b["id"]])
    assert "calendar.changed" in [m["type"] for m in messages]


async def test_a_term_list_shows_its_tasks_whatever_term_their_course_gives_them(api: Api):
    s = await api.setup()
    pid, fall, winter = s["program"], s["terms"]["fall"], s["terms"]["winter"]
    aps = s["courses"]["aps"]  # a winter course
    fall_list = await api.call(
        "POST", f"/programs/{pid}/task-lists", json={"name": "Fall list", "term_id": fall}
    )
    shared = await api.call("POST", f"/programs/{pid}/task-lists", json={"name": "Shared"})
    task = await api.task(pid, "Winter work", list_id=fall_list["id"], course_id=aps)
    assert task["term_id"] == winter
    assert await api.titles(pid, list_id=fall_list["id"], term_id=fall) == ["Winter work"]
    counts = await api.call("GET", f"/programs/{pid}/task-counts", params={"term_id": fall})
    assert counts["lists"] == {fall_list["id"]: 1}
    # A Program-wide list still shows only the term's tasks on a term page.
    await api.task(pid, "Winter errand", list_id=shared["id"], term_id=winter)
    assert await api.titles(pid, list_id=shared["id"], term_id=fall) == []


async def test_pages_report_the_total(api: Api):
    s = await api.setup()
    pid = s["program"]
    for n in range(5):
        task = await api.task(pid, f"t{n}")
        if n < 3:
            await api.call("POST", f"/tasks/{task['id']}:complete", json={})
    page = await api.call("GET", f"/programs/{pid}/tasks", params={"completed": "only", "limit": 2})
    assert (len(page["items"]), page["total"], page["next_cursor"]) == (2, 3, "2")
    open_page = await api.call("GET", f"/programs/{pid}/tasks", params={"limit": 10})
    assert (open_page["total"], open_page["next_cursor"]) == (2, None)
    searched = await api.call("GET", f"/programs/{pid}/tasks", params={"search": "t1"})
    assert searched["total"] == len(searched["items"])


async def test_moving_into_a_used_up_gap_spaces_the_list_out(api: Api):
    s = await api.setup()
    pid = s["program"]
    await api.task(pid, "first")
    last = await api.task(pid, "last")
    names = []
    for n in range(60):  # each move halves the gap between `first` and the one before it
        task = await api.task(pid, f"m{n}")
        await api.call("POST", f"/tasks/{task['id']}:move", json={"before_task_id": last["id"]})
        names.append(f"m{n}")
    assert await api.titles(pid, view="inbox") == ["first", *names, "last"]
