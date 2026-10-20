"""Memory (M12 记忆): saved in conversations without a card, read once per conversation, kept
tidy in the background, never in temporary chats."""

from typing import Any

from fastapi import FastAPI

from semestra.core.jobs import run_periodic
from semestra.modules.agent import memory
from semestra.modules.agent.memory import MemoryOperation, MemoryUpdates
from semestra.modules.agent.tests.conftest import Agent, FakeModel, call, events_named, say
from semestra.modules.ai import Message
from semestra.testing import Clock

REMEMBER = "agent__memory__remember"
FORGET = "agent__memory__forget"


async def _memories(agent: Agent) -> list[dict[str, Any]]:
    return (await agent.call("GET", "/agent/memories"))["items"]


async def test_remember_runs_without_a_card_and_reaches_the_next_conversation(
    agent: Agent, model: FakeModel
):
    session = await agent.session()
    model.then(
        call(
            "agent.memory.remember",
            {"content": "Prefers answers in bullet points.", "category": "preference"},
        ),
        say("Noted."),
    )
    events = await agent.send(session["id"], "Remember that I like bullet points")
    assert events_named(events, "proposal") == []
    [result] = events_named(events, "tool_result")
    assert result["ok"] is True
    assert result["changed"] is True
    assert REMEMBER in model.tools_of(0)
    assert FORGET in model.tools_of(0)
    assert "Nothing is saved yet." in model.instructions_of(0)
    [saved] = await _memories(agent)
    assert saved["content"] == "Prefers answers in bullet points."
    assert saved["category"] == "preference"
    # The chat shows what was remembered, live and after a reload, for its undo link.
    shown = {"id": saved["id"], "content": saved["content"]}
    assert result["memory"] == shown
    detail = await agent.detail(session["id"])
    blocks = [b for m in detail["messages"] for b in m["content"] if b["type"] == "tool_result"]
    assert blocks[0]["memory"] == shown

    # The same conversation keeps its snapshot (the prompt prefix does not change)...
    model.then(say("Sure."))
    await agent.send(session["id"], "thanks")
    assert "Nothing is saved yet." in model.instructions_of(-1)
    # ...a new one starts with the memory.
    other = await agent.session()
    model.then(say("Hi."))
    await agent.send(other["id"], "hello")
    assert f'[{saved["id"]}] (preference) "Prefers answers in bullet points."' in (
        model.instructions_of(-1)
    )

    model.then(call("agent.memory.forget", {"id": saved["id"]}), say("Forgotten."))
    events = await agent.send(other["id"], "forget that")
    assert events_named(events, "proposal") == []
    assert await _memories(agent) == []


async def test_sensitive_details_are_not_saved(agent: Agent, model: FakeModel):
    session = await agent.session()
    model.then(
        call(
            "agent.memory.remember",
            {"content": "My student number is 1004567890", "category": "context"},
        ),
        say("I won't keep that."),
    )
    events = await agent.send(session["id"], "remember my student number 1004567890")
    [result] = events_named(events, "tool_result")
    assert result["error_code"] == "agent.memory_sensitive"
    assert await _memories(agent) == []
    for text in ("My password is hunter2", "Takes medication for ADHD", "我的银行卡是招行"):
        assert memory.is_sensitive(text)
    assert not memory.is_sensitive("Wants a 3.7 GPA this term")


async def test_temporary_chats_and_memory_turned_off_neither_read_nor_write(
    agent: Agent, model: FakeModel
):
    session = await agent.session()
    model.then(
        call(
            "agent.memory.remember",
            {"content": "Works Wednesday nights.", "category": "constraint"},
        ),
        say("ok"),
    )
    await agent.send(session["id"], "I work Wednesday nights, remember that")
    assert len(await _memories(agent)) == 1

    temp = await agent.call("POST", "/agent/sessions", json={"temporary": True})
    assert temp["temporary"] is True
    model.then(say("Hi."))
    await agent.send(temp["id"], "hello")
    assert REMEMBER not in model.tools_of(-1)
    assert "Works Wednesday nights." not in model.instructions_of(-1)
    assert "# Memory" not in model.instructions_of(-1)

    await agent.call("PATCH", "/settings/memory", json={"values": {"enabled": False}})
    off = await agent.session()
    model.then(say("Hi."))
    await agent.send(off["id"], "hello")
    assert REMEMBER not in model.tools_of(-1)
    assert "# Memory" not in model.instructions_of(-1)


async def test_the_settings_page_can_edit_delete_and_clear(agent: Agent, model: FakeModel):
    session = await agent.session()
    model.then(
        call("agent.memory.remember", {"content": "Goes by Leo.", "category": "preference"}),
        say("ok"),
    )
    await agent.send(session["id"], "call me Leo")
    [saved] = await _memories(agent)
    updated = await agent.call(
        "PATCH", f"/agent/memories/{saved['id']}", json={"content": "Goes by Leo, not Jinyuan."}
    )
    assert updated["content"] == "Goes by Leo, not Jinyuan."
    err = await agent.call(
        "PATCH", f"/agent/memories/{saved['id']}", 422, json={"content": "password: abc"}
    )
    assert err["error"]["code"] == "agent.memory_sensitive"
    await agent.call("DELETE", f"/agent/memories/{saved['id']}")
    assert await _memories(agent) == []
    await agent.call("DELETE", f"/agent/memories/{saved['id']}", 404)

    for text in ("Major in ECE.", "Wants a 3.7 GPA."):
        model.then(
            call("agent.memory.remember", {"content": text, "category": "context"}), say("ok")
        )
        await agent.send(session["id"], text)
    assert (await agent.call("POST", "/agent/memories:clear", json={}))["deleted"] == 2
    assert await _memories(agent) == []


async def test_idle_conversations_are_consolidated_once(
    app: FastAPI, agent: Agent, model: FakeModel, clock: Clock
):
    session = await agent.session()
    model.then(
        call("agent.memory.remember", {"content": "Wants a 3.5 GPA.", "category": "goal"}),
        say("ok"),
    )
    await agent.send(session["id"], "my goal is a 3.5")
    [old] = await _memories(agent)
    model.then(say("Good luck!"))
    await agent.send(session["id"], "actually make that 3.7, and I'm majoring in ECE")

    seen: list[list[Message]] = []

    async def memory_model(ctx: Any, messages: list[Message]) -> MemoryUpdates:
        seen.append(messages)
        return MemoryUpdates(
            operations=[
                MemoryOperation(
                    action="update",
                    memory_id=old["id"],
                    content="Wants a 3.7 GPA.",
                    category="goal",
                ),
                MemoryOperation(action="add", category="context", content="Majors in ECE."),
                MemoryOperation(
                    action="add", category="context", content="Card 4111 1111 1111 1111"
                ),
            ]
        )

    app.state.agent.memory_model = memory_model
    # Not idle long enough yet.
    clock.advance(minutes=10)
    await run_periodic(app.state, "agent.memory.consolidate")
    assert seen == []

    clock.advance(minutes=25)
    await run_periodic(app.state, "agent.memory.consolidate")
    assert len(seen) == 1
    prompt = str(seen[0][1].content[0])
    assert old["id"] in prompt
    assert "make that 3.7" in prompt
    contents = sorted(m["content"] for m in await _memories(agent))
    assert contents == ["Majors in ECE.", "Wants a 3.7 GPA."]  # the card number was dropped

    # Nothing new since: not read again.
    clock.advance(hours=1)
    await run_periodic(app.state, "agent.memory.consolidate")
    assert len(seen) == 1

    # A temporary chat is never read.
    temp = await agent.call("POST", "/agent/sessions", json={"temporary": True})
    model.then(say("Hi."))
    await agent.send(temp["id"], "I love chemistry")
    clock.advance(hours=1)
    await run_periodic(app.state, "agent.memory.consolidate")
    assert len(seen) == 1
