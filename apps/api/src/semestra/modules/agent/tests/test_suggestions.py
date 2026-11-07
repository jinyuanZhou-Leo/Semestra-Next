"""Suggested questions above the input box (M12 §6.1): facts from the data, the small model's
wording at most twice a day, and the setting that turns the wording off."""

from typing import Any

import pytest
from fastapi import FastAPI
from sqlalchemy import update

from semestra.core.context import Ctx
from semestra.modules.agent.schemas import SuggestionWording, WordedQuestion
from semestra.modules.ai import Message
from semestra.modules.auth.models import AuthUser
from semestra.testing import Clock

from .conftest import Agent


async def _term_with_courses(agent: Agent) -> tuple[dict[str, Any], dict[str, Any]]:
    """A Program in its winter term (the clock reads 2026-01-15) with a course whose lab is due
    tomorrow and a course with nothing in its gradebook."""
    program = await agent.program()
    term = (
        await agent.call(
            "POST",
            f"/programs/{program['id']}/terms",
            json={"name": "Winter 2026", "start_date": "2026-01-05", "end_date": "2026-04-20"},
        )
    )["term"]
    course = await agent.call(
        "POST",
        f"/programs/{program['id']}/courses",
        json={"title": "Programming", "code": "APS105H1", "term_ids": [term["id"]]},
    )
    await agent.call(
        "POST",
        f"/courses/{course['id']}/assessments",
        json={"title": "Lab 3", "weight": 10, "due_date": "2026-01-16"},
    )
    await agent.call(
        "POST",
        f"/programs/{program['id']}/courses",
        json={"title": "Calculus", "code": "MAT186H1", "term_ids": [term["id"]]},
    )
    return program, course


async def _suggestions(agent: Agent, program_id: str) -> list[dict[str, Any]]:
    items = (await agent.call("GET", "/agent/suggestions", params={"program_id": program_id}))[
        "items"
    ]
    await agent.app.state.agent.drain()
    return items


@pytest.fixture
def small_model(app: FastAPI, monkeypatch: pytest.MonkeyPatch) -> list[list[Message]]:
    """The small model is available and words fact 1 and one question from history."""
    calls: list[list[Message]] = []

    async def available(ctx: Ctx, purpose: str) -> bool:
        return True

    async def suggestion_model(ctx: Ctx, messages: list[Message]) -> SuggestionWording:
        calls.append(messages)
        return SuggestionWording(
            questions=[
                WordedQuestion(fact=1, text="Help me finish Lab 3 by tomorrow"),
                WordedQuestion(fact=None, course="APS105H1", text="Explain pointers again"),
            ]
        )

    monkeypatch.setattr("semestra.modules.ai.available", available)
    app.state.agent.suggestion_model = suggestion_model
    return calls


async def test_facts_without_the_small_model(agent: Agent) -> None:
    program, course = await _term_with_courses(agent)

    items = await _suggestions(agent, program["id"])

    assert [(i["code"], i["course_id"], i["text"]) for i in items] == [
        ("due_tomorrow", course["id"], None),
        ("import_syllabus", items[1]["course_id"], None),
        ("week_deadlines", None, None),
    ]
    assert items[0]["params"]["title"].endswith("Lab 3")
    assert items[1]["params"] == {"course": "MAT186H1"}


async def test_small_model_words_at_most_twice_a_day(
    agent: Agent, small_model: list[list[Message]], clock: Clock
) -> None:
    program, course = await _term_with_courses(agent)

    # The first visit shows the facts and has them worded in the background.
    first = await _suggestions(agent, program["id"])
    assert all(i["text"] is None for i in first)
    assert len(small_model) == 1
    assert "due tomorrow: APS105H1 · Lab 3" in str(small_model[0][1].content)

    items = await _suggestions(agent, program["id"])
    assert [(i["code"], i["text"]) for i in items] == [
        ("due_tomorrow", "Help me finish Lab 3 by tomorrow"),
        ("import_syllabus", None),  # left unworded: the client words it
        ("history", "Explain pointers again"),
    ]
    assert items[2]["course_id"] == course["id"]

    clock.advance(hours=11)
    await _suggestions(agent, program["id"])
    assert len(small_model) == 1
    clock.advance(hours=1)
    await _suggestions(agent, program["id"])
    assert len(small_model) == 2


async def test_wording_off_in_settings(agent: Agent, small_model: list[list[Message]]) -> None:
    program, _ = await _term_with_courses(agent)
    await agent.call("PATCH", "/me/settings/assistant", json={"values": {"ai_suggestions": False}})

    items = await _suggestions(agent, program["id"])

    assert small_model == []
    assert all(i["text"] is None for i in items)


async def test_wording_follows_the_browser_language(
    agent: Agent, small_model: list[list[Message]]
) -> None:
    """A user with no language of their own gets the wording in the browser's, once."""
    program, _ = await _term_with_courses(agent)
    async with agent.app.state.session_factory() as db:
        await db.execute(update(AuthUser).values(locale=None))
        await db.commit()
    agent.client.headers["Accept-Language"] = "zh-CN"

    await _suggestions(agent, program["id"])
    items = await _suggestions(agent, program["id"])

    assert len(small_model) == 1
    assert "Simplified Chinese" in str(small_model[0][0].content)
    assert items[0]["text"] == "Help me finish Lab 3 by tomorrow"
