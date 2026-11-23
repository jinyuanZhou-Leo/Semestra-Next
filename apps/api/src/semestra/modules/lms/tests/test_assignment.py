"""One assignment, whole (M09 §3.1, §5): from the mirror, or from the platform where the mirror
can't stand in; which assessments and to-dos are an assignment; the files handed in."""

import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from sqlalchemy import delete, select

from semestra.core.context import system_ctx
from semestra.modules.lms.models import LmsAssignment, LmsCourseLink
from semestra.modules.lms.schemas.dto import (
    Assignment,
    Quiz,
    SubmissionComment,
    SubmissionDetail,
    SubmittedFile,
)
from semestra.modules.lms.tests.conftest import Api, FakeProvider
from semestra.modules.lms.tests.test_sync import _assessments, _course
from semestra.modules.tasks.models import TasksItem
from semestra.testing import API_DIR, Clock

pytestmark = pytest.mark.usefixtures("fake")


def _handed_in(assignment_id: str, **kw: Any) -> SubmissionDetail:
    return SubmissionDetail(
        external_id=f"s-{assignment_id}",
        assignment_id=assignment_id,
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


async def test_an_assignment_opens_from_the_platform_then_from_the_mirror(
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

    # Never synced: read from the platform now (M09 §3.1).
    live = await _open(api, course, "a1")
    assert (live["source"], live["held"], live["assignment"]["name"]) == ("live", False, "Lab 1")
    assert live["assignment"]["html"] == "<p>Do it</p>"
    assert live["submission"]["body"] == "<p>My answer</p>"
    # A file handed in is named; its address stays on the server.
    assert live["submission"]["files"] == [
        {"external_id": "f1", "web_url": None, "raw_kind": None, "name": "lab1.c",
         "mime_type": "text/plain", "size_bytes": 5}
    ]  # fmt: skip
    assert live["submission"]["comments"][0]["comment"] == "Good"
    assert (live["state"], live["due_state"]) == ("graded", "none")
    assert "state" not in live["assignment"]  # the assignment alone doesn't know its submission
    # Where it is in Semestra: its gradebook row and that row's to-do.
    assert live["assessment"] == {"id": lab["id"], "weight": lab["weight"]}
    tasks = (await api.call("GET", f"/programs/{program_id}/tasks"))["items"]
    assert live["task"] == {"id": tasks[0]["id"], "completed": False}
    # The file opens through the proxy.
    path = f"/courses/{course}/lms/assignments/a1/submission/files/f1/content"
    opened = await api.client.get(path)
    assert (opened.status_code, opened.content) == (200, b"hello")
    await api.call("GET", path.replace("/f1/", "/nope/"), 404)
    # Not found only when the platform says so; the platform's other errors stand.
    gone = await _open(api, course, "nope", 404)
    assert gone["error"]["code"] == "lms.not_found"
    fake.down = True
    err = await _open(api, course, "a2", 502)
    assert err["error"]["code"] == "lms.unreachable"

    # Once synced, the mirror answers, imported or not, without the platform.
    fake.down = False
    await api.sync(program_id)
    synced_at = clock.now
    fake.down = True
    clock.advance(minutes=10)
    kept = await _open(api, course, "a1")
    assert (kept["source"], kept["held"], kept["sync_failed"]) == ("mirror", False, False)
    assert datetime.fromisoformat(kept["as_of"]) == synced_at
    assert kept["state"] == "graded"
    assert (kept["assignment"]["name"], kept["assignment"]["html"]) == ("Lab 1", "<p>Do it</p>")
    assert (kept["assignment"]["points"], kept["assignment"]["group_name"]) == (10, "Labs")
    assert (kept["submission"]["score"], kept["submission"]["body"]) == (9, "<p>My answer</p>")
    assert [f["name"] for f in kept["submission"]["files"]] == ["lab1.c"]
    assert kept["submission"]["comments"][0]["comment"] == "Good"
    assert kept["assessment"]["id"] == lab["id"]
    assert (await _open(api, course, "a2"))["assignment"]["name"] == "Lab 2"
    # Asked to refresh, it reads the platform now.
    await _open(api, course, "a1", 502, refresh=True)

    # A course no longer linked keeps the content for the assessment, as last read.
    fake.down = False
    await api.call("DELETE", f"/courses/{course}/lms-link")
    held = await _open(api, course, "a1", held_for=f"assessment:{lab['id']}")
    assert (held["source"], held["held"]) == ("mirror", True)
    assert datetime.fromisoformat(held["as_of"]) == synced_at
    assert held["assessment"]["id"] == lab["id"]
    targets = await api.call("GET", f"/programs/{program_id}/lms/assignment-targets")
    assert targets["items"] == [
        {
            "course_id": course,
            "assignment_id": "a1",
            "assessment_id": lab["id"],
            "task_id": None,
            # The teacher's comment: the gradebook opens the details on the feedback.
            "feedback": True,
            # How it stands as of the last sync, so the gradebook shows it without asking.
            "status": "graded",
            "missing": False,
            "late": False,
            "submitted_at": "2026-02-05T20:00:00Z",
            "online": True,
            "held": True,
            "state": "graded",
        }
    ]
    # The rest of the mirror went with the link.
    await _open(api, course, "a2", 409)


async def test_unbound_after_an_upgrade_keeps_when_the_row_was_read(
    api: Api, app: FastAPI, clock: Clock
):
    """After 0072 a course has no `read_at` of its assignments until a sync reads the list
    whole; the rows moved in carry when they were read, and an unbind then keeps that time,
    not the time of the unbind (§3.2)."""
    program_id, course = await _course(api, "a1")
    lab = (await _assessments(api, course))["a1"]
    await api.sync(program_id)
    read = clock.now
    async with system_ctx(app.state) as ctx:  # as the upgrade leaves it
        link = await ctx.db.scalar(select(LmsCourseLink).where(LmsCourseLink.course_id == course))
        assert link is not None
        link.area_reads = {k: v for k, v in link.area_reads.items() if k != "assignments"}
        row = await ctx.db.scalar(select(LmsAssignment).where(LmsAssignment.external_id == "a1"))
        assert row is not None
        row.seen_at = read
        await ctx.db.commit()
    clock.advance(days=2)
    await api.call("DELETE", f"/assessments/{lab['id']}/lms-assignment")
    held = await _open(api, course, "a1", held_for=f"assessment:{lab['id']}")
    assert held["held"] is True
    assert datetime.fromisoformat(held["as_of"]) == read


async def test_to_dos_are_in_the_mirror_too_and_follow_into_the_gradebook(
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
    kept = await _open(api, course, "a9")
    assert (kept["source"], kept["assignment"]["html"]) == ("mirror", "<p>Chapter 2</p>")
    assert (kept["assessment"], kept["task"]["id"]) == (None, reading["id"])
    # A to-do's feedback is not the gradebook's.
    found = await api.call("GET", f"/programs/{program_id}/lms/assignment-targets")
    assert [t["feedback"] for t in found["items"] if t["assignment_id"] == "a9"] == [False]

    # Moved into the gradebook, the assignment is the assessment's; its to-do stays.
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
    kept = await _open(api, course, "a9")
    assert (kept["assessment"]["id"], kept["task"]["id"]) == (graded["id"], reading["id"])


async def test_a_quiz_opens_by_its_own_id_also_from_the_mirror(api: Api, fake: FakeProvider):
    fake.course_assignments["101"].append(
        Assignment(
            external_id="a8",
            name="Quiz A",
            raw_kind="quiz",
            quiz_id="q8",
            points=5,
            due_at=datetime(2026, 2, 9, 17, tzinfo=UTC),
        )
    )
    fake.quiz_list.append(
        Quiz(external_id="q8", title="Quiz A", question_count=10, time_limit=30, assignment_id="a8")
    )
    program_id, course = await _course(api, "a8")

    # A link to a quiz knows the quiz's id only: it opens the quiz's assignment.
    live = await _open(api, course, "quiz:q8")
    assert (live["assignment"]["external_id"], live["practice"]) == ("a8", False)
    assert live["quiz"] == {"question_count": 10, "time_limit": 30}
    assert live["assessment"] is not None
    # A quiz without an assignment opens as itself.
    practice = await _open(api, course, "quiz:q1")
    assert (practice["assignment"]["name"], practice["practice"]) == ("Quiz 1", True)
    assert (practice["submission"], practice["assessment"]) == (None, None)

    await api.sync(program_id)
    fake.down = True
    kept = await _open(api, course, "quiz:q8")
    assert (kept["source"], kept["assignment"]["external_id"]) == ("mirror", "a8")
    assert kept["quiz"] == {"question_count": 10, "time_limit": 30}


async def test_a_to_do_deleted_a_moment_ago_does_not_fail_the_sync(
    api: Api, fake: FakeProvider, app: Any
):
    fake.course_assignments["101"].append(
        Assignment(external_id="a9", name="Reading", due_at=datetime(2026, 2, 9, 17, tzinfo=UTC))
    )
    program_id, _ = await _course(api, "a9")
    # As between the delete's commit and M05 telling about it: the to-do is gone, its ref not.
    async with app.state.session_factory() as db:
        await db.execute(delete(TasksItem))
        await db.commit()
    status = await api.sync(program_id)
    assert status["errors"] == []
    assert (await api.call("GET", f"/programs/{program_id}/lms/assignment-targets"))["items"]


async def test_the_closed_area_note_holds_through_a_round_that_cannot_tell(
    api: Api, fake: FakeProvider, clock: Clock
):
    """The note over the body says the area is closed exactly while "Not syncing for now"
    does (`rules.area_closed`, §7.3): also through a round that could not tell."""
    program_id, course = await _course(api, "a1")
    await api.sync(program_id)
    assert (await _open(api, course, "a1"))["area_hidden"] is False

    fake.assignments_hidden = True
    clock.advance(minutes=1)
    await api.sync(program_id)
    assert (await _open(api, course, "a1"))["area_hidden"] is True

    fake.nav_refused = True  # the list refused and no menu to tell why: `unavailable`
    clock.advance(minutes=1)
    await api.sync(program_id)
    assert (await _open(api, course, "a1"))["area_hidden"] is True


def test_migration_moves_what_was_kept_into_the_mirror(tmp_path: Path):
    """0072 (M09 §3.2): a kept assignment whose object is still imported from it becomes its
    mirror row, the others are held for their object; refs kept for new assignments go. The
    mirror holds only what was imported, so the course reads its assignments from the platform
    until a sync reads the whole list (no `read_at` of the area, §3.1), unless the area is
    closed (`rules.area_closed`)."""
    path = tmp_path / "m.db"
    cfg = Config(str(API_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_DIR / "migrations"))
    cfg.attributes["database_url"] = f"sqlite+aiosqlite:///{path}"
    command.upgrade(cfg, "0071")
    db = sqlite3.connect(path)  # foreign keys are off: no other rows needed
    reads = {"assignments": {"result": "whole", "read_at": "2026-01-10T00:00:00+00:00"},
             "files": {"result": "whole", "read_at": "2026-01-10T00:00:00+00:00"}}  # fmt: skip
    db.execute(
        "INSERT INTO lms_course_links (id, user_id, course_id, program_id, connection_id,"
        " external_course_id, sync_enabled, area_reads, sync_errors, created_at, updated_at)"
        " VALUES ('l1', 'u1', 'c1', 'p1', 'n1', '101', 1, ?, '{}', '2026-01-01', '2026-01-01')",
        (json.dumps(reads),),
    )
    closed = {"assignments": {"result": "hidden", "at": "2026-01-10T00:00:00+00:00",
                              "read_at": "2026-01-09T00:00:00+00:00"}}  # fmt: skip
    db.execute(
        "INSERT INTO lms_course_links (id, user_id, course_id, program_id, connection_id,"
        " external_course_id, sync_enabled, area_reads, sync_errors, created_at, updated_at)"
        " VALUES ('l2', 'u1', 'c2', 'p1', 'n1', '102', 1, ?, '{}', '2026-01-01', '2026-01-01')",
        (json.dumps(closed),),
    )
    for ref_id, ext, kind, target, dismissed in (
        ("r1", "a1", "assessment", "x1", None),
        ("r2", "a5", None, None, None),  # offered as new
        ("r3", "a6", None, None, "2026-01-02 00:00:00"),  # ignored
    ):
        db.execute(
            "INSERT INTO lms_imported_refs (id, user_id, link_id, external_id, target_kind,"
            " target_id, snapshot, conflicts, dismissed_at) VALUES (?, 'u1', 'l1', ?, ?, ?,"
            " ?, '{}', ?)",
            (
                ref_id,
                ext,
                kind,
                target,
                json.dumps({"title": "Lab 1", "due_at": "2026-02-01"}),
                dismissed,
            ),
        )
    for kept_id, assessment, task, ext in (("k1", "x1", None, "a1"), ("k2", None, "t2", "a2")):
        db.execute(
            "INSERT INTO lms_kept_assignments (id, user_id, assessment_id, task_id, course_id,"
            " provider, assignment_id, points, score, comments, rubric, rubric_scores, details,"
            " work, read_at) VALUES (?, 'u1', ?, ?, 'c1', 'canvas', ?, 10, 9, ?, '[]', '[]', ?,"
            " ?, '2026-01-10 00:00:00')",
            (
                kept_id, assessment, task, ext,
                json.dumps([{"id": "1", "author": "Prof", "comment": "Good"}]),
                json.dumps({"quiz": {"question_count": 3}}),
                json.dumps({"body": "<p>Mine</p>"}),
            ),
        )  # fmt: skip
    db.commit()
    db.close()
    command.upgrade(cfg, "head")
    db = sqlite3.connect(path)
    refs = [r[0] for r in db.execute("SELECT external_id FROM lms_imported_refs ORDER BY 1")]
    assert refs == ["a1", "a6"]
    rows = {
        r[0]: r[1:]
        for r in db.execute(
            "SELECT external_id, link_id, held_for_kind, held_for_id, seen_at, assignment,"
            " submission, quiz FROM lms_assignments"
        )
    }
    area_reads = dict(db.execute("SELECT id, area_reads FROM lms_course_links"))
    db.close()
    assert set(json.loads(area_reads["l1"])) == {"files"}
    # A closed area keeps its read: still closed, its saved assignments open from the mirror.
    assert json.loads(area_reads["l2"]) == closed
    link_id, kind, held_for, seen_at, assignment, submission, quiz = rows["a1"]
    assert (link_id, kind, held_for, seen_at) == ("l1", None, None, "2026-01-10 00:00:00.000000")
    assert json.loads(assignment)["name"] == "Lab 1"
    assert json.loads(assignment)["due_at"] == "2026-02-01"  # from the snapshot
    assert json.loads(submission)["body"] == "<p>Mine</p>"
    assert json.loads(submission)["comments"][0]["comment"] == "Good"
    assert json.loads(quiz) == {"question_count": 3}
    assert rows["a2"][:3] == (None, "task", "t2")
    assert rows["a2"][3] is not None
