"""Tools as the model gets them (M12 §3.2): schemas, search, arguments filled from the
conversation, checks before the card, and errors that say what was wrong."""

import dataclasses
import json
from typing import Any

import pytest
from pydantic import BaseModel, Field
from pydantic_ai import ModelRetry
from pydantic_ai.tools import ToolDefinition

from semestra.core.capability import Registry, capability, registry
from semestra.core.context import Ctx, system_ctx
from semestra.core.errors import AppError
from semestra.modules.agent import tools
from semestra.modules.agent.tests.conftest import Agent, FakeModel, call, events_named, say


def _defs() -> list[ToolDefinition]:
    return [
        ToolDefinition(name=tools.tool_name(c.name), description=tools.description(c))
        for c in registry.list("agent")
    ]


def _search(*queries: str) -> list[str]:
    return tools.search(None, queries, _defs())  # pyright: ignore[reportArgumentType]


async def test_search_ranks_tools_by_what_the_words_mean(agent: Agent):
    del agent  # registers the modules
    assert "tasks__item__create" in _search("create task", "add todo")[:3]
    assert _search("canvas announcements")[0] == "lms__announcement__list"
    # Stemming: "tasks" and "completed" find "task" and "complete".
    assert _search("completed tasks")[0] == "tasks__item__complete"
    assert _search("clash", "overlap")[0] == "schedule__conflict__list"
    # Words users say that once matched nothing useful.
    assert "tasks__item__create" in _search("remind me")[:3]
    assert "imports__session__create" in _search("import syllabus")[:3]
    assert "grading__gradebook__get" in _search("final grade needed")[:5]
    assert "lms__course__link__set" in _search("link canvas course")[:5]
    assert len(_search("delete")) == tools.SEARCH_LIMIT
    with pytest.raises(ModelRetry):
        _search("成绩")


def _keys(node: Any, *, properties: bool = False) -> set[str]:
    if isinstance(node, list):
        return {k for v in node for k in _keys(v)}  # pyright: ignore[reportUnknownVariableType]
    if not isinstance(node, dict):
        return set()
    out: set[str] = set()
    for key, value in node.items():  # pyright: ignore[reportUnknownVariableType]
        if not properties:
            out.add(key)
        out |= _keys(value, properties=not properties and key == "properties")
    return out


async def test_schemas_leave_out_titles_and_the_program_is_optional(agent: Agent):
    del agent
    for cap in registry.list("agent"):
        assert "title" not in _keys(tools.input_schema(cap)), cap.name
    schema = tools.input_schema(registry.get("calendar.occurrence.list"))
    assert "program_id" not in schema.get("required", [])
    assert schema["properties"]["program_id"]["description"].endswith(
        "Leave it out for the Program the user is in."
    )
    # A field named `title` is a field, not a schema title.
    assert "title" in tools.input_schema(registry.get("tasks.item.create"))["properties"]


def _undescribed(node: Any, path: str) -> list[str]:
    if isinstance(node, list):
        return [m for v in node for m in _undescribed(v, path)]  # pyright: ignore[reportUnknownVariableType]
    if not isinstance(node, dict):
        return []
    out: list[str] = []
    for key, value in node.items():  # pyright: ignore[reportUnknownVariableType]
        if key == "properties":
            for name, prop in value.items():  # pyright: ignore[reportUnknownVariableType]
                if not prop.get("description"):
                    out.append(f"{path}.{name}")
                out += _undescribed(prop, f"{path}.{name}")
        elif isinstance(value, (dict, list)):
            out += _undescribed(value, path)
    return out


async def test_every_field_the_model_fills_has_a_description(agent: Agent):
    del agent
    missing = [
        m for c in registry.list("agent") for m in _undescribed(tools.input_schema(c), c.name)
    ]
    assert missing == []


async def test_no_core_tool_is_cut_off_by_the_limit(agent: Agent):
    del agent
    assert len([c for c in registry.list("agent") if c.agent_core]) <= tools.CORE_LIMIT


async def test_id_fields_say_which_tool_gives_the_id(agent: Agent):
    del agent
    props = tools.input_schema(registry.get("grading.assessment.update"))["properties"]
    assert props["assessment_id"]["description"].endswith("From grading__assessment__find.")
    assert props["category_id"]["description"].endswith("From grading__gradebook__get.")
    # Not on the tool the id comes from, and not when the text already names a tool.
    find = tools.input_schema(registry.get("academics.course.find"))["properties"]
    assert "From" not in find["query"]["description"]
    item = tools.input_schema(registry.get("files.document.read"))["properties"]["item_id"]
    assert item["description"].count("files__item__list") == 1


async def test_mcp_clients_are_not_told_about_a_program_they_are_not_in(agent: Agent):
    del agent
    cap = registry.get("calendar.occurrence.list")
    note = tools.input_schema(cap, "mcp")["properties"]["program_id"]["description"]
    assert note.endswith(
        "Leave it out when the user has only one Program; else from academics__program__list."
    )


async def test_untrusted_results_say_so_in_the_description(agent: Agent):
    del agent
    flagged = {c.name for c in registry.list("agent") if c.untrusted}
    assert {"lms.quiz.list", "files.document.search", "agent.attachment.read"} <= flagged
    assert tools.UNTRUSTED_NOTE in tools.description(registry.get("lms.quiz.list"))
    assert tools.UNTRUSTED_NOTE not in tools.description(registry.get("tasks.item.create"))


async def test_the_program_is_filled_in_from_where_the_user_is(agent: Agent, model: FakeModel):
    program, _, _ = await agent.course_with_lab()
    other = await agent.program()
    session = await agent.session({"program_id": other["id"]})
    model.then(call("academics.term.list", {}), say("No terms."))
    events = await agent.send(session["id"], "my terms?")
    [result] = events_named(events, "tool_result")
    assert result["ok"]
    # The page's Program, not the other one.
    assert '"items":[]' in str(model.results(-1)[0].content)
    session = await agent.session({"program_id": program["id"]})
    model.then(call("academics.term.list", {}), say("Fall."))
    await agent.send(session["id"], "my terms?")
    assert "Fall 2026" in str(model.results(-1)[0].content)


async def test_errors_name_the_wrong_id_and_the_limit(agent: Agent, model: FakeModel):
    _, _, lab = await agent.course_with_lab()
    session = await agent.session()
    model.then(call("grading.gradebook.get", {"course_id": "nope"}), say("Not found."))
    await agent.send(session["id"], "grades?")
    error = json.loads(str(model.results(-1)[0].content))["error"]
    assert error == {"code": "common.not_found", "params": {"kind": "course", "id": "nope"}}
    model.then(
        call("grading.assessment.update", {"assessment_id": lab["id"], "score_percentage": -5}),
        say("Invalid."),
    )
    await agent.send(session["id"], "-5")
    [err] = json.loads(str(model.results(-1)[-1].content))["error"]["params"]["errors"]
    assert err["loc"] == ["score_percentage"]
    assert err["ctx"] == {"ge": 0}
    assert "greater than or equal to 0" in err["msg"]


class _Echo(BaseModel):
    text: str = Field(description="Text")


async def test_a_check_refuses_the_input_before_anything_runs(agent: Agent):
    reg = Registry()
    ran: list[str] = []

    async def no_shouting(ctx: Ctx, inp: _Echo) -> None:
        del ctx
        if inp.text.isupper():
            raise AppError("test.shouting", 422)

    @capability(
        name="test.echo.say",
        summary="Echo.",
        description="Test.",
        effect="write",
        check=no_shouting,
        target=reg,
    )
    async def echo(ctx: Ctx, inp: _Echo) -> _Echo:
        del ctx
        ran.append(inp.text)
        return inp

    me = (await agent.call("GET", "/account/me"))["id"]
    async with system_ctx(agent.app.state, me) as ctx:
        with pytest.raises(AppError) as exc:
            await reg.invoke(ctx, "test.echo.say", {"text": "HI"}, "agent")
        assert exc.value.code == "test.shouting"
        assert ran == []
        await reg.invoke(ctx, "test.echo.say", {"text": "hi"}, "agent")
        assert ran == ["hi"]


async def _two_programs(agent: Agent) -> tuple[str, str]:
    first, _, _ = await agent.course_with_lab()
    return first["id"], (await agent.program())["id"]


async def _titles(agent: Agent, program_id: str) -> list[str]:
    items = (await agent.call("GET", f"/programs/{program_id}/tasks"))["items"]
    return [t["title"] for t in items]


async def test_the_card_keeps_the_program_it_was_proposed_in(agent: Agent, model: FakeModel):
    here, other = await _two_programs(agent)
    session = await agent.session({"program_id": here})
    model.then(call("tasks.item.create", {"title": "Read ch. 3"}))
    [proposal] = events_named(await agent.send(session["id"], "remind me"), "proposal")
    assert proposal["args"]["program_id"] == here
    # The user opens another Program before approving.
    await agent.call(
        "PATCH", f"/agent/sessions/{session['id']}", json={"scope": {"program_id": other}}
    )
    model.then(say("Added."))
    await agent.decide(session["id"], proposal["id"])
    assert await _titles(agent, here) == ["Read ch. 3"]
    assert await _titles(agent, other) == []
    # Filling in the Program is not an edit of the model's call.
    assert "changed the arguments" not in str(model.results(-1)[0].content)


async def test_an_edited_card_keeps_its_program(agent: Agent, model: FakeModel):
    here, other = await _two_programs(agent)
    session = await agent.session({"program_id": here})
    model.then(call("tasks.item.create", {"title": "Read ch. 3"}))
    [proposal] = events_named(await agent.send(session["id"], "remind me"), "proposal")
    await agent.call(
        "PATCH", f"/agent/sessions/{session['id']}", json={"scope": {"program_id": other}}
    )
    model.then(say("Added."))
    edited = {**proposal["args"], "title": "Read ch. 4"}
    await agent.decide(session["id"], proposal["id"], "edit", args=edited)
    assert await _titles(agent, here) == ["Read ch. 4"]
    assert "changed the arguments" in str(model.results(-1)[0].content)


async def test_a_check_refuses_before_the_card(
    agent: Agent, model: FakeModel, monkeypatch: pytest.MonkeyPatch
):
    async def no_reading(ctx: Ctx, inp: Any) -> None:
        del ctx
        if "Read" in inp.title:
            raise AppError("test.no_reading", 422)

    cap = registry.get("tasks.item.create")
    monkeypatch.setitem(registry._items, cap.name, dataclasses.replace(cap, check=no_reading))  # pyright: ignore[reportPrivateUsage]
    here, _ = await _two_programs(agent)
    session = await agent.session({"program_id": here})
    model.then(call("tasks.item.create", {"title": "Read ch. 3"}), say("Not allowed."))
    events = await agent.send(session["id"], "remind me")
    assert events_named(events, "proposal") == []
    error = json.loads(str(model.results(-1)[0].content))["error"]
    assert error["code"] == "test.no_reading"
    assert await _titles(agent, here) == []
