"""The teacher's feedback kept in Semestra (M09 §4.4): the sync keeps the comments and rubric of
imported assessments from one read of the course, the gradebook reads them from the database,
and new comments are a recent update of the assessment."""

from typing import Any

import pytest
from fastapi import FastAPI

from semestra.modules.lms import sync
from semestra.modules.lms.schemas.dto import (
    RubricCriterion,
    RubricRating,
    RubricScore,
    SubmissionComment,
    SubmissionDetail,
)
from semestra.modules.lms.tests.conftest import Api, FakeProvider
from semestra.modules.lms.tests.test_sync import _assessments, _course
from semestra.testing import Clock, collect_events

pytestmark = pytest.mark.usefixtures("fake")

RUBRIC = [
    RubricCriterion(
        id="c1",
        description="Correctness",
        points=10,
        ratings=[RubricRating(id="r1", description="Full marks", points=10)],
    )
]


def _submission(assignment_id: str, *comments: SubmissionComment, **kw: Any) -> SubmissionDetail:
    return SubmissionDetail(
        external_id=f"s-{assignment_id}",
        assignment_id=assignment_id,
        comments=list(comments),
        **kw,
    )


async def _feedback(api: Api, course: str) -> dict[str, dict[str, Any]]:
    items = (await api.call("GET", f"/courses/{course}/lms/feedback"))["items"]
    return {f["assignment_id"]: f for f in items}


async def test_feedback_is_kept_and_follows_the_platform(
    api: Api, app: FastAPI, fake: FakeProvider, clock: Clock
):
    program_id, course = await _course(api, "a1", "a3")
    labs = fake.course_assignments["101"]
    labs[0] = labs[0].model_copy(update={"rubric": RUBRIC})
    hello = SubmissionComment(id="1", author="Prof", comment="See me")
    fake.course_submissions["101"] = [
        _submission(
            "a1",
            hello,
            score=9,
            rubric_scores=[RubricScore(criterion_id="c1", points=9, rating_id="r1")],
        ),
        _submission("a3"),  # handed in, nothing from the teacher
    ]
    calls = len(fake.calls)
    status = await api.sync(program_id)
    # One read of the whole course's submissions, none per assignment.
    made = [name for name, _ in fake.calls[calls:]]
    assert made.count("submissions") == 1
    assert "submission" not in made
    # What the assessment had when first read is not news.
    assert [c for c in status["recent"] if c["field"] == "feedback"] == []

    lab = (await _assessments(api, course))["a1"]
    kept = await _feedback(api, course)
    assert list(kept) == ["a1"]  # the midterm has nothing to show
    assert kept["a1"]["assessment_id"] == lab["id"]
    assert kept["a1"]["comments"][0]["comment"] == "See me"
    assert kept["a1"]["rubric"][0]["ratings"][0]["description"] == "Full marks"
    assert kept["a1"]["points"] == 10

    # Read from the database: the platform is not asked.
    calls = len(fake.calls)
    await _feedback(api, course)
    assert fake.calls[calls:] == []

    # A new comment is a recent update of the assessment, which cannot be put back, and told
    # by the sync (a notification, M18 §4.4).
    user_id = (await api.call("GET", "/account/me"))["id"]
    edited = hello.model_copy(update={"comment": "See me after class"})
    fake.course_submissions["101"][0].comments = [
        edited,
        SubmissionComment(id="2", author="TA", comment="Regraded"),
    ]
    clock.advance(minutes=2)
    with collect_events(app, user_id) as messages:
        status = await api.sync(program_id)
    [synced] = [m["data"] for m in messages if m["type"] == sync.SYNCED]
    assert [(a["name"], a["field"]) for a in synced["applied"]] == [("Lab 1", "feedback")]
    [change] = [c for c in status["recent"] if c["field"] == "feedback"]
    assert change["new"] == {"comments": 1, "rubric": False}
    assert (change["target_kind"], change["target_id"]) == ("assessment", lab["id"])
    assert not change["toggleable"]
    comments = (await _feedback(api, course))["a1"]["comments"]
    assert [c["comment"] for c in comments] == ["See me after class", "Regraded"]

    # Deleted on the platform, deleted here; an edit alone is no news.
    fake.course_submissions["101"][0].comments = [edited]
    fake.course_submissions["101"][0].rubric_scores = []
    clock.advance(minutes=2)
    status = await api.sync(program_id)
    assert len([c for c in status["recent"] if c["field"] == "feedback"]) == 1
    assert (await _feedback(api, course))["a1"]["comments"] == [edited.model_dump(mode="json")]

    # A rubric assessed for the first time is news too.
    fake.course_submissions["101"][1].rubric_scores = [RubricScore(criterion_id="c9", points=1)]
    clock.advance(minutes=2)
    status = await api.sync(program_id)
    news = [c["new"] for c in status["recent"] if c["field"] == "feedback"]
    assert {"comments": 0, "rubric": True} in news


async def test_unbinding_keeps_the_feedback_as_it_was(api: Api, fake: FakeProvider, clock: Clock):
    program_id, course = await _course(api, "a1")
    fake.course_submissions["101"] = [
        _submission("a1", SubmissionComment(id="1", comment="Good"), score=9)
    ]
    await api.sync(program_id)
    lab = (await _assessments(api, course))["a1"]
    await api.call("DELETE", f"/assessments/{lab['id']}/lms-assignment")
    # The platform changes it; the unbound assessment no longer follows.
    fake.course_submissions["101"][0].comments = []
    clock.advance(minutes=2)
    await api.sync(program_id)
    kept = await _feedback(api, course)
    assert [c["comment"] for c in kept["a1"]["comments"]] == ["Good"]
    assert kept["a1"]["provider"] == fake.kind


async def test_the_users_own_comments_are_not_feedback(api: Api, fake: FakeProvider, clock: Clock):
    program_id, course = await _course(api, "a1")
    mine = SubmissionComment(id="1", author="Me", own=True, comment="Late, sorry")
    fake.course_submissions["101"] = [_submission("a1", mine)]
    await api.sync(program_id)
    # Only the user's own comment: the gradebook shows no feedback for it.
    assert await _feedback(api, course) == {}

    # Writing another is no news either; the teacher's reply is, and comes with the user's.
    reply = SubmissionComment(id="3", author="Prof", comment="Fine")
    fake.course_submissions["101"][0].comments = [
        mine,
        SubmissionComment(id="2", author="Me", own=True, comment="Uploaded"),
        reply,
    ]
    clock.advance(minutes=2)
    status = await api.sync(program_id)
    [change] = [c for c in status["recent"] if c["kind"] == "feedback"]
    assert change["new"] == {"comments": 1, "rubric": False}
    comments = (await _feedback(api, course))["a1"]["comments"]
    assert [(c["comment"], c["own"]) for c in comments] == [
        ("Late, sorry", True), ("Uploaded", True), ("Fine", False)
    ]  # fmt: skip


async def test_a_cut_off_list_keeps_what_was_kept(api: Api, fake: FakeProvider, clock: Clock):
    program_id, course = await _course(api, "a1")
    fake.course_submissions["101"] = [_submission("a1", SubmissionComment(id="1", comment="Ok"))]
    await api.sync(program_id)
    fake.course_submissions["101"] = []
    fake.truncated = True
    clock.advance(minutes=2)
    await api.sync(program_id)
    assert list(await _feedback(api, course)) == ["a1"]
