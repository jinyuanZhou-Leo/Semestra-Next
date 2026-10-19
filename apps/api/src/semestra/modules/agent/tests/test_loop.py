"""The turn loop with a scripted model (M12 §10): reads run, writes wait for a decision."""

import asyncio
from typing import Any

import pytest
from fastapi import FastAPI

from semestra.core.errors import AppError
from semestra.modules.agent import loop, tools
from semestra.modules.agent.tests.conftest import Agent, FakeModel, call, calls, events_named, say
from semestra.modules.ai import Text, ToolResult
from semestra.testing import Clock


def text_of(part: object) -> str:
    assert isinstance(part, Text)
    return part.text


def result_of(part: object) -> str:
    assert isinstance(part, ToolResult)
    return part.content


async def test_read_tool_runs_and_the_answer_streams(agent: Agent, model: FakeModel):
    await agent.program()
    session = await agent.session()
    model.then(call("academics.program.list"), say("You have one program, BASc."))

    events = await agent.send(session["id"], "Which programs do I have?")

    names = [n for n, _ in events]
    assert names[0] == "message_start"
    assert events_named(events, "tool_call")[0]["name"] == "academics.program.list"
    assert events_named(events, "tool_result")[0]["ok"] is True
    text = "".join(d["text"] for d in events_named(events, "text_delta"))
    assert text == "You have one program, BASc."
    assert events_named(events, "title") == [{"title": "Lab score"}]
    # The model saw the tool's result before answering.
    second, _ = model.requests[1]
    results = [p for m in second for p in m.content if isinstance(p, ToolResult)]
    assert "BASc" in results[0].content

    detail = await agent.detail(session["id"])
    assert [m["role"] for m in detail["messages"]] == ["user", "assistant", "tool", "assistant"]
    assert detail["session"]["title"] == "Lab score"
    assert detail["generating"] is False


async def test_system_prompt_has_the_scope_and_today(agent: Agent, model: FakeModel):
    program, course, _ = await agent.course_with_lab()
    session = await agent.session({"program_id": program["id"], "course_id": course["id"]})
    model.then(say("Hi"))
    await agent.send(session["id"], "hello")
    system = text_of(model.requests[0][0][0].content[0])
    assert f"course_id {course['id']}" in system
    assert "APS105H1" in system
    assert "Fall 2026" in system


async def test_write_tool_waits_for_approval_then_resumes(agent: Agent, model: FakeModel):
    program, course, lab = await agent.course_with_lab()
    session = await agent.session({"program_id": program["id"], "course_id": course["id"]})
    args = {"assessment_id": lab["id"], "points_earned": 18, "points_possible": 20}
    model.then(call("grading.assessment.update", args, text="Recording it."))

    events = await agent.send(session["id"], "I got 18/20 on Lab 3")

    [proposal] = events_named(events, "proposal")
    assert proposal["status"] == "pending"
    assert proposal["preview"]["target"] == "Lab 3 · APS105H1 Programming"
    assert proposal["preview"]["link"]["to"].endswith(f"/c/{course['id']}/grades")
    changes = {c["field"]: c for c in proposal["preview"]["changes"]}
    assert changes["points_earned"] == {"field": "points_earned", "before": None, "after": 18}
    assert len(model.requests) == 1  # paused, nothing executed
    unchanged = await agent.call("GET", f"/courses/{course['id']}/assessments")
    assert unchanged["items"][0]["points_earned"] is None

    model.then(say("Saved: 18/20 on Lab 3."))
    events = await agent.decide(session["id"], proposal["id"])

    updated = events_named(events, "proposal")[0]
    assert updated["status"] == "executed"
    assert events_named(events, "tool_result")[0]["ok"] is True
    assert "Saved" in "".join(d["text"] for d in events_named(events, "text_delta"))
    after = await agent.call("GET", f"/courses/{course['id']}/assessments")
    assert after["items"][0]["points_earned"] == 18

    again = await agent.stream(
        f"/agent/sessions/{session['id']}/proposals/{proposal['id']}:decide",
        {"decision": "approve"},
        status=409,
    )
    assert again[0][1]["error"]["code"] == "agent.proposal_not_pending"


async def test_rejection_reason_goes_back_to_the_model(agent: Agent, model: FakeModel):
    _, course, lab = await agent.course_with_lab()
    session = await agent.session()
    model.then(
        call("grading.assessment.update", {"assessment_id": lab["id"], "score_percentage": 50})
    )
    [proposal] = events_named(await agent.send(session["id"], "50 on lab 3"), "proposal")

    model.then(say("OK, I left it."))
    events = await agent.decide(session["id"], proposal["id"], "reject", reason="wrong lab")

    assert events_named(events, "proposal")[0]["status"] == "rejected"
    assert "wrong lab" in model.last_text()
    assert (await agent.call("GET", f"/courses/{course['id']}/assessments"))["items"][0][
        "score_percentage"
    ] is None


async def test_concurrent_decisions_execute_once(agent: Agent, model: FakeModel):
    """Two tabs, or "approve all" racing a card: only one decision runs the write."""
    _, _, lab = await agent.course_with_lab()
    session = await agent.session()
    model.then(
        call("grading.assessment.update", {"assessment_id": lab["id"], "score_percentage": 90})
    )
    [proposal] = events_named(await agent.send(session["id"], "90 on lab 3"), "proposal")
    model.then(say("Recorded."), say("Recorded."))
    url = f"/agent/sessions/{session['id']}/proposals/{proposal['id']}:decide"

    async def decide() -> int:
        async with agent.client.stream("POST", url, json={"decision": "approve"}) as r:
            await r.aread()
            return r.status_code

    statuses = sorted(await asyncio.gather(decide(), decide()))
    assert statuses[0] == 200
    assert statuses[1] in (409, 429)
    detail = await agent.detail(session["id"])
    results = [
        b
        for m in detail["messages"]
        if m["role"] == "tool"
        for b in m["content"]
        if b.get("call_id") == proposal["call_id"]
    ]
    assert len(results) == 1


async def test_held_slot_refuses_a_decision(app: FastAPI, agent: Agent, model: FakeModel):
    _, _, lab = await agent.course_with_lab()
    session = await agent.session()
    model.then(
        call("grading.assessment.update", {"assessment_id": lab["id"], "score_percentage": 90})
    )
    [proposal] = events_named(await agent.send(session["id"], "90 on lab 3"), "proposal")
    me = (await agent.call("GET", "/account/me"))["id"]
    with app.state.agent.slot(me, session["id"]):
        err = await agent.call(
            "POST",
            f"/agent/sessions/{session['id']}/proposals/{proposal['id']}:decide",
            429,
            json={"decision": "approve"},
        )
    assert err["error"]["code"] == "agent.busy"
    assert (await agent.detail(session["id"]))["proposals"][0]["status"] == "pending"


async def test_edit_then_approve_uses_the_edited_arguments(agent: Agent, model: FakeModel):
    _, course, lab = await agent.course_with_lab()
    session = await agent.session()
    model.then(
        call("grading.assessment.update", {"assessment_id": lab["id"], "score_percentage": 50})
    )
    [proposal] = events_named(await agent.send(session["id"], "lab 3"), "proposal")
    model.then(say("Done"))
    await agent.decide(
        session["id"],
        proposal["id"],
        "edit",
        args={"assessment_id": lab["id"], "score_percentage": 75},
    )
    items = (await agent.call("GET", f"/courses/{course['id']}/assessments"))["items"]
    assert items[0]["score_percentage"] == 75


async def test_remember_auto_approves_later_calls(agent: Agent, model: FakeModel):
    _, course, lab = await agent.course_with_lab()
    session = await agent.session()
    model.then(
        call("grading.assessment.update", {"assessment_id": lab["id"], "score_percentage": 60})
    )
    [proposal] = events_named(await agent.send(session["id"], "60"), "proposal")
    model.then(say("Done"))
    await agent.decide(session["id"], proposal["id"], remember=True)
    prefs = await agent.call("GET", "/agent/preferences")
    assert prefs["auto_approve"] == ["grading.assessment.update"]

    model.then(
        call("grading.assessment.update", {"assessment_id": lab["id"], "score_percentage": 70}),
        say("Changed to 70."),
    )
    events = await agent.send(session["id"], "make it 70")
    assert events_named(events, "proposal") == []
    items = (await agent.call("GET", f"/courses/{course['id']}/assessments"))["items"]
    assert items[0]["score_percentage"] == 70


async def test_destructive_actions_always_ask(agent: Agent, model: FakeModel):
    _, _, lab = await agent.course_with_lab()
    err = await agent.call(
        "PATCH", "/agent/preferences", 422, json={"auto_approve": ["grading.assessment.delete"]}
    )
    assert err["error"]["code"] == "common.validation"
    session = await agent.session()
    model.then(call("grading.assessment.delete", {"assessment_id": lab["id"]}))
    [proposal] = events_named(await agent.send(session["id"], "delete lab 3"), "proposal")
    assert proposal["effect"] == "destructive"


async def test_bad_arguments_go_back_to_the_model_without_a_card(agent: Agent, model: FakeModel):
    _, _, lab = await agent.course_with_lab()
    session = await agent.session()
    model.then(
        call("grading.assessment.update", {"assessment_id": lab["id"], "score_percentage": -5}),
        say("That score is not valid."),
    )
    events = await agent.send(session["id"], "-5 on lab 3")
    assert events_named(events, "proposal") == []
    result = events_named(events, "tool_result")[0]
    assert (result["ok"], result["error_code"]) == (False, "common.validation")
    assert "common.validation" in model.last_text()


async def test_tool_call_limit_per_turn(agent: Agent, model: FakeModel):
    session = await agent.session()
    many = [("academics.program.list", {}) for _ in range(loop.MAX_TOOL_CALLS + 1)]
    model.then(calls(many))
    events = await agent.send(session["id"], "go")
    errors = events_named(events, "error")
    assert errors[-1]["code"] == "agent.tool_limit_reached"
    assert sum(1 for r in events_named(events, "tool_result") if r["ok"]) == loop.MAX_TOOL_CALLS


async def test_tools_search_and_load(agent: Agent, model: FakeModel):
    session = await agent.session()
    model.then(
        call("tools_search", {"query": "class meeting timetable"}),
        call("tools_load", {"names": ["schedule.meeting.list"]}),
        say("Loaded."),
    )
    events = await agent.send(session["id"], "show my meetings")
    assert all(r["ok"] for r in events_named(events, "tool_result"))
    found = model.requests[1][0][-1].content[0]
    assert isinstance(found, ToolResult)
    assert "schedule.meeting.list" in found.content
    bound = {t.name for t in model.requests[2][1]}
    assert "schedule__meeting__list" in bound
    assert "academics__course__find" in bound  # core
    assert {"tools_search", "tools_load", "skills_search", "skills_read"} <= bound


async def test_bad_meta_arguments_are_a_tool_error(agent: Agent, model: FakeModel):
    session = await agent.session()
    model.then(
        call("tools_search", {"query": "meetings", "limit": "many"}),
        call("tools_load", {"names": "schedule.meeting.list"}),
        say("Sorry."),
    )
    events = await agent.send(session["id"], "show my meetings")
    results = events_named(events, "tool_result")
    assert [r["ok"] for r in results] == [False, False]
    assert "common.validation" in result_of(model.requests[1][0][-1].content[0])
    assert "".join(d["text"] for d in events_named(events, "text_delta")) == "Sorry."


def test_loaded_tools_are_lru_bounded():
    loaded: list[str] = []
    for i in range(tools.LOADED_LIMIT + 3):
        loaded = tools.load(loaded, [f"t{i}"])
    loaded = tools.load(loaded, ["t5"])
    assert len(loaded) == tools.LOADED_LIMIT
    assert "t0" not in loaded
    assert loaded[-1] == "t5"


async def test_skill_read_loads_its_tools(agent: Agent, model: FakeModel):
    session = await agent.session()
    model.then(
        call("skills_search", {"query": "record grades"}),
        call("skills_read", {"name": "record-grades"}),
        say("ok"),
    )
    await agent.send(session["id"], "I got a score")
    assert "record-grades" in result_of(model.requests[1][0][-1].content[0])
    bound = {t.name for t in model.requests[2][1]}
    assert "grading__assessment__create" in bound


async def test_slash_skill_is_injected(agent: Agent, model: FakeModel):
    session = await agent.session()
    model.then(say("Which course?"))
    await agent.send(session["id"], "Lab 3 18/20", skill="record-grades")
    first = text_of(model.requests[0][0][1].content[0])
    assert "record-grades" in first
    assert "Recording grades" in first
    assert "grading__assessment__create" in {t.name for t in model.requests[0][1]}


async def test_expired_proposals(agent: Agent, model: FakeModel, clock: Clock):
    _, _, lab = await agent.course_with_lab()
    session = await agent.session()
    model.then(
        call("grading.assessment.update", {"assessment_id": lab["id"], "score_percentage": 1})
    )
    [proposal] = events_named(await agent.send(session["id"], "1"), "proposal")
    clock.advance(hours=25)
    out = await agent.stream(
        f"/agent/sessions/{session['id']}/proposals/{proposal['id']}:decide",
        {"decision": "approve"},
        status=410,
    )
    assert out[0][1]["error"]["code"] == "agent.proposal_expired"
    detail = await agent.detail(session["id"])
    assert detail["proposals"][0]["status"] == "expired"
    # The model is told the card expired.
    model.then(say("ok"))
    await agent.send(session["id"], "hello?")
    assert "expired" in model.last_text()


async def test_proposal_decided_after_new_message_becomes_a_note(agent: Agent, model: FakeModel):
    _, _, lab = await agent.course_with_lab()
    session = await agent.session()
    model.then(
        call("grading.assessment.update", {"assessment_id": lab["id"], "score_percentage": 9})
    )
    [proposal] = events_named(await agent.send(session["id"], "9"), "proposal")
    model.then(say("Still waiting for you."))
    await agent.send(session["id"], "something else")
    assert "Waiting for the user's decision" in model.last_text()
    model.then(say("Recorded."))
    await agent.decide(session["id"], proposal["id"])
    assert "Update on the earlier" in model.last_text()


async def test_stop_keeps_the_partial_answer(app: FastAPI, agent: Agent, model: FakeModel):
    session = await agent.session()
    model.then(say("A long answer that gets cut"))
    user = (await agent.call("GET", "/account/me"))["id"]
    cancel = asyncio.Event()
    from semestra.modules.agent import service
    from semestra.modules.agent.runtime import agent_ctx

    async with agent_ctx(app.state, user, scope=None) as ctx:
        row = await service.get_session_row(ctx, session["id"])
        service.add_message(ctx, row, "user", [{"type": "text", "text": "hi"}])
        await ctx.db.commit()
    events: list[dict[str, object]] = []
    async for item in loop.generate(app.state, user, session["id"], cancel):
        events.append(item)
        if item["event"] == "text_delta":
            cancel.set()
    start: Any = events[0]["data"]
    assert events[-1] == {
        "event": "message_end",
        "data": {"message_id": start["message_id"], "stopped": True},
    }
    detail = await agent.detail(session["id"])
    assert detail["messages"][-1]["content"] == [{"type": "text", "text": "A long answer"}]


async def test_one_generation_per_session_and_two_per_user(app: FastAPI):
    rt = app.state.agent
    with rt.slot("u", "s1"):
        with pytest.raises(AppError, match=r"agent\.busy"), rt.slot("u", "s1"):
            pass
        with rt.slot("u", "s2"), pytest.raises(AppError, match=r"agent\.busy"), rt.slot("u", "s3"):
            pass
    with rt.slot("u", "s3"):
        pass


async def test_ai_not_configured(app: FastAPI, agent: Agent):
    async def unavailable(ctx: object) -> bool:
        return False

    app.state.agent.chat_available = unavailable
    session = await agent.session()
    out = await agent.stream(
        f"/agent/sessions/{session['id']}/messages", {"text": "hi"}, status=409
    )
    assert out[0][1]["error"] == {
        "code": "ai.not_configured",
        "params": {"purpose": "chat"},
        "request_id": out[0][1]["error"]["request_id"],
    }


async def test_compaction_summarizes_old_turns(agent: Agent, model: FakeModel, monkeypatch):
    from semestra.modules.ai import catalog

    session = await agent.session()
    for i in range(3):
        model.then(say(f"answer {i} " + "x" * 400))
        await agent.send(session["id"], f"question {i} " + "y" * 400)
    monkeypatch.setattr(catalog, "context_window", lambda model: 500)
    model.then(say("fine"))
    await agent.send(session["id"], "question 3")
    sent = model.last_text()
    assert "Summary of the earlier conversation" in sent
    assert "question 0" not in sent
    assert "question 2" in sent


async def test_regenerate_replaces_the_last_answer(agent: Agent, model: FakeModel):
    session = await agent.session()
    model.then(say("first"))
    await agent.send(session["id"], "hi")
    detail = await agent.detail(session["id"])
    last = detail["messages"][-1]["id"]
    model.then(say("second"))
    await agent.stream(f"/agent/sessions/{session['id']}/messages/{last}:regenerate", {})
    detail = await agent.detail(session["id"])
    assert [m["content"][0].get("text") for m in detail["messages"]] == ["hi", "second"]
