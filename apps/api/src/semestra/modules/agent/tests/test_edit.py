"""Editing a sent message (M12 实现说明): the later conversation is dropped and answered again."""

from typing import Any

from fastapi import FastAPI

from semestra.modules.agent.tests.conftest import Agent, FakeModel, call, events_named, say


def edit_url(session_id: str, message_id: str) -> str:
    return f"/agent/sessions/{session_id}/messages/{message_id}:edit"


async def test_editing_drops_what_came_after_and_answers_again(agent: Agent, model: FakeModel):
    _, _, lab = await agent.course_with_lab()
    session = await agent.session()
    model.then(say("Hello!"))
    await agent.send(session["id"], "hi")
    model.then(
        call("grading.assessment.update", {"assessment_id": lab["id"], "score_percentage": 50})
    )
    [proposal] = events_named(await agent.send(session["id"], "50 on lab 3"), "proposal")
    first = (await agent.detail(session["id"]))["messages"][0]

    model.then(say("Hello again."))
    events = await agent.stream(edit_url(session["id"], first["id"]), {"text": "hello there"})

    assert "".join(d["text"] for d in events_named(events, "text_delta")) == "Hello again."
    # The model saw only the edited message.
    [prompt] = model.prompts(-1)
    assert prompt[-1] == "hello there"

    detail = await agent.detail(session["id"])
    assert [m["role"] for m in detail["messages"]] == ["user", "assistant"]
    assert detail["messages"][0]["id"] == first["id"]
    assert detail["messages"][0]["content"] == [{"type": "text", "text": "hello there"}]
    assert proposal["id"] not in {p["id"] for p in detail["proposals"]}
    assert detail["proposals"] == []


async def test_only_the_users_own_messages_can_be_edited(agent: Agent, model: FakeModel):
    session = await agent.session()
    model.then(say("Hello!"))
    await agent.send(session["id"], "hi")
    user, answer = (await agent.detail(session["id"]))["messages"]

    out = await agent.stream(edit_url(session["id"], answer["id"]), {"text": "x"}, status=404)
    assert out[0][1]["error"]["code"] == "common.not_found"
    out = await agent.stream(edit_url(session["id"], user["id"]), {"text": "  "}, status=422)
    assert out[0][1]["error"]["code"] == "common.validation"

    other = await agent.session()
    out = await agent.stream(edit_url(other["id"], user["id"]), {"text": "x"}, status=404)
    assert out[0][1]["error"]["code"] == "common.not_found"
    assert len((await agent.detail(session["id"]))["messages"]) == 2


async def test_editing_keeps_the_skill_and_forgets_a_stale_summary(
    app: FastAPI, agent: Agent, model: FakeModel
):
    session = await agent.session()
    user_id = (await agent.call("GET", "/account/me"))["id"]
    from semestra.modules.agent import service
    from semestra.modules.agent.runtime import agent_ctx

    async with agent_ctx(app.state, user_id, scope=None) as ctx:
        row = await service.get_session_row(ctx, session["id"])
        first = service.add_message(
            ctx,
            row,
            "user",
            [{"type": "skill", "name": "s", "title": {"en": "S"}, "body": "do it"}],
        )
        answer = service.add_message(ctx, row, "assistant", [{"type": "text", "text": "ok"}])
        await ctx.db.flush()
        row.state = {"summary": "old", "summarized_until": answer.id}
        await ctx.db.commit()
        first_id = first.id

    model.then(say("Done."))
    await agent.stream(edit_url(session["id"], first_id), {"text": "for APS105"})

    detail = await agent.detail(session["id"])
    assert [b["type"] for b in detail["messages"][0]["content"]] == ["skill", "text"]
    async with agent_ctx(app.state, user_id, scope=None) as ctx:
        state = (await service.get_session_row(ctx, session["id"])).state
    assert "summary" not in state
    assert "summarized_until" not in state


async def test_writes_already_done_in_dropped_turns_are_told_to_the_model(
    agent: Agent, model: FakeModel
):
    _, course, lab = await agent.course_with_lab()
    session = await agent.session()
    args = {"assessment_id": lab["id"], "score_percentage": 50}
    model.then(call("grading.assessment.update", args))
    [proposal] = events_named(await agent.send(session["id"], "50 on lab 3"), "proposal")
    model.then(say("Saved."))
    await agent.decide(session["id"], proposal["id"])
    first = (await agent.detail(session["id"]))["messages"][0]

    model.then(say("Done before."))
    await agent.stream(edit_url(session["id"], first["id"]), {"text": "55 on lab 3"})

    [user] = model.prompts(-1)
    texts = [p for p in user if isinstance(p, str)]
    note = next(t for t in texts if "Already done" in t)
    assert "grading.assessment.update" in note
    assert lab["id"] in note
    # The data stays as it was changed; the visible text is only what the user typed.
    after = await agent.call("GET", f"/courses/{course['id']}/assessments")
    assert after["items"][0]["score_percentage"] == 50
    detail = await agent.detail(session["id"])
    assert [b["type"] for b in detail["messages"][0]["content"]] == ["text", "note"]


async def test_attachments_of_dropped_messages_are_deleted(agent: Agent, model: FakeModel):
    session = await agent.session()

    async def upload(name: str) -> dict[str, Any]:
        return await agent.call(
            "POST",
            "/agent/attachments",
            data={"session_id": session["id"]},
            files={"file": (name, b"some notes", "text/plain")},
        )

    kept, dropped, unsent = await upload("a.txt"), await upload("b.txt"), await upload("c.txt")
    model.then(say("One."), say("Two."), say("Again."))
    await agent.send(session["id"], "first", attachment_ids=[kept["id"]])
    await agent.send(session["id"], "second", attachment_ids=[dropped["id"]])
    first = (await agent.detail(session["id"]))["messages"][0]

    await agent.stream(edit_url(session["id"], first["id"]), {"text": "first again"})

    ids = {a["id"] for a in (await agent.detail(session["id"]))["attachments"]}
    assert ids == {kept["id"], unsent["id"]}
    usage = await agent.call("GET", "/storage/usage")
    assert usage["by_module"]["agent"] == 2 * len(b"some notes")
