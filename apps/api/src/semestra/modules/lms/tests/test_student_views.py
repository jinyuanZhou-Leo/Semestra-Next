"""Reads and writes behind the Canvas tab's student views (feedback, folders, previews, the
read state of announcements) and grades offered as updates, with the fake provider."""

from typing import Any

import pytest

from semestra.core.config import Settings
from semestra.modules.lms.schemas.dto import Submission
from semestra.modules.lms.tests.conftest import Api, FakeProvider
from semestra.modules.lms.tests.test_lms import by_type, setup_program

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

    await api.call("PATCH", "/settings/lms", json={"values": {"allow_writes": True}})
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
    assert missing["error"]["code"] == "common.not_found"

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


async def test_grades_are_offered_as_updates(api: Api, fake: FakeProvider):
    course = await linked_course(api)
    lab1 = fake.course_assignments["101"][0]
    # Graded before the import: the import copies no score, so it is offered right after.
    fake.course_assignments["101"][0] = lab1.model_copy(
        update={"submission": Submission(state="graded", score=8)}
    )
    started = await api.call(
        "POST", f"/courses/{course}/lms/imports:assignments", json={"external_ids": ["a1", "a2"]}
    )
    assert (await api.commit(started["session_id"]))["failed"] == 0

    updates = await api.call("GET", f"/courses/{course}/lms/updates")
    assert updates["count"] == 1
    assert updates["items"][0]["changes"] == {
        "score": {"old": None, "new": {"points_earned": 8.0, "points_possible": 10.0}}
    }
    review = await api.call("POST", f"/courses/{course}/lms/updates:review")
    session = await api.call("GET", f"/imports/{review['session_id']}")
    [item] = by_type(session, "assessment_patch")
    assert item["data"]["changes"]["score"]["new"] == {
        "points_earned": 8.0,
        "points_possible": 10.0,
    }
    assert (await api.commit(review["session_id"]))["failed"] == 0
    assessments = (await api.call("GET", f"/courses/{course}/assessments"))["items"]
    lab = next(a for a in assessments if a["title"] == "Lab 1")
    assert (lab["points_earned"], lab["points_possible"]) == (8, 10)
    assert (await api.call("GET", f"/courses/{course}/lms/updates"))["count"] == 0

    # A regrade is offered again; one the user turned down is not.
    fake.course_assignments["101"][0] = lab1.model_copy(
        update={"submission": Submission(state="graded", score=9)}
    )
    updates = await api.call("GET", f"/courses/{course}/lms/updates?refresh=true")
    assert updates["items"][0]["changes"]["score"]["old"] == {
        "points_earned": 8.0,
        "points_possible": 10.0,
    }
    review = await api.call("POST", f"/courses/{course}/lms/updates:review")
    session = await api.call("GET", f"/imports/{review['session_id']}")
    [item] = by_type(session, "assessment_patch")
    await api.call(
        "POST", f"/imports/{review['session_id']}/items:decide",
        json={"item_ids": [item["id"]], "decision": "reject"},
    )  # fmt: skip
    await api.commit(review["session_id"])
    assert (await api.call("GET", f"/courses/{course}/lms/updates"))["count"] == 0

    # A score the gradebook already has (as a percentage) is not offered.
    fake.course_assignments["101"][1] = fake.course_assignments["101"][1].model_copy(
        update={"submission": Submission(state="graded", score=15)}
    )
    lab2 = next(a for a in assessments if a["title"] == "Lab 2")
    await api.call("PATCH", f"/assessments/{lab2['id']}", json={"score_percentage": 50})
    updates = await api.call("GET", f"/courses/{course}/lms/updates?refresh=true")
    assert updates["count"] == 0
    # ...and a later hand edit does not bring that same grade back.
    await api.call("PATCH", f"/assessments/{lab2['id']}", json={"score_percentage": 60})
    assert (await api.call("GET", f"/courses/{course}/lms/updates"))["count"] == 0

    # A different percentage is offered, with the percentage as the old value.
    fake.course_assignments["101"][1] = fake.course_assignments["101"][1].model_copy(
        update={"submission": Submission(state="graded", score=21)}
    )
    updates = await api.call("GET", f"/courses/{course}/lms/updates?refresh=true")
    [change] = [u["changes"]["score"] for u in updates["items"]]
    assert change["old"] == {"score_percentage": 60.0}
    assert change["new"]["points_earned"] == 21.0
