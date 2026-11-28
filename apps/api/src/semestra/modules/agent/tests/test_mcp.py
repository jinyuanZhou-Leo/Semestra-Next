"""The MCP endpoint with the official SDK client over the ASGI app (M12 §5, §10)."""

import hashlib
from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from typing import Any

import mcp_types as types
import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from mcp import ClientSession
from mcp.shared.exceptions import MCPError
from pydantic import RootModel

from semestra.modules.agent.tests.conftest import (
    Agent,
    FakeModel,
    call,
    events_named,
    mcp_session,
    say,
)

Connect = Callable[[str], AbstractAsyncContextManager[ClientSession]]


class _Wire(RootModel[dict[str, Any]]):
    """A result as it came over the wire, for methods the SDK client has no type for."""


async def _token(agent: Agent, scopes: list[str]) -> str:
    created = await agent.call("POST", "/account/tokens", json={"name": "Claude", "scopes": scopes})
    return created["token"]


def _connector(app: FastAPI, *, modern: bool = False) -> Connect:
    """`modern`: the 2026-07-28 protocol (`server/discover`), where extensions are advertised."""

    def connect(token: str) -> AbstractAsyncContextManager[ClientSession]:
        return mcp_session(app, token, modern=modern)

    return connect


def _text(content: object) -> str:
    text = getattr(content, "text", None)
    assert isinstance(text, str)
    return text


def _payload(result: Any) -> Any:
    return result.structured_content


async def test_read_token_lists_and_calls_read_tools(app: FastAPI, agent: Agent):
    program = await agent.program()
    token = await _token(agent, ["read"])
    async with _connector(app)(token) as mcp:
        tools = {t.name: t for t in (await mcp.list_tools()).tools}
        assert "academics__program__list" in tools
        annotations = tools["academics__program__list"].annotations
        assert annotations is not None
        assert annotations.read_only_hint is True
        assert "grading__assessment__update" not in tools  # write tools need a write token
        assert "agent__session__list" not in tools  # http-only capabilities never appear

        result = await mcp.call_tool("academics__program__list", {})
        assert result.is_error is False
        assert _payload(result)["items"][0]["id"] == program["id"]

        refused = await mcp.call_tool("academics__program__create", {"name": "X"})
        assert refused.is_error is True
        assert _payload(refused)["error"]["code"] == "auth.token_scope"


async def test_write_token_and_destructive_preference(app: FastAPI, agent: Agent):
    _, course, lab = await agent.course_with_lab()
    token = await _token(agent, ["read", "write"])
    async with _connector(app)(token) as mcp:
        names = {t.name for t in (await mcp.list_tools()).tools}
        assert "grading__assessment__update" in names
        assert "grading__assessment__delete_many" not in names
        result = await mcp.call_tool(
            "grading__assessment__update", {"assessment_id": lab["id"], "score_percentage": 90}
        )
        assert result.is_error is False
        assert _payload(result)["score_percentage"] == 90

        refused = await mcp.call_tool(
            "grading__assessment__delete_many",
            {"course_id": course["id"], "assessment_ids": [lab["id"]]},
        )
        assert _payload(refused)["error"]["code"] == "auth.token_scope"
    # The same token on the REST route is held to the same preference.
    bearer = {"Authorization": f"Bearer {token}"}
    url = f"/courses/{course['id']}/assessments:delete"
    body = {"assessment_ids": [lab["id"]]}
    r = await agent.client.post(url, headers=bearer, json=body)
    assert r.json()["error"]["code"] == "auth.token_scope"

    await agent.call("PATCH", "/agent/preferences", json={"mcp_allow_destructive": True})
    async with _connector(app)(token) as mcp:
        names = {t.name for t in (await mcp.list_tools()).tools}
        assert "grading__assessment__delete_many" in names
    assert (await agent.client.post(url, headers=bearer, json=body)).status_code == 200


async def test_changes_made_with_a_token_are_listed(app: FastAPI, agent: Agent):
    _, course, lab = await agent.course_with_lab()
    await agent.call("PATCH", "/agent/preferences", json={"mcp_allow_destructive": True})
    token = await _token(agent, ["read", "write"])
    token_id = (await agent.call("GET", "/account/tokens"))["items"][0]["id"]
    async with _connector(app)(token) as mcp:
        await mcp.call_tool("academics__program__list", {})  # reads are not changes
        await mcp.call_tool(
            "grading__assessment__update", {"assessment_id": lab["id"], "score_percentage": 90}
        )
        refused = await mcp.call_tool("grading__assessment__update", {"assessment_id": "nope"})
        assert refused.is_error is True
    # REST calls with the token count too; a deleted row is still named.
    r = await agent.client.post(
        f"/courses/{course['id']}/assessments:delete",
        headers={"Authorization": f"Bearer {token}"},
        json={"assessment_ids": [lab["id"]]},
    )
    assert r.status_code == 200

    # The user's own changes in the app are not a client's.
    await agent.call("PATCH", f"/courses/{course['id']}", json={"title": "Programming I"})
    # Revoking the connection keeps what it changed, under its name.
    await agent.call("DELETE", f"/account/tokens/{token_id}")
    for path in ("/agent/mcp-changes", f"/agent/mcp-changes?token_id={token_id}"):
        changes = (await agent.call("GET", path))["items"]
        assert [(c["client"], c["capability"], c["target"]) for c in changes] == [
            ("Claude", "grading.assessment.delete_many", ["APS105H1", "Lab 3"]),
            ("Claude", "grading.assessment.update", ["Lab 3"]),
        ]


async def test_skills_reach_the_client_as_prompts_tool_and_extension(app: FastAPI, agent: Agent):
    token = await _token(agent, ["read"])
    async with _connector(app)(token) as mcp:
        # The rules Sem works by, with tool names as this client calls them.
        assert "must come from a tool result" in (mcp.instructions or "")
        assert "`academics__term__list`" in (mcp.instructions or "")
        prompts = {p.name for p in (await mcp.list_prompts()).prompts}
        assert {"answer-schedule-questions", "grade-planning"} <= prompts
        assert "record-grades" not in prompts  # needs write tools this token cannot call
        prompt = await mcp.get_prompt("answer-schedule-questions")
        assert "Answering schedule questions" in _text(prompt.messages[0].content)

        # The model can load one itself: the catalog is in the tool's description.
        load = next(t for t in (await mcp.list_tools()).tools if t.name == "load_skill")
        assert "- grade-planning: Use when" in (load.description or "")
        # It says what Semestra is and when to turn to it, for a model that sees only tools.
        assert (load.description or "").startswith("Semestra is the user's own study planner.")
        assert "record-grades" not in (load.description or "")
        loaded = await mcp.call_tool("load_skill", {"name": "answer-schedule-questions"})
        assert "Answering schedule questions" in _text(loaded.content[0])
        assert "calendar__occurrence__list" in _text(loaded.content[0])
        # This surface's rules come with it: a client may not give the model the instructions.
        assert "wait for them to agree" in _text(loaded.content[0])
        missing = await mcp.call_tool("load_skill", {"name": "record-grades"})
        assert missing.is_error

    async with _connector(app)(await _token(agent, ["read", "write"])) as mcp:
        prompt = await mcp.get_prompt("record-grades")
        assert "Recording grades" in _text(prompt.messages[0].content)
        prompts = {p.name for p in (await mcp.list_prompts()).prompts}
        assert "manage-terms-and-courses" not in prompts  # deletes are off by default
    # The MCP Skills extension: SKILL.md files with the same rules on what a token sees.
    async with _connector(app, modern=True)(token) as mcp:
        caps = mcp.server_capabilities
        assert caps is not None
        assert caps.extensions == {"io.modelcontextprotocol/skills": {}}
        listed = (
            await mcp.send_request(
                types.Request[types.PaginatedRequestParams, str](
                    method="skills/list", params=types.PaginatedRequestParams()
                ),
                _Wire,
            )
        ).root
        assert listed["resultType"] == "complete"
        entry = next(s for s in listed["skills"] if s["uri"] == "skill://grade-planning/SKILL.md")
        got = await mcp.send_request(
            types.Request[dict[str, str], str](
                method="skills/get", params={"uri": "skill://grade-planning/SKILL.md"}
            ),
            _Wire,
        )
        assert got.root["skill"] == entry
        assert entry["frontmatter"]["name"] == "grade-planning"
        assert "record-grades" not in {s["frontmatter"]["name"] for s in listed["skills"]}
        # Readable by URI, but not listed: it would show up twice beside the prompts.
        assert (await mcp.list_resources()).resources == []
        read = await mcp.read_resource("skill://grade-planning/SKILL.md")
        text = _text(read.contents[0])
        assert text.startswith("---\nname: grade-planning\n")
        raw = text.encode()
        assert entry["resources"] == [
            {
                "uri": "skill://grade-planning/SKILL.md",
                "digest": f"sha256:{hashlib.sha256(raw).hexdigest()}",
                "size": len(raw),
            }
        ]
        with pytest.raises(MCPError):
            await mcp.read_resource("skill://record-grades/SKILL.md")


async def test_cookies_and_missing_tokens_are_refused(client: AsyncClient, agent: Agent):
    r = await client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "common.unauthenticated"
    r = await client.post(
        "/mcp",
        json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
        headers={"Authorization": "Bearer spat_not-a-real-token"},
    )
    assert r.status_code == 401


async def test_a_client_can_look_at_the_pages_of_a_course_file(app: FastAPI, agent: Agent):
    from semestra.modules.files.tests.conftest import make_pdf

    _, course, _ = await agent.course_with_lab()
    upload = [("files", ("notes.pdf", make_pdf(["one", "two"]), "application/pdf"))]
    item = (await agent.call("POST", f"/courses/{course['id']}/files", files=upload))["items"][0]
    token = await _token(agent, ["read"])
    async with _connector(app)(token) as mcp:
        tools = {t.name: t for t in (await mcp.list_tools()).tools}
        assert "attachment_id" not in tools["view_pages"].input_schema["properties"]
        assert "attachment_id" not in (tools["view_pages"].description or "")
        result = await mcp.call_tool("view_pages", {"item_id": item["id"], "page_to": 2})
        assert result.is_error is False
        images = [c for c in result.content if isinstance(c, types.ImageContent)]
        assert [i.mime_type for i in images] == ["image/png", "image/png"]
        assert 'Pages 1-2 of "notes.pdf"' in _text(result.content[0])

        missing = await mcp.call_tool("view_pages", {"item_id": "nope"})
        assert missing.is_error is True


# --- forms (MCP elicitation, M12 §5) -----------------------------------------------------------


def _form(asked: Any, key: str) -> types.ElicitRequestFormParams:
    assert isinstance(asked, types.InputRequiredResult), asked
    assert asked.input_requests is not None
    assert list(asked.input_requests) == [key]
    request = asked.input_requests[key]
    assert isinstance(request, types.ElicitRequest)
    assert isinstance(request.params, types.ElicitRequestFormParams)
    return request.params


async def _answer(
    mcp: ClientSession,
    tool: str,
    args: dict[str, Any],
    asked: types.InputRequiredResult,
    key: str,
    action: str = "accept",
    content: dict[str, Any] | None = None,
) -> Any:
    return await mcp.call_tool(
        tool,
        args,
        input_responses={key: types.ElicitResult(action=action, content=content)},  # pyright: ignore[reportArgumentType]
        request_state=asked.request_state,
        allow_input_required=True,
    )


async def test_a_delete_waits_for_the_user_to_confirm_it(app: FastAPI, agent: Agent):
    _, course, lab = await agent.course_with_lab()
    await agent.call("PATCH", "/agent/preferences", json={"mcp_allow_destructive": True})
    token = await _token(agent, ["read", "write"])
    tool, args = (
        "grading__assessment__delete_many",
        {
            "course_id": course["id"],
            "assessment_ids": [lab["id"]],
        },
    )
    async with mcp_session(app, token, forms=True) as mcp:
        listed = {t.name: t for t in (await mcp.list_tools()).tools}
        assert "Semestra shows the user what it changes" in (listed[tool].description or "")

        asked = await mcp.call_tool(tool, args, allow_input_required=True)
        form = _form(asked, "confirm")
        assert "APS105H1" in form.message
        assert "Lab 3" in form.message
        assert isinstance(asked, types.InputRequiredResult)
        declined = await _answer(mcp, tool, args, asked, "confirm", action="decline")
        assert _payload(declined)["rejected"] is True
        assert (await agent.call("GET", f"/courses/{course['id']}/gradebook"))["assessments"]

        asked = await mcp.call_tool(tool, args, allow_input_required=True)
        assert isinstance(asked, types.InputRequiredResult)
        done = await _answer(mcp, tool, args, asked, "confirm")
        assert done.is_error is False
        assert not (await agent.call("GET", f"/courses/{course['id']}/gradebook"))["assessments"]

    # A client without forms gets the tool as before: the model confirms in the chat.
    lab = await agent.call(
        "POST", f"/courses/{course['id']}/assessments", json={"title": "Lab 4", "weight": 10}
    )
    async with mcp_session(app, token, modern=True) as mcp:
        listed = {t.name: t for t in (await mcp.list_tools()).tools}
        assert "Semestra shows the user" not in (listed[tool].description or "")
        args["assessment_ids"] = [lab["id"]]
        assert (await mcp.call_tool(tool, args)).is_error is False


async def test_the_user_picks_a_course_the_call_left_out(app: FastAPI, agent: Agent):
    program, course, _ = await agent.course_with_lab()
    term_id = (await agent.call("GET", f"/courses/{course['id']}"))["term_ids"][0]
    other = await agent.call(
        "POST",
        f"/programs/{program['id']}/courses",
        json={"title": "Calculus", "code": "MAT186H1", "term_ids": [term_id]},
    )
    token = await _token(agent, ["read", "write"])
    tool = "grading__assessment__create_many"
    args: dict[str, Any] = {"assessments": [{"title": "Quiz 1", "weight": 5}]}
    async with mcp_session(app, token, forms=True) as mcp:
        listed = {t.name: t for t in (await mcp.list_tools()).tools}
        assert "course_id" not in listed[tool].input_schema.get("required", [])
        # A read is not run through a form, so it still needs the course.
        assert "course_id" in listed["grading__gradebook__get"].input_schema["required"]

        asked = await mcp.call_tool(tool, args, allow_input_required=True)
        options = _form(asked, "pick").requested_schema["properties"]["course_id"]["oneOf"]
        assert {o["const"] for o in options} == {course["id"], other["id"]}
        assert any(o["title"].startswith("MAT186H1 · Calculus") for o in options)
        assert isinstance(asked, types.InputRequiredResult)
        # One assessment is not a batch: picking the course is the only question.
        done = await _answer(mcp, tool, args, asked, "pick", content={"course_id": other["id"]})
        assert done.is_error is False
    gradebook = await agent.call("GET", f"/courses/{other['id']}/gradebook")
    assert [a["title"] for a in gradebook["assessments"]] == ["Quiz 1"]


async def _import_with_a_duplicate(
    mcp: ClientSession, program: dict[str, Any], course: dict[str, Any]
) -> str:
    """An import draft of Lab 3 (already in the gradebook) and Lab 4."""
    created = await mcp.call_tool(
        "imports__session__create",
        {
            "program_id": program["id"],
            "source_kind": "agent",
            "target": {"kind": "course", "course_id": course["id"]},
        },
    )
    session_id = _payload(created)["id"]
    ref = f"course:{course['id']}"
    added = await mcp.call_tool(
        "imports__item__add_many",
        {
            "session_id": session_id,
            "items": [
                {"type": "assessment", "data": {"course_ref": ref, "title": t, "weight": 10}}
                for t in ("Lab 3", "Lab 4")
            ],
        },
    )
    assert added.is_error is False, _payload(added)
    return session_id


async def test_committing_an_import_asks_about_what_is_already_there(app: FastAPI, agent: Agent):
    program, course, _ = await agent.course_with_lab()
    token = await _token(agent, ["read", "write"])
    async with mcp_session(app, token, forms=True) as mcp:
        session_id = await _import_with_a_duplicate(mcp, program, course)
        tool, args = "imports__session__commit", {"session_id": session_id}
        asked = await mcp.call_tool(tool, args, allow_input_required=True)
        form = _form(asked, "confirm")
        [(key, prop)] = form.requested_schema["properties"].items()
        assert prop["title"] == "Lab 3"
        assert prop["default"] == "skip"
        assert isinstance(asked, types.InputRequiredResult)
        done = await _answer(mcp, tool, args, asked, "confirm", content={key: "add"})
        assert done.is_error is False, _payload(done)
    gradebook = await agent.call("GET", f"/courses/{course['id']}/gradebook")
    assert sorted(a["title"] for a in gradebook["assessments"]) == ["Lab 3", "Lab 3", "Lab 4"]


async def test_sem_asks_the_same_on_its_card(app: FastAPI, agent: Agent, model: FakeModel):
    program, course, _ = await agent.course_with_lab()
    token = await _token(agent, ["read", "write"])
    async with mcp_session(app, token) as mcp:
        session_id = await _import_with_a_duplicate(mcp, program, course)
    session = await agent.session()
    model.then(
        call("load_capability", {"id": "import-from-documents"}),
        call("imports.session.commit", {"session_id": session_id}),
    )
    [proposal] = events_named(await agent.send(session["id"], "Apply it"), "proposal")
    [conflict] = proposal["preview"]["conflicts"]
    assert (conflict["subject"], conflict["kind"], conflict["keep"]) == ("Lab 3", "duplicate", True)

    model.then(say("Done."))
    # A key the card did not show is ignored.
    await agent.decide(session["id"], proposal["id"], keep={conflict["key"]: False, "x": True})
    gradebook = await agent.call("GET", f"/courses/{course['id']}/gradebook")
    assert sorted(a["title"] for a in gradebook["assessments"]) == ["Lab 3", "Lab 3", "Lab 4"]


async def test_committing_one_new_item_still_asks(app: FastAPI, agent: Agent):
    program, course, _ = await agent.course_with_lab()
    token = await _token(agent, ["read", "write"])
    async with mcp_session(app, token, forms=True) as mcp:
        created = await mcp.call_tool(
            "imports__session__create",
            {
                "program_id": program["id"],
                "source_kind": "agent",
                "target": {"kind": "course", "course_id": course["id"]},
            },
        )
        session_id = _payload(created)["id"]
        item = {"course_ref": f"course:{course['id']}", "title": "Midterm", "weight": 30}
        added = await mcp.call_tool(
            "imports__item__add_many",
            {"session_id": session_id, "items": [{"type": "assessment", "data": item}]},
        )
        assert added.is_error is False, _payload(added)
        # Naming the one item (as a retry does) still asks: a commit always does.
        args = {"session_id": session_id, "item_ids": [_payload(added)["items"][0]["id"]]}
        asked = await mcp.call_tool("imports__session__commit", args, allow_input_required=True)
        assert not _form(asked, "confirm").requested_schema.get("properties")


def test_form_texts_have_the_same_keys_in_every_language() -> None:
    from semestra.modules.agent import mcp_elicit

    assert mcp_elicit.catalog("en").keys() == mcp_elicit.catalog("zh-CN").keys()
