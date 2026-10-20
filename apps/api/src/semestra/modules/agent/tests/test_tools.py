"""Tools as the model gets them (M12 §3.2): schemas, search, arguments filled from the
conversation, checks before the card, and errors that say what was wrong."""

import json
from typing import Any

import pytest
from pydantic import BaseModel, Field
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
    assert len(_search("delete")) == tools.SEARCH_LIMIT
    assert _search("", "  ") == []


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
