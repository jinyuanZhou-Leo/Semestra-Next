"""What the background check reports as new for update notifications (M09 §4.7)."""

from collections.abc import Sequence
from datetime import datetime, timedelta
from typing import Any

import pytest
from fastapi import FastAPI

from semestra.core.context import Ctx, run_as_system
from semestra.modules.lms import watch
from semestra.modules.lms.schemas.dto import Announcement, Submission
from semestra.modules.lms.tests.conftest import Api, FakeProvider
from semestra.modules.lms.tests.test_lms import setup_program
from semestra.testing import Clock

pytestmark = pytest.mark.usefixtures("fake")


async def test_each_change_is_reported_once_and_the_first_look_is_quiet(
    api: Api, fake: FakeProvider, app: FastAPI, clock: Clock
) -> None:
    program_id, term_id, _ = await setup_program(api)
    course = await api.course(program_id, term_id)
    await api.link(course, "101")
    await api.call(
        "POST",
        f"/courses/{course}/lms/imports:assignments",
        json={"external_ids": ["a1", "a2", "a3"]},
    )
    user_id = (await api.call("GET", "/account/me"))["id"]
    labs = fake.course_assignments["101"]

    async def look(announcements: bool = False) -> list[dict[str, Any]]:
        clock.advance(minutes=10)  # past the read cache
        found: list[watch.CourseNews] = []
        links: list[str] = []
        posted: dict[str, list[watch.NewAnnouncement] | None] = {}
        as_of = clock.now

        async def courses(ctx: Ctx) -> None:
            links.extend(await watch.watched_links(ctx))
            if announcements:
                posted.update(await watch.new_announcements(ctx, links, as_of))

        await run_as_system(app.state, user_id, courses)
        for link_id in links:

            async def run(ctx: Ctx, link_id: str = link_id) -> None:
                news = await watch.course_news(ctx, link_id, posted.get(link_id, []), as_of)
                if news is not None:
                    found.append(news)

            await run_as_system(app.state, user_id, run)
        return [
            {
                "graded": n.graded,
                "changed": n.changed,
                "announcements": [a.title for a in n.announcements],
            }
            for n in found
        ]

    # A change from before the first look is not news.
    labs[0] = labs[0].model_copy(update={"name": "Lab 1 (revised)"})
    assert await look() == []
    assert await look() == []

    labs[1] = labs[1].model_copy(update={"submission": Submission(state="graded", score=27)})
    labs[2] = labs[2].model_copy(update={"due_at": labs[2].due_at + timedelta(days=7)})  # pyright: ignore[reportOptionalOperand]
    assert await look() == [{"graded": ["Lab 2"], "changed": ["Midterm"], "announcements": []}]
    assert await look() == []

    # Announcements posted since the last look, when asked for.
    async def posted(*_: Any, **__: Any) -> Sequence[Announcement]:
        at: datetime = clock.now - timedelta(minutes=5)
        return [
            Announcement(external_id="n1", external_course_id="101", title="Room change",
                         posted_at=at),
            Announcement(external_id="n0", external_course_id="101", title="Old",
                         posted_at=at - timedelta(days=2)),
        ]  # fmt: skip

    fake.announcements = posted  # pyright: ignore[reportAttributeAccessIssue]
    assert await look(announcements=True) == [
        {"graded": [], "changed": [], "announcements": ["Room change"]}
    ]

    # After days without a look (the server was off), what changed meanwhile is only recorded.
    labs[0] = labs[0].model_copy(update={"name": "Lab 1 (final)"})
    clock.advance(days=3)
    assert await look() == []
    labs[2] = labs[2].model_copy(update={"name": "Midterm (room B)"})
    assert await look() == [{"graded": [], "changed": ["Midterm (room B)"], "announcements": []}]

    # A value changed back and then changed again is news again.
    labs[2] = labs[2].model_copy(update={"name": "Midterm"})
    assert await look() == []
    labs[2] = labs[2].model_copy(update={"name": "Midterm (room B)"})
    assert await look() == [{"graded": [], "changed": ["Midterm (room B)"], "announcements": []}]

    # Binding an assessment made by hand: what differs from it is offered in the app, but
    # nothing changed on the platform, so the check announces nothing.
    labs.append(
        labs[1].model_copy(update={"external_id": "a6", "name": "Essay", "group_id": "g9",
                                   "submission": Submission(state="graded", score=20)})
    )  # fmt: skip
    made = await api.call(
        "POST", f"/courses/{course}/assessments", json={"title": "My essay", "weight": 3}
    )
    await api.call("PUT", f"/assessments/{made['id']}/lms-assignment", json={"assignment_id": "a6"})
    assert await look() == []
    updates = await api.call("GET", f"/courses/{course}/lms/updates?refresh=true")
    assert {"due_at", "score"} <= set(
        next(u for u in updates["items"] if u["external_id"] == "a6")["changes"]
    )
