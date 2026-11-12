"""Reads and writes behind the Canvas tab's student views (feedback, folders, previews, the
read state of announcements) and grades following the platform, with the fake provider."""

from typing import Any

import pytest

from semestra.core.config import Settings
from semestra.modules.lms.schemas.dto import Submission
from semestra.modules.lms.tests.conftest import Api, FakeProvider
from semestra.modules.lms.tests.test_lms import by_type, held_for_review, setup_program

pytestmark = pytest.mark.usefixtures("fake")


async def linked_course(api: Api) -> str:
    program_id, term_id, _ = await setup_program(api)
    course = await api.course(program_id, term_id)
    await api.link(course, "101")
    return course


async def test_mark_read_needs_the_setting(api: Api, fake: FakeProvider):
    course = await linked_course(api)
    url = f"/courses/{course}/lms/announcements/n1:read"
    err = await api.call("POST", url, 409, json={})
    assert err["error"]["code"] == "lms.writes_disabled"
    assert ("mark_read", "n1") not in fake.calls

    original = fake.announcements

    async def unread(*args: Any, **kwargs: Any) -> Any:
        return [a.model_copy(update={"unread": True}) for a in await original(*args, **kwargs)]

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(fake, "announcements", unread)
        listed = await api.call("GET", f"/courses/{course}/lms/announcements")
    assert listed["items"][0]["unread"] is True

    await api.call("PATCH", "/me/settings/lms", json={"values": {"allow_writes": True}})
    out = await api.call("POST", url, json={})
    assert out == {"announcement_id": "n1", "unread": False}
    assert ("mark_read", "n1") in fake.calls
    # The cached list is dropped (keeping it would extend its freshness): the next read asks
    # the platform, which now says read.
    calls = len(fake.calls)
    listed = await api.call("GET", f"/courses/{course}/lms/announcements")
    assert listed["items"][0]["unread"] is False
    assert len(fake.calls) == calls + 1


async def test_submission_folders_search_and_preview(api: Api, fake: FakeProvider):
    course = await linked_course(api)
    sub = await api.call("GET", f"/courses/{course}/lms/assignments/a1/submission")
    assert (sub["score"], sub["attempt"]) == (8, 1)
    assert sub["comments"][0]["comment"] == "Good work"
    assert sub["rubric_scores"] == [
        {"criterion_id": "c1", "points": 8, "rating_id": None, "comments": None}
    ]

    root = await api.call("GET", f"/courses/{course}/lms/folders")
    assert [f["name"] for f in root["folders"]] == ["Lectures"]
    inner = await api.call("GET", f"/courses/{course}/lms/folders?folder_id=f1")
    assert [f["name"] for f in inner["trail"]] == ["course files", "Lectures"]
    assert [f["name"] for f in inner["files"]] == ["notes.txt"]
    missing = await api.call("GET", f"/courses/{course}/lms/folders?folder_id=zz", 404)
    assert missing["error"]["code"] == "lms.not_found"

    found = await api.call("GET", f"/courses/{course}/lms/files?term=notes")
    assert [f["name"] for f in found["items"]] == ["notes.txt"]
    await api.call("GET", f"/courses/{course}/lms/files?term=n", 422)

    preview = await api.call("GET", f"/courses/{course}/lms/files/9/preview")
    assert (preview["kind"], preview["pages"], preview["truncated"]) == ("text", ["hello"], False)


async def test_preview_refuses_large_files(api: Api, settings: Settings):
    course = await linked_course(api)
    settings.files_max_upload_bytes = 3
    err = await api.call("GET", f"/courses/{course}/lms/files/9/preview", 413)
    assert err["error"]["code"] == "lms.file_too_large"


async def test_grades_follow_the_platform(api: Api, fake: FakeProvider):
    program_id, term_id, _ = await setup_program(api)
    course = await api.course(program_id, term_id)
    await api.link(course, "101")
    lab1 = fake.course_assignments["101"][0]
    # Graded before the import: the grade comes along with it.
    fake.course_assignments["101"][0] = lab1.model_copy(
        update={"submission": Submission(state="graded", score=8)}
    )
    started = await held_for_review(api, f"/courses/{course}/lms/imports:assignments", ["a1", "a2"])
    session = await api.call("GET", f"/imports/{started['session_id']}")
    first = by_type(session, "assessment")[0]
    assert (first["data"]["points_earned"], first["data"]["points_possible"]) == (8, 10)
    # Switched to a task and back in the review, it keeps the grade.
    url = f"/imports/{session['id']}/items/{first['id']}"
    await api.call("PATCH", url, json={"type": "task"})
    back = await api.call("PATCH", url, json={"type": "assessment"})
    data = next(i for i in back["items"] if i["id"] == first["id"])["data"]
    assert (data["points_earned"], data["points_possible"]) == (8, 10)
    assert (await api.commit(started["session_id"]))["failed"] == 0

    async def asked() -> list[dict[str, Any]]:
        status = await api.sync(program_id)
        return [i for i in status["pending"] if i["kind"] == "conflict"]

    async def grades() -> dict[str, dict[str, Any]]:
        items = (await api.call("GET", f"/courses/{course}/assessments"))["items"]
        return {a["title"]: a for a in items}

    lab = (await grades())["Lab 1"]
    assert (lab["points_earned"], lab["points_possible"]) == (8, 10)
    assert (await api.sync(program_id))["recent"] == []

    # A regrade replaces a grade the user left alone.
    fake.course_assignments["101"][0] = lab1.model_copy(
        update={"submission": Submission(state="graded", score=9)}
    )
    [change] = (await api.sync(program_id))["recent"]
    assert (change["field"], change["old"]) == (
        "score",
        {"points_earned": 8.0, "points_possible": 10.0},
    )
    assert (await grades())["Lab 1"]["points_earned"] == 9

    # A grade the gradebook already has (as a percentage) changes nothing...
    lab2 = (await grades())["Lab 2"]
    await api.call("PATCH", f"/assessments/{lab2['id']}", json={"score_percentage": 50})
    fake.course_assignments["101"][1] = fake.course_assignments["101"][1].model_copy(
        update={"submission": Submission(state="graded", score=15)}
    )
    assert await asked() == []
    assert len((await api.call("GET", f"/programs/{program_id}/lms/sync"))["recent"]) == 1
    # ...and a later hand edit stays while the platform keeps that grade.
    await api.call("PATCH", f"/assessments/{lab2['id']}", json={"score_percentage": 60})
    assert await asked() == []
    # A regrade then asks, with the user's percentage against the platform's points.
    fake.course_assignments["101"][1] = fake.course_assignments["101"][1].model_copy(
        update={"submission": Submission(state="graded", score=21)}
    )
    [conflict] = await asked()
    assert conflict["conflicts"] == [
        {
            "field": "score",
            "mine": {"score_percentage": 60.0},
            "platform": {"points_earned": 21.0, "points_possible": 30.0},
        }
    ]
