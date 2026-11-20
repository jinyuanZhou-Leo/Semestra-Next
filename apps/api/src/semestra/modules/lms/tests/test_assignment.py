"""One assignment, whole (M09 §5): read from the platform, or from what the sync kept when the
platform can't be asked; which assessments and to-dos are an assignment; the files handed in."""

from datetime import UTC, datetime
from typing import Any

import pytest

from semestra.modules.lms.schemas.dto import (
    Assignment,
    SubmissionComment,
    SubmissionDetail,
    SubmittedFile,
)
from semestra.modules.lms.tests.conftest import Api, FakeProvider
from semestra.modules.lms.tests.test_sync import _assessments, _course
from semestra.testing import Clock

pytestmark = pytest.mark.usefixtures("fake")


def _handed_in(assignment_id: str, **kw: Any) -> SubmissionDetail:
    return SubmissionDetail(
        external_id=f"s-{assignment_id}",
        assignment_id=assignment_id,
        state="graded",
        submitted_at=datetime(2026, 2, 5, 20, tzinfo=UTC),
        submission_type="online_upload",
        files=[
            SubmittedFile(
                external_id="f1",
                name="lab1.c",
                mime_type="text/plain",
                size_bytes=5,
                download_url="https://lms.example/files/f1/download",
            )
        ],
        **kw,
    )


async def _open(api: Api, course: str, assignment: str, status: int = 200, **params: Any) -> Any:
    return await api.call(
        "GET", f"/courses/{course}/lms/assignments/{assignment}", status, params=params
    )


async def test_an_assignment_opens_from_the_platform_then_from_what_was_kept(
    api: Api, fake: FakeProvider, clock: Clock
):
    program_id, course = await _course(api, "a1")
    fake.course_submissions["101"] = [
        _handed_in(
            "a1",
            score=9,
            body="<p onclick='x'>My answer</p>",
            comments=[SubmissionComment(id="1", author="Prof", comment="Good")],
        )
    ]
    lab = (await _assessments(api, course))["a1"]

    live = await _open(api, course, "a1")
    assert (live["kept"], live["assignment"]["name"]) == (False, "Lab 1")
    assert live["assignment"]["html"] == "<p>Do it</p>"
    assert live["submission"]["body"] == "<p>My answer</p>"
    # A file handed in is named; its address stays on the server.
    assert live["submission"]["files"] == [
        {"external_id": "f1", "web_url": None, "raw_kind": None, "name": "lab1.c",
         "mime_type": "text/plain", "size_bytes": 5}
    ]  # fmt: skip
    assert live["submission"]["comments"][0]["comment"] == "Good"
    # Where it is in Semestra: its gradebook row and that row's to-do.
    assert live["assessment"] == {"id": lab["id"], "weight": lab["weight"]}
    tasks = (await api.call("GET", f"/programs/{program_id}/tasks"))["items"]
    assert live["task"] == {"id": tasks[0]["id"], "completed": False}
    # The file opens through the proxy.
    path = f"/courses/{course}/lms/assignments/a1/submission/files/f1/content"
    opened = await api.client.get(path)
    assert (opened.status_code, opened.content) == (200, b"hello")
    await api.call("GET", path.replace("/f1/", "/nope/"), 404)

    # An assignment that was not imported has nothing kept: the platform's error stands.
    fake.down = True
    err = await _open(api, course, "a2", 502, refresh=True)
    assert err["error"]["code"] == "lms.unreachable"
    # Nor has an imported one before its first sync.
    await _open(api, course, "a1", 502, refresh=True)

    fake.down = False
    await api.sync(program_id)
    kept_at = clock.now
    fake.down = True
    clock.advance(minutes=10)
    kept = await _open(api, course, "a1", refresh=True)
    assert (kept["kept"], kept["problem"]) == (True, "lms.unreachable")
    assert datetime.fromisoformat(kept["kept_at"]) == kept_at
    assert (kept["assignment"]["name"], kept["assignment"]["html"]) == ("Lab 1", "<p>Do it</p>")
    assert (kept["assignment"]["points"], kept["assignment"]["group_name"]) == (10, "Labs")
    assert (kept["submission"]["score"], kept["submission"]["body"]) == (9, "<p>My answer</p>")
    assert [f["name"] for f in kept["submission"]["files"]] == ["lab1.c"]
    assert kept["submission"]["comments"][0]["comment"] == "Good"
    assert kept["assessment"]["id"] == lab["id"]

    # A course no longer linked still opens what it kept.
    fake.down = False
    await api.call("DELETE", f"/courses/{course}/lms-link")
    kept = await _open(api, course, "a1")
    assert (kept["kept"], kept["problem"]) == (True, "lms.course_not_linked")
    assert kept["assessment"]["id"] == lab["id"]
    targets = await api.call("GET", f"/programs/{program_id}/lms/assignment-targets")
    assert targets["items"] == [
        {"course_id": course, "assignment_id": "a1", "assessment_id": lab["id"], "task_id": None}
    ]


async def test_to_dos_are_kept_too_and_follow_into_the_gradebook(
    api: Api, fake: FakeProvider, clock: Clock
):
    fake.course_assignments["101"].append(
        Assignment(
            external_id="a9",
            name="Reading",
            html="<p>Chapter 2</p>",
            due_at=datetime(2026, 2, 9, 17, tzinfo=UTC),
        )
    )
    program_id, course = await _course(api, "a1", "a9")
    lab = (await _assessments(api, course))["a1"]
    tasks = (await api.call("GET", f"/programs/{program_id}/tasks"))["items"]
    reading = next(t for t in tasks if t["title"] == "Reading")

    async def targets() -> dict[str, tuple[str | None, str | None]]:
        found = await api.call("GET", f"/programs/{program_id}/lms/assignment-targets")
        return {t["assignment_id"]: (t["assessment_id"], t["task_id"]) for t in found["items"]}

    # Known from the import on, before any sync.
    assert await targets() == {"a1": (lab["id"], None), "a9": (None, reading["id"])}

    fake.course_submissions["101"] = [_handed_in("a9")]
    await api.sync(program_id)
    fake.down = True
    kept = await _open(api, course, "a9", refresh=True)
    assert (kept["kept"], kept["assignment"]["html"]) == (True, "<p>Chapter 2</p>")
    assert (kept["assessment"], kept["task"]["id"]) == (None, reading["id"])
    # A to-do's feedback is not the gradebook's.
    assert (await api.call("GET", f"/courses/{course}/lms/feedback"))["items"] == []

    # Moved into the gradebook, what was kept follows to the assessment; its to-do stays.
    fake.down = False
    fake.course_assignments["101"][-1] = fake.course_assignments["101"][-1].model_copy(
        update={"points": 5}
    )
    added = await api.call(
        "POST", f"/courses/{course}/lms/imports:gradebook", json={"external_ids": ["a9"]}
    )
    await api.commit(added["session_id"])
    graded = (await _assessments(api, course))["a9"]
    clock.advance(minutes=2)
    await api.sync(program_id)
    assert (await targets())["a9"] == (graded["id"], None)
    fake.down = True
    kept = await _open(api, course, "a9", refresh=True)
    assert kept["kept"]
    assert (kept["assessment"]["id"], kept["task"]["id"]) == (graded["id"], reading["id"])
