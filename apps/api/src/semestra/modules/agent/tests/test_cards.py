"""Confirmation cards (M12 §3.5): what a write changes, before → after, by name, never by id."""

from typing import Any

from semestra.core.capability import registry
from semestra.core.context import system_ctx
from semestra.modules.agent.loop import make_preview
from semestra.modules.agent.tests.conftest import Agent


async def _card(agent: Agent, name: str, args: dict[str, Any]) -> dict[str, Any]:
    me = await agent.call("GET", "/account/me")
    async with system_ctx(agent.app.state, me["id"]) as ctx:
        ctx.actor = "agent"
        return await make_preview(ctx, registry.get(name), args)


async def test_an_update_shows_before_and_after_and_what_it_clears(agent: Agent):
    program = await agent.program()
    pid = program["id"]
    errands = await agent.call("POST", f"/programs/{pid}/task-lists", json={"name": "Errands"})
    task = await agent.call(
        "POST",
        f"/programs/{pid}/tasks",
        json={"title": "Buy a calculator", "list_id": errands["id"], "due_date": "2026-10-22"},
    )
    card = await _card(
        agent,
        "tasks.item.update",
        {"task_id": task["id"], "title": "Buy a graphing calculator", "list_id": None,
         "due_date": None},
    )  # fmt: skip
    assert card == {
        "target": "Buy a calculator",
        "changes": [
            {"field": "title", "before": "Buy a calculator", "after": "Buy a graphing calculator"},
            # Moved to the inbox: the list's name before, nothing after.
            {"field": "list", "before": "Errands", "after": None},
            {"field": "due_date", "before": "2026-10-22", "after": None},
        ],
    }
    assert errands["id"] not in str(card)


async def test_clearing_the_official_grade_says_so(agent: Agent):
    _, course, _ = await agent.course_with_lab()
    await agent.call(
        "PATCH", f"/courses/{course['id']}/grade", json={"final_override_percentage": 85}
    )
    card = await _card(
        agent,
        "grading.course_result.update",
        {"course_id": course["id"], "final_override_percentage": None},
    )
    assert card["target"] == "APS105H1"
    assert card["changes"] == [{"field": "final_override_percentage", "before": 85, "after": None}]


async def test_a_reorder_shows_the_new_order_by_name(agent: Agent):
    program, course, _ = await agent.course_with_lab()
    term_id = course["term_ids"][0]
    other = await agent.call(
        "POST",
        f"/programs/{program['id']}/courses",
        json={"title": "Calculus", "code": "MAT186H1", "term_ids": [term_id]},
    )
    card = await _card(
        agent,
        "academics.course.reorder",
        {"term_id": term_id, "course_ids": [other["id"], course["id"]]},
    )
    assert card == {
        "target": "Fall 2026",
        "changes": [{"field": "order", "after": ["MAT186H1", "APS105H1"]}],
    }


async def test_deleting_a_term_lists_the_courses_that_go(agent: Agent):
    program, course, _ = await agent.course_with_lab()
    fall = course["term_ids"][0]
    winter = (
        await agent.call(
            "POST",
            f"/programs/{program['id']}/terms",
            json={"name": "Winter 2027", "start_date": "2027-01-05", "end_date": "2027-04-20"},
        )
    )["term"]["id"]
    await agent.call(
        "POST",
        f"/programs/{program['id']}/courses",
        json={"title": "Calculus", "code": "MAT157Y1", "term_ids": [fall, winter]},
    )
    card = await _card(agent, "academics.term.delete", {"term_id": fall})
    assert card["changes"] == [
        {"field": "courses", "before": ["APS105H1"], "after": None, "count": 1},
        {"field": "kept_courses", "after": ["MAT157Y1"], "count": 1},
    ]
    moved = await _card(agent, "academics.course.set_terms", {"course_id": course["id"],
                                                               "term_ids": [winter]})  # fmt: skip
    assert moved["changes"] == [
        {"field": "terms", "before": ["Fall 2026"], "after": ["Winter 2027"]}
    ]


async def test_clearing_completed_tasks_counts_them(agent: Agent):
    program = await agent.program()
    pid = program["id"]
    for title in ("Lab report", "Read chapter 3", "Still open"):
        task = await agent.call("POST", f"/programs/{pid}/tasks", json={"title": title})
        if title != "Still open":
            await agent.call("POST", f"/tasks/{task['id']}:complete", json={"completed": True})
    card = await _card(agent, "tasks.item.clear_completed", {"program_id": pid})
    assert card["target"] == program["name"]
    [change] = card["changes"]
    assert change["field"] == "tasks"
    assert change["count"] == 2
    assert sorted(change["before"]) == ["Lab report", "Read chapter 3"]


async def test_a_class_cancelled_on_one_date_names_the_section(agent: Agent):
    _, course, _ = await agent.course_with_lab()
    meeting = await agent.call(
        "POST",
        f"/courses/{course['id']}/meetings",
        json={"term_id": course["term_ids"][0], "type_code": "LEC", "section_code": "0101",
              "weekday": 2, "start_time": "10:00", "end_time": "11:00"},
    )  # fmt: skip
    card = await _card(
        agent,
        "schedule.exception.upsert",
        {"meeting_id": meeting["id"], "original_date": "2026-10-20", "kind": "cancelled"},
    )
    assert card == {
        "target": "LEC 0101 · APS105H1 Programming",
        "changes": [
            {"field": "original_date", "after": "2026-10-20"},
            {"field": "exception", "after": "cancelled"},
        ],
    }
    moved = await _card(
        agent,
        "schedule.meeting.update",
        {"meeting_id": meeting["id"], "location": "BA1130", "start_time": "13:00"},
    )
    assert moved["target"] == "LEC 0101 · APS105H1 Programming"
    assert {"field": "start_time", "before": "10:00", "after": "13:00"} in moved["changes"]


async def test_adding_a_card_names_its_kind_and_board(agent: Agent):
    program = await agent.program()
    card = await _card(
        agent,
        "layouts.card.add",
        {"scope_type": "program", "scope_id": program["id"], "card_id": "sticky.note"},
    )
    assert card == {
        "target": program["name"],
        "changes": [{"field": "card", "after": "sticky.note"}],
    }


async def test_refs_to_courses_are_named(agent: Agent):
    from semestra.modules.agent import display

    _, course, _ = await agent.course_with_lab()
    me = await agent.call("GET", "/account/me")
    async with system_ctx(agent.app.state, me["id"]) as ctx:
        names = await display.labels(
            ctx,
            "imports.item.add_many",
            {"items": [{"data": {"course_ref": f"course:{course['id']}"}}]},
        )
        shown = await display.preview(
            ctx,
            "grading.assessment.create",
            {"course_id": course["id"], "title": "Quiz", "source_ref": "lms:fake:1:a1"},
        )
    assert names == ["APS105H1"]
    # Bookkeeping refs are left out.
    assert shown["changes"] == [{"field": "title", "after": "Quiz"}]
