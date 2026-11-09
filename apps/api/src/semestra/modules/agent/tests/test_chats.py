"""Sem reading the user's other conversations (M12 §4.3), and compacting when asked (§3.4)."""

import json
from typing import Any

from fastapi import FastAPI

from semestra.modules.agent.tests.conftest import Agent, FakeModel, call, events_named, say

SEARCH = "agent__session__search"
READ = "agent__session__read"


def _result(model: FakeModel, name: str) -> dict[str, Any]:
    part = [r for r in model.results() if r.tool_name == name][-1]
    text = str(part.content)
    return json.loads(text[text.index("{") : text.rindex("}") + 1])


async def test_search_and_read_stay_in_the_program_and_skip_temporary_chats(
    agent: Agent, model: FakeModel
):
    program = await agent.program()
    other = await agent.call("POST", "/programs", json={"name": "MEng", "timezone": "UTC"})
    here = {"program_id": program["id"]}

    old = await agent.session(here)
    model.then(call("academics.term.list", {}, text="Checking."), say("先修高数 再修物理。"))
    await agent.send(old["id"], "选课顺序怎么排")
    elsewhere = await agent.session({"program_id": other["id"]})
    model.then(say("高数在秋季。"))
    await agent.send(elsewhere["id"], "高数什么时候上")
    temp = await agent.call("POST", "/agent/sessions", json={"scope": here, "temporary": True})
    model.then(say("高数可以免修。"))
    await agent.send(temp["id"], "高数能免修吗")
    # Temporary conversations have no chat tools.
    assert not {SEARCH, READ} & model.tools_of(-1)

    now = await agent.session(here)
    model.then(call("agent.session.search", {"query": "高数"}), say("Found it."))
    await agent.send(now["id"], "我们之前说过高数吗")
    found = _result(model, SEARCH)["items"]
    # Only the other conversation of this Program: not this one, the temporary one or the
    # other Program's. A two-character Chinese word is found.
    assert [c["id"] for c in found] == [old["id"]]
    [match] = found[0]["matches"]
    assert match["role"] == "assistant"
    # The answer can cite the match: a badge that opens that conversation.
    [cited] = _result(model, SEARCH)["citations"]
    assert cited["id"] == f"chat:{old['id']}:{match['message_id']}"
    assert cited["url"] == f"/p/{program['id']}/assistant/{old['id']}"
    assert "先修高数" in match["excerpt"]
    assert found[0]["started_with"] == "选课顺序怎么排"

    # A bare date is a day in the Program's zone; the range applies to title matches too.
    model.then(
        call("agent.session.search", {"query": "高数 Lab", "before": "2020-01-01"}), say("None.")
    )
    await agent.send(now["id"], "很久以前呢")
    assert _result(model, SEARCH)["items"] == []

    model.then(
        call("agent.session.read", {"id": old["id"], "from_message": match["message_id"]}),
        say("ok"),
    )
    await agent.send(now["id"], "细说")
    read = _result(model, READ)
    assert [(m["role"], m["text"]) for m in read["messages"]] == [
        ("user", "选课顺序怎么排"),
        ("assistant", "Checking."),
        ("assistant", "先修高数 再修物理。"),
    ]
    assert read["messages"][1]["tools"] == ["academics.term.list"]

    model.then(call("agent.session.read", {"id": temp["id"]}), say("ok"))
    events = await agent.send(now["id"], "那段临时对话呢")
    [refused] = events_named(events, "tool_result")
    assert refused["error_code"] == "common.not_found"


async def test_chat_search_turned_off(agent: Agent, model: FakeModel):
    session = await agent.session()
    model.then(say("Hi."))
    await agent.send(session["id"], "hello")
    assert {SEARCH, READ} <= model.tools_of(-1)

    await agent.call("PATCH", "/me/settings/memory", json={"values": {"search_chats": False}})
    # The conversation keeps its tools (the prompt cache), but they refuse...
    model.then(call("agent.session.search", {}), say("It is off."))
    events = await agent.send(session["id"], "what did we talk about before?")
    [refused] = events_named(events, "tool_result")
    assert refused["error_code"] == "agent.chat_search_off"
    # ...and a new conversation does not have them.
    later = await agent.session()
    model.then(say("Hi."))
    await agent.send(later["id"], "good morning")
    assert not {SEARCH, READ} & model.tools_of(-1)


async def test_compact_conversation_summarizes_the_earlier_turns_within_the_turn(
    app: FastAPI, agent: Agent, model: FakeModel
):
    summaries: list[str] = []

    async def summarize(ctx: Any, messages: Any) -> str:
        summaries.append(" ".join(str(m.content) for m in messages))
        return "they study for the midterm"

    app.state.agent.summarize = summarize
    session = await agent.session()
    model.then(say("Good luck."))
    await agent.send(session["id"], "I have a midterm on Friday")

    model.then(call("compact_conversation", {"focus": "the midterm"}), say("Compacted."))
    events = await agent.send(session["id"], "please compact our chat")
    [sent] = summaries
    assert "I have a midterm on Friday" in sent
    assert "the midterm" in sent
    assert events_named(events, "compaction")[-1]["status"] == "done"
    # The next request of the same turn already carries the summary instead of the old turn.
    assert "they study for the midterm" in model.text_of(-1)
    assert "Good luck." not in model.text_of(-1)
    detail = await agent.detail(session["id"])
    assert detail["compaction"]["summary"] == "they study for the midterm"
