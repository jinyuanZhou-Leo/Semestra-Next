"""Memory (M12 记忆): named records saved in conversations without a card, an index read once
per conversation with bodies read on demand, kept tidy in the background, never in temporary
chats."""

import sqlite3
from pathlib import Path
from typing import Any

import pytest
from alembic import command
from alembic.config import Config
from fastapi import FastAPI

from semestra.core.context import system_ctx
from semestra.core.errors import AppError
from semestra.core.jobs import run_periodic
from semestra.modules.agent import memory
from semestra.modules.agent.memory import MemoryOperation, MemoryUpdates
from semestra.modules.agent.models import AgentSession
from semestra.modules.agent.portability import (  # pyright: ignore[reportPrivateUsage]
    _memory,  # pyright: ignore[reportPrivateUsage]
    _v1_to_v2,  # pyright: ignore[reportPrivateUsage]
)
from semestra.modules.agent.tests.conftest import Agent, FakeModel, call, events_named, say
from semestra.modules.ai import Message
from semestra.testing import API_DIR, Clock, MakeUser

REMEMBER = "agent__memory__remember"
FORGET = "agent__memory__forget"
GET = "agent__memory__get"


async def _memories(agent: Agent) -> list[dict[str, Any]]:
    return (await agent.call("GET", "/agent/memories"))["items"]


def _remember(name: str, description: str | None = None, **extra: Any) -> Any:
    args: dict[str, Any] = {"name": name, **extra}
    if description is not None:
        args["description"] = description
    return call("agent.memory.remember", args)


async def test_remember_runs_without_a_card_and_reaches_the_next_conversation(
    agent: Agent, model: FakeModel
):
    session = await agent.session()
    model.then(
        _remember("bullet-points", "Prefers answers in bullet points.", type="user"),
        say("Noted."),
    )
    events = await agent.send(session["id"], "Remember that I like bullet points")
    assert events_named(events, "proposal") == []
    [result] = events_named(events, "tool_result")
    assert result["ok"] is True
    assert result["changed"] is True
    assert {REMEMBER, FORGET, GET} <= model.tools_of(0)
    assert "Nothing is saved yet." in model.instructions_of(0)
    [saved] = await _memories(agent)
    assert saved["name"] == "bullet-points"
    assert saved["description"] == "Prefers answers in bullet points."
    assert saved["type"] == "user"
    assert saved["body"] == ""
    assert saved["source_session_id"] == session["id"]
    # The chat shows what was remembered, live and after a reload, for its undo link.
    shown = {
        "id": saved["id"],
        "name": "bullet-points",
        "description": saved["description"],
        "action": "remembered",
    }
    assert result["memory"] == shown
    detail = await agent.detail(session["id"])
    blocks = [b for m in detail["messages"] for b in m["content"] if b["type"] == "tool_result"]
    assert blocks[0]["memory"] == shown

    # The same conversation keeps its snapshot (the prompt prefix does not change)...
    model.then(say("Sure."))
    await agent.send(session["id"], "thanks")
    assert "Nothing is saved yet." in model.instructions_of(-1)
    # ...a new one starts with the index.
    other = await agent.session()
    model.then(say("Hi."))
    await agent.send(other["id"], "hello")
    day = saved["updated_at"][:10]
    line = f'- [bullet-points] (user, {day}) "Prefers answers in bullet points."'
    assert line in model.instructions_of(-1)
    assert f"{line} +" not in model.instructions_of(-1)  # no body

    # Saving the same line under another name finds the existing memory: no undo, which
    # would delete the older one.
    model.then(
        _remember("bullets", "prefers answers in bullet points.", type="user"),
        say("Already noted."),
    )
    events = await agent.send(other["id"], "remember bullet points")
    [again] = events_named(events, "tool_result")
    assert again["ok"] is True
    assert "memory" not in again
    assert len(await _memories(agent)) == 1
    # The model is told which name already holds it, so it does not link a name that is not there.
    assert "Already saved as `bullet-points`" in str(model.results(-1)[0].content)

    # The same name updates it; the undo puts back what it replaced.
    model.then(
        _remember("bullet-points", "Prefers short bullet points.", body="At most five."),
        say("Updated."),
    )
    events = await agent.send(other["id"], "shorter please")
    [updated] = events_named(events, "tool_result")
    assert updated["memory"] == {
        **shown,
        "description": "Prefers short bullet points.",
        "action": "updated",
        "previous": {
            "name": "bullet-points",
            "type": "user",
            "description": "Prefers answers in bullet points.",
            "body": "",
        },
    }
    [now] = await _memories(agent)
    assert (now["id"], now["type"], now["body"]) == (saved["id"], "user", "At most five.")
    # Sending what it already says changes nothing and offers no undo.
    model.then(_remember("bullet-points", "Prefers short bullet points."), say("Same."))
    events = await agent.send(other["id"], "again")
    [same] = events_named(events, "tool_result")
    assert same["ok"] is True
    assert "memory" not in same

    model.then(call("agent.memory.forget", {"name": "bullet-points"}), say("Forgotten."))
    events = await agent.send(other["id"], "forget that")
    assert events_named(events, "proposal") == []
    [forgot] = events_named(events, "tool_result")
    assert forgot["memory"] == {
        **shown,
        "description": "Prefers short bullet points.",
        "action": "forgot",
    }
    assert await _memories(agent) == []


async def test_a_new_memory_needs_a_type_a_line_and_a_kebab_case_name(
    agent: Agent, model: FakeModel
):
    session = await agent.session()
    model.then(_remember("gpa-goal", "Wants a 3.7 GPA."), say("ok"))
    events = await agent.send(session["id"], "my goal is 3.7")
    [result] = events_named(events, "tool_result")
    assert result["error_code"] == "common.validation"
    model.then(_remember("GPA Goal", "Wants a 3.7 GPA.", type="project"), say("ok"))
    await agent.send(session["id"], "my goal is 3.7")
    assert await _memories(agent) == []


async def test_get_reads_the_body_and_the_memories_it_links_to(agent: Agent, model: FakeModel):
    session = await agent.session()
    model.then(
        _remember("major", "Majors in ECE.", type="user"),
        _remember(
            "exchange-credits",
            "Exchange term credits count at half weight.",
            type="reference",
            body="See [[major]] and [[program-rules]]. Source: the faculty handbook.",
        ),
        say("ok"),
    )
    await agent.send(session["id"], "remember these")
    other = await agent.session()
    model.then(call("agent.memory.get", {"name": "exchange-credits"}), say("Half weight."))
    await agent.send(other["id"], "how do exchange credits count?")
    assert '"Exchange term credits count at half weight." +' in model.instructions_of(-1)
    [read] = model.results(-1)
    content = str(read.content)
    assert "faculty handbook" in content
    assert "untrusted" in content.lower()  # read back as data, not instructions
    assert '{"name":"major","description":"Majors in ECE.","exists":true}' in content
    assert '{"name":"program-rules","exists":false}' in content

    model.then(call("agent.memory.get", {"name": "nothing-here"}), say("No such memory."))
    events = await agent.send(other["id"], "and the other one?")
    [missing] = events_named(events, "tool_result")
    assert missing["error_code"] == "common.not_found"


async def test_sensitive_details_are_not_saved(agent: Agent, model: FakeModel):
    session = await agent.session()
    model.then(
        _remember("student-number", "My student number is 1004567890", type="user"),
        _remember("bank", "Has a bank.", type="user", body="Bank account at RBC."),
        _remember("student-1004567890", "Has a student number.", type="user"),
        say("I won't keep that."),
    )
    events = await agent.send(session["id"], "remember my student number 1004567890")
    results = events_named(events, "tool_result")
    assert [r["error_code"] for r in results] == ["agent.memory_sensitive"] * 3
    assert await _memories(agent) == []
    for text in ("My password is hunter2", "Takes medication for ADHD", "我的银行卡是招行"):
        assert memory.is_sensitive(text)
    for text in (
        "Wants a 3.7 GPA this term",
        "Majors in physical therapy",
        "Works as a department secretary",
        "Researching tokenization for an NLP course",
        "专业是疾病控制",
        "Applying for a low-income student scholarship",
    ):
        assert not memory.is_sensitive(text), text


async def test_temporary_chats_and_memory_turned_off_neither_read_nor_write(
    agent: Agent, model: FakeModel
):
    session = await agent.session()
    model.then(_remember("wednesday-job", "Works Wednesday nights.", type="user"), say("ok"))
    await agent.send(session["id"], "I work Wednesday nights, remember that")
    assert len(await _memories(agent)) == 1

    temp = await agent.call("POST", "/agent/sessions", json={"temporary": True})
    assert temp["temporary"] is True
    model.then(say("Hi."))
    await agent.send(temp["id"], "hello")
    assert not {REMEMBER, FORGET, GET} & model.tools_of(-1)
    assert "Works Wednesday nights." not in model.instructions_of(-1)
    assert "# Memory" not in model.instructions_of(-1)

    await agent.call("PATCH", "/me/settings/memory", json={"values": {"enabled": False}})
    # The conversation that started with memory on keeps its tools (the prompt cache), but
    # nothing is saved any more.
    model.then(_remember("tea", "Likes tea.", type="user"), say("ok"))
    events = await agent.send(session["id"], "I like tea, remember that")
    assert REMEMBER in model.tools_of(-2)
    [refused] = events_named(events, "tool_result")
    assert refused["error_code"] == "agent.memory_off"
    assert [m["description"] for m in await _memories(agent)] == ["Works Wednesday nights."]

    off = await agent.session()
    model.then(say("Hi."))
    await agent.send(off["id"], "hello")
    assert not {REMEMBER, FORGET, GET} & model.tools_of(-1)
    assert "# Memory" not in model.instructions_of(-1)


async def test_the_settings_page_can_edit_delete_and_clear(
    agent: Agent, model: FakeModel, clock: Clock
):
    session = await agent.session()
    model.then(
        _remember("preferred-name", "Goes by Leo.", type="user"),
        _remember("major", "Majors in ECE.", type="user"),
        say("ok"),
    )
    await agent.send(session["id"], "call me Leo; I'm in ECE")
    leo = next(m for m in await _memories(agent) if m["name"] == "preferred-name")
    updated = await agent.call(
        "PATCH",
        f"/agent/memories/{leo['id']}",
        json={
            "name": "name-to-use",
            "type": "feedback",
            "description": "Goes by Leo, not Jinyuan.",
            "body": "Why: it is what friends call him.",
        },
    )
    assert (updated["name"], updated["type"], updated["body"]) == (
        "name-to-use",
        "feedback",
        "Why: it is what friends call him.",
    )
    assert updated["description"] == "Goes by Leo, not Jinyuan."
    err = await agent.call("PATCH", f"/agent/memories/{leo['id']}", 409, json={"name": "major"})
    assert err["error"]["code"] == "agent.memory_name_taken"
    err = await agent.call(
        "PATCH", f"/agent/memories/{leo['id']}", 422, json={"body": "password: abc"}
    )
    assert err["error"]["code"] == "agent.memory_sensitive"
    err = await agent.call("PATCH", f"/agent/memories/{leo['id']}", 422, json={"name": "Leo"})
    assert err["error"]["code"] == "common.validation"
    # A refused change leaves the memory as it was.
    kept = next(m for m in await _memories(agent) if m["id"] == leo["id"])
    assert kept["body"] == "Why: it is what friends call him."
    # Sending what it already says (an undo clicked twice) does not touch its date.
    clock.advance(days=2)
    same = await agent.call(
        "PATCH", f"/agent/memories/{leo['id']}", json={"name": "name-to-use", "type": "feedback"}
    )
    assert same["updated_at"] == kept["updated_at"]
    await agent.call("DELETE", f"/agent/memories/{leo['id']}")
    assert [m["name"] for m in await _memories(agent)] == ["major"]
    await agent.call("DELETE", f"/agent/memories/{leo['id']}", 404)

    assert (await agent.call("POST", "/agent/memories:clear", json={}))["deleted"] == 1
    assert await _memories(agent) == []


async def test_imported_memories_are_converted_checked_and_kept_to_the_limit(
    app: FastAPI, make_user: MakeUser
):
    user = await make_user()
    async with system_ctx(app.state, user.id) as ctx:
        long = ("Works Wednesday nights at the campus library, " * 4).strip()
        old = {
            "id": "0193a7c2-1111-7000-8000-00000000abcd",
            "category": "constraint",
            "content": long,
            "created_at": "2026-10-20T00:00:00+00:00",
        }
        [upgraded] = _v1_to_v2({"memories": [old]}, None)["memories"]  # pyright: ignore[reportArgumentType]
        converted = await _memory(ctx, upgraded, None)  # pyright: ignore[reportArgumentType]
        assert converted is not None
        assert converted["name"] == "memory-0000abcd"
        assert converted["type"] == "project"
        assert len(converted["description"]) <= memory.MAX_DESCRIPTION
        assert converted["description"].endswith("…")
        assert converted["body"] == long  # nothing is lost
        row = {"id": "x", "name": "major", "type": "user", "description": "ECE", "body": ""}
        assert await _memory(ctx, row, None) == row  # pyright: ignore[reportArgumentType]
        for bad in (
            {**row, "name": "Major"},
            {**row, "type": "goal"},
            {**row, "description": "Student number 1004567890"},
        ):
            assert await _memory(ctx, bad, None) is None  # pyright: ignore[reportArgumentType]
        for i in range(memory.MAX_MEMORIES):
            await memory.save(ctx, name=f"m{i}", type="user", description=f"Fact {i}", body=None)
        # Full: a new name is left out, an existing one still replaces its memory.
        assert await _memory(ctx, row, None) is None  # pyright: ignore[reportArgumentType]
        same = {**row, "name": "m0", "description": "Fact zero"}
        assert await _memory(ctx, same, None) == same  # pyright: ignore[reportArgumentType]


async def test_two_calls_saving_one_new_name_do_not_crash(
    app: FastAPI, make_user: MakeUser, monkeypatch: pytest.MonkeyPatch
):
    user = await make_user()
    async with system_ctx(app.state, user.id) as ctx:
        await memory.save(ctx, name="major", type="user", description="Majors in ECE.", body=None)
        await ctx.db.commit()

        async def missed(ctx: Any, name: str) -> None:  # the other call has not saved it yet
            return None

        monkeypatch.setattr(memory, "by_name", missed)
        with pytest.raises(AppError) as err:
            await memory.save(
                ctx, name="major", type="user", description="Electrical engineering.", body=None
            )
        assert err.value.code == "agent.memory_name_taken"


def test_migration_turns_old_memories_into_named_records(tmp_path: Path):
    path = tmp_path / "m.db"
    cfg = Config(str(API_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_DIR / "migrations"))
    cfg.attributes["database_url"] = f"sqlite+aiosqlite:///{path}"
    command.upgrade(cfg, "0018")
    db = sqlite3.connect(path)  # foreign keys are off: no user row needed
    long = ("Works Wednesday nights at the campus library, " * 4).strip()  # 183 characters
    for i, (category, content) in enumerate(
        [("preference", "Goes by Leo."), ("goal", "Wants a 3.7 GPA."), ("constraint", long)]
    ):
        db.execute(
            "INSERT INTO agent_memories (id, user_id, category, content, created_at, updated_at) "
            "VALUES (?, 'u1', ?, ?, '2026-10-20 00:00:00', '2026-10-20 00:00:00')",
            (f"0193a7c2-0000-7000-8000-00000000000{i}", category, content),
        )
    db.commit()
    db.close()
    command.upgrade(cfg, "head")
    db = sqlite3.connect(path)
    rows = db.execute(
        "SELECT name, type, description, body FROM agent_memories ORDER BY id"
    ).fetchall()
    assert rows[:2] == [
        ("memory-00000000", "user", "Goes by Leo.", ""),
        ("memory-00000001", "project", "Wants a 3.7 GPA.", ""),
    ]
    # Longer than the new line: the line is cut, the whole text is kept as the body; it is the
    # same split the import of an old archive makes.
    name, kind, description, body = rows[2]
    assert (name, kind, body) == ("memory-00000002", "project", long)
    assert len(description) <= memory.MAX_DESCRIPTION
    assert (description, body) == memory.split_line(long)
    db.close()
    command.downgrade(cfg, "0018")
    db = sqlite3.connect(path)
    assert db.execute("SELECT category, content FROM agent_memories ORDER BY id").fetchall()[
        :2
    ] == [("context", "Goes by Leo."), ("goal", "Wants a 3.7 GPA.")]
    db.close()


def test_the_index_dates_a_memory_in_the_work_context_zone():
    from datetime import UTC, datetime
    from zoneinfo import ZoneInfo

    from semestra.modules.agent.models import AgentMemory

    at = datetime(2026, 10, 21, 2, 0, tzinfo=UTC)  # still the 20th in Toronto
    row = AgentMemory(
        name="major", type="user", description="ECE", body="x", created_at=at, updated_at=at
    )
    assert memory.index_line(row, ZoneInfo("America/Toronto")) == (
        '- [major] (user, 2026-10-20) "ECE" +'
    )
    assert memory.index_line(row) == '- [major] (user, 2026-10-21) "ECE" +'


DREAM = "agent.memory.dream"


async def _chat(agent: Agent, model: FakeModel, text: str, reply: str = "Noted.") -> str:
    """A finished conversation of one exchange; returns its id."""
    session = await agent.session()
    model.then(say(reply))
    await agent.send(session["id"], text)
    return session["id"]


async def _level(agent: Agent, level: str) -> None:
    await agent.call("PATCH", "/me/settings/memory", json={"values": {"auto_dream": level}})


async def test_auto_dream_waits_for_a_day_and_enough_conversations(
    app: FastAPI, agent: Agent, model: FakeModel, clock: Clock
):
    long = "Chose ECE for robotics. " * 30  # longer than any excerpt: it is read in full
    model.then(_remember("major", "Majors in ECE.", type="user", body=long), say("ok"))
    first = await agent.session()
    await agent.send(first["id"], "I'm majoring in ECE")
    model.then(_remember("ece-major", "Studies ECE.", type="user"), say("ok"))
    await agent.send(first["id"], "remember I study ECE")
    for i in range(3):
        await _chat(agent, model, f"note {i}", reply="Good luck!")

    seen: list[list[Message]] = []

    async def memory_model(ctx: Any, messages: list[Message]) -> MemoryUpdates:
        seen.append(messages)
        return MemoryUpdates(
            operations=[
                # A merge: save one, forget the duplicate.
                MemoryOperation(action="save", name="major", description="Majors in ECE (2026)."),
                MemoryOperation(action="delete", name="ece-major"),
                MemoryOperation(
                    action="save", name="card", type="user", description="Card 4111 1111 1111 1111"
                ),
                MemoryOperation(action="save", name="Bad Name", type="user", description="x"),
            ]
        )

    app.state.agent.memory_model = memory_model
    clock.advance(hours=1)
    # Four conversations: the default (medium) waits for five.
    await run_periodic(app.state, DREAM)
    assert seen == []
    # A conversation still going on does not count yet.
    fifth = await _chat(agent, model, "my goal is a 3.7")
    await run_periodic(app.state, DREAM)
    assert seen == []

    clock.advance(minutes=31)
    await run_periodic(app.state, DREAM)
    assert len(seen) == 1
    prompt = str(seen[0][1].content[0])
    assert long.strip() in prompt  # every body in full
    for words in ("my goal is a 3.7", "note 2", "majoring in ECE"):
        assert words in prompt
    assert "Today is " in prompt
    assert "Good luck!" not in prompt  # only the user's own words
    rows = {m["name"]: m for m in await _memories(agent)}
    assert sorted(rows) == ["major"]  # merged; the card number and the bad name were dropped
    assert rows["major"]["description"] == "Majors in ECE (2026)."
    assert rows["major"]["body"] == long.strip()  # no body sent: kept as it was

    # Five more within the day: the next dream waits until a day has passed.
    model.then(say("ok"))
    await agent.send(fifth, "and I like chemistry")
    for i in range(4):
        await _chat(agent, model, f"more {i}")
    clock.advance(hours=1)
    await run_periodic(app.state, DREAM)
    assert len(seen) == 1
    clock.advance(hours=23)
    await run_periodic(app.state, DREAM)
    assert len(seen) == 2
    prompt = str(seen[1][1].content[0])
    assert "I like chemistry" in prompt
    assert "my goal is a 3.7" not in prompt  # read last time

    # A temporary chat is never read.
    temp = await agent.call("POST", "/agent/sessions", json={"temporary": True})
    model.then(say("Hi."))
    await agent.send(temp["id"], "I love chemistry")
    clock.advance(days=2)
    await run_periodic(app.state, DREAM)
    assert len(seen) == 2


async def test_the_setting_picks_how_many_conversations_a_dream_waits_for(
    app: FastAPI, agent: Agent, model: FakeModel, clock: Clock
):
    calls: list[int] = []

    async def memory_model(ctx: Any, messages: list[Message]) -> MemoryUpdates:
        calls.append(1)
        return MemoryUpdates()

    app.state.agent.memory_model = memory_model
    await _level(agent, "high")
    await _chat(agent, model, "one")
    clock.advance(hours=1)
    await run_periodic(app.state, DREAM)
    assert calls == []
    await _chat(agent, model, "two")
    clock.advance(hours=1)
    await run_periodic(app.state, DREAM)
    assert calls == [1]

    await _level(agent, "low")
    for i in range(9):
        await _chat(agent, model, f"chat {i}")
    clock.advance(days=1)
    await run_periodic(app.state, DREAM)
    assert calls == [1]
    await _chat(agent, model, "the tenth")
    clock.advance(hours=1)
    await run_periodic(app.state, DREAM)
    assert calls == [1, 1]


async def test_a_dream_writes_nothing_until_the_model_answers(
    app: FastAPI, agent: Agent, model: FakeModel, clock: Clock
):
    await _level(agent, "high")
    first = await _chat(agent, model, "I'm majoring in ECE")
    await _chat(agent, model, "and minoring in math")
    before = await _stored(app, first)

    calls: list[bool] = []

    async def failing(ctx: Any, messages: list[Message]) -> MemoryUpdates:
        # A pending write here would hold SQLite's write lock for the whole model call.
        raw = await (await ctx.db.connection()).get_raw_connection()
        calls.append(raw.driver_connection.in_transaction)
        raise AppError("ai.provider_unreachable", 502)

    app.state.agent.memory_model = failing
    clock.advance(hours=1)
    await run_periodic(app.state, DREAM)
    assert calls == [False]
    assert await _stored(app, first) == before

    # The provider being down is tried again next round, with the same words.
    seen: list[str] = []

    async def working(ctx: Any, messages: list[Message]) -> MemoryUpdates:
        seen.append(str(messages[1].content[0]))
        return MemoryUpdates(
            operations=[
                MemoryOperation(
                    action="save", name="major", type="user", description="Majors in ECE."
                )
            ]
        )

    app.state.agent.memory_model = working
    clock.advance(hours=1)
    await run_periodic(app.state, DREAM)
    assert len(seen) == 1
    assert "majoring in ECE" in seen[0]
    assert "minoring in math" in seen[0]
    assert [m["name"] for m in await _memories(agent)] == ["major"]


async def test_a_dream_that_would_fail_again_is_given_up(
    app: FastAPI, agent: Agent, model: FakeModel, clock: Clock
):
    await _level(agent, "high")
    await _chat(agent, model, "I'm majoring in ECE")
    await _chat(agent, model, "and minoring in math")
    calls: list[int] = []

    async def invalid(ctx: Any, messages: list[Message]) -> MemoryUpdates:
        calls.append(1)
        raise AppError("ai.output_invalid", 502)

    app.state.agent.memory_model = invalid
    clock.advance(hours=1)
    for _ in range(3):
        await run_periodic(app.state, DREAM)
        clock.advance(days=1)
    assert len(calls) == 1


async def test_a_conversation_held_with_memory_off_is_never_read(
    app: FastAPI, agent: Agent, model: FakeModel, clock: Clock
):
    await _level(agent, "high")
    await agent.call("PATCH", "/me/settings/memory", json={"values": {"enabled": False}})
    await _chat(agent, model, "I'm majoring in ECE")
    await _chat(agent, model, "I like chemistry")
    # Turned back on before the conversations go idle.
    await agent.call("PATCH", "/me/settings/memory", json={"values": {"enabled": True}})

    seen: list[list[Message]] = []

    async def memory_model(ctx: Any, messages: list[Message]) -> MemoryUpdates:
        seen.append(messages)
        return MemoryUpdates()

    app.state.agent.memory_model = memory_model
    clock.advance(hours=1)
    await run_periodic(app.state, DREAM)
    assert seen == []
    await _chat(agent, model, "I'm a second year")
    await _chat(agent, model, "in Toronto")
    clock.advance(hours=1)
    await run_periodic(app.state, DREAM)
    [messages] = seen
    prompt = str(messages[1].content[0])
    assert "second year" in prompt
    assert "majoring in ECE" not in prompt


async def test_a_body_is_replaced_only_after_it_was_read(agent: Agent, model: FakeModel):
    session = await agent.session()
    model.then(_remember("major", "Majors in ECE.", type="user", body="For robotics."), say("ok"))
    await agent.send(session["id"], "I'm majoring in ECE for robotics")
    # Written in this conversation: it knows the body.
    model.then(_remember("major", "Majors in ECE.", body="For robotics and AI."), say("ok"))
    await agent.send(session["id"], "and AI")
    other = await agent.session()
    model.then(_remember("major", "Majors in ECE.", body="Likes circuits."), say("ok"))
    events = await agent.send(other["id"], "I like circuits")
    [refused] = events_named(events, "tool_result")
    assert refused["ok"] is False
    assert "agent__memory__get" in str(model.results(-1)[0].content)
    [kept] = await _memories(agent)
    assert kept["body"] == "For robotics and AI."
    # The description alone can change without reading.
    model.then(_remember("major", "Majors in ECE (year 2)."), say("ok"))
    await agent.send(other["id"], "I'm in year 2")
    model.then(
        call("agent.memory.get", {"name": "major"}),
        _remember("major", "Majors in ECE (year 2).", body="For robotics and AI; likes circuits."),
        say("ok"),
    )
    await agent.send(other["id"], "remember circuits")
    [now] = await _memories(agent)
    assert now["body"] == "For robotics and AI; likes circuits."


async def _stored(app: FastAPI, session_id: str) -> tuple[Any, ...]:
    async with app.state.session_factory() as db:
        row = await db.get(AgentSession, session_id)
        assert row is not None
        return (row.state, row.memory_processed_at, row.updated_at)
