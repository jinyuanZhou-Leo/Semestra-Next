"""Announcements kept by the course sync (M09 §4.3): stored, following the platform, read in the
app, their links and attachments opening what the app has."""

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi import FastAPI
from sqlalchemy import select

from semestra.core.context import system_ctx
from semestra.modules.files.models import FilesItem
from semestra.modules.lms import sync
from semestra.modules.lms.schemas.dto import Announcement, Attachment, FileMeta
from semestra.modules.lms.tests.conftest import Api, FakeProvider
from semestra.modules.lms.tests.test_lms import setup_program
from semestra.testing import Clock, collect_events

pytestmark = pytest.mark.usefixtures("fake")


class Board:
    """The course's announcements on the fake platform; tests change `posts`."""

    def __init__(self, fake: FakeProvider) -> None:
        self.posts: list[Announcement] = []
        self.asked_since: datetime | None = None
        fake.announcements = self.read  # pyright: ignore[reportAttributeAccessIssue]

    async def read(self, *_: Any, since: datetime | None = None, **__: Any) -> list[Announcement]:
        self.asked_since = since
        return [p.model_copy(deep=True) for p in self.posts]

    def post(self, external_id: str, title: str, at: datetime, **kw: Any) -> Announcement:
        post = Announcement(
            external_id=external_id, external_course_id="101", title=title, posted_at=at,
            web_url=f"https://fake/courses/101/announcements/{external_id}", **kw,
        )  # fmt: skip
        self.posts.insert(0, post)
        return post


async def _course(api: Api) -> tuple[str, str, str]:
    program_id, term_id, _ = await setup_program(api)
    course = await api.course(program_id, term_id)
    await api.link(course, "101")
    return program_id, term_id, course


async def _listed(api: Api, course: str) -> dict[str, dict[str, Any]]:
    out = await api.call("GET", f"/courses/{course}/lms/announcements")
    return {a["external_id"]: a for a in out["items"]}


async def test_kept_and_following_the_platform(
    api: Api, app: FastAPI, fake: FakeProvider, clock: Clock
):
    board = Board(fake)
    program_id, term_id, course = await _course(api)
    user_id = (await api.call("GET", "/account/me"))["id"]
    old = board.post("n0", "Welcome", clock.now - timedelta(days=200))
    board.post("n1", "Syllabus posted", clock.now - timedelta(days=3))

    async def told() -> list[str]:
        clock.advance(hours=1)
        with collect_events(app, user_id) as messages:
            await api.sync(program_id)
        [synced] = [m["data"] for m in messages if m["type"] == sync.SYNCED]
        return [n["title"] for n in synced["notices"]]

    # Not read from the platform yet: the next sync will, unless the course's sync is off.
    out = await api.call("GET", f"/courses/{course}/lms/announcements")
    assert out == {"items": [], "not_read": "waiting"}
    await api.call("PATCH", f"/courses/{course}/lms-link", json={"sync_enabled": False})
    assert (await api.call("GET", f"/terms/{term_id}/lms/announcements"))["not_read"] == "paused"
    await api.call("PATCH", f"/courses/{course}/lms-link", json={"sync_enabled": True})
    # The first read keeps what is there as read, quietly.
    assert await told() == []
    listed = await _listed(api, course)
    assert list(listed) == ["n1", "n0"]
    assert not any(a["unread"] for a in listed.values())
    assert board.asked_since == clock.now - timedelta(days=180)

    # Later: what is new is unread and told, edits follow; what was posted days ago while
    # the course was not synced is unread but not told.
    board.post("n2", "Room change", clock.now - timedelta(minutes=5))
    board.post("n3", "Late news", clock.now - timedelta(days=4))
    board.posts[-2].title = "Syllabus (updated)"
    assert await told() == ["Room change"]
    listed = await _listed(api, course)
    assert (listed["n2"]["unread"], listed["n3"]["unread"], listed["n1"]["unread"]) == (
        True, True, False,
    )  # fmt: skip
    assert listed["n1"]["title"] == "Syllabus (updated)"
    term = await api.call("GET", f"/terms/{term_id}/lms/announcements")
    assert [a["course_id"] for a in term["items"]] == [course] * 4
    assert term["not_read"] is None

    # Deleted on the platform: gone here too. What was posted before the platform was asked
    # about stays.
    board.posts = [p for p in board.posts if p.external_id not in ("n2", old.external_id)]
    await told()
    assert sorted(await _listed(api, course)) == ["n0", "n1", "n3"]

    # Readable offline: the platform is not asked.
    fake.calls.clear()
    await _listed(api, course)
    assert fake.calls == []


async def test_read_here_and_on_the_platform_only_when_allowed(
    api: Api, fake: FakeProvider, clock: Clock
):
    board = Board(fake)
    program_id, term_id, course = await _course(api)
    await api.sync(program_id)
    clock.advance(hours=1)
    board.post("n1", "Quiz moved", clock.now, unread=True)
    board.post("n2", "Office hours", clock.now, unread=True)
    await api.sync(program_id)

    async def unread(term: str | None = None) -> dict[str, int]:
        params = {"term_id": term} if term else {}
        out = await api.call(
            "GET", f"/programs/{program_id}/lms/announcements/unread", params=params
        )
        return {c["course_id"]: c["unread"] for c in out["items"]}

    assert await unread() == {course: 2}
    assert await unread(term_id) == {course: 2}

    # With writes off the mark stays in the app.
    out = await api.call("POST", f"/courses/{course}/lms/announcements/n1:read", json={})
    assert out["unread"] is False
    assert ("mark_read", "n1") not in fake.calls
    assert await unread() == {course: 1}
    # The platform's own mark is not taken either.
    board.posts[0].unread = False
    clock.advance(hours=1)
    await api.sync(program_id)
    assert (await _listed(api, course))["n2"]["unread"] is True

    # With writes on, the platform's mark comes in and reading here goes out.
    await api.call("PATCH", "/me/settings/lms", json={"values": {"allow_writes": True}})
    clock.advance(hours=1)
    await api.sync(program_id)
    assert await unread() == {}
    board.post("n3", "Grades out", clock.now, unread=True)
    clock.advance(hours=1)
    await api.sync(program_id)
    await api.call("POST", f"/courses/{course}/lms/announcements/n3:read", json={})
    assert ("mark_read", "n3") in fake.calls

    err = await api.call("POST", f"/courses/{course}/lms/announcements/nope:read", 404, json={})
    assert err["error"]["code"] == "lms.not_found"


async def test_listed_with_its_text(api: Api, fake: FakeProvider, clock: Clock):
    board = Board(fake)
    program_id, term_id, course = await _course(api)
    board.post(
        "n1",
        "Exam",
        clock.now,
        html="<h2>Room</h2><p>B&amp;C,<br>3rd   floor</p><ul><li>pens</li><li>ID</li></ul>"
        "<script>alert(1)</script>",
    )
    board.post("n2", "Empty", clock.now)
    await api.sync(program_id)

    # The list shows and searches it as one line of text, without the markup.
    listed = await _listed(api, course)
    assert listed["n1"]["text"] == "Room B&C, 3rd floor pens ID"
    assert listed["n2"]["text"] == ""
    term = await api.call("GET", f"/terms/{term_id}/lms/announcements")
    assert {a["external_id"]: a["text"] for a in term["items"]}["n1"] == listed["n1"]["text"]


async def test_links_and_attachments_open_what_the_app_has(
    api: Api, app: FastAPI, fake: FakeProvider, clock: Clock
):
    board = Board(fake)
    fake.course_file_list = [
        FileMeta(external_id="77", name="Notes.pdf", size_bytes=10, mime_type="application/pdf",
                 updated_at=datetime(2026, 1, 10, tzinfo=UTC),
                 web_url="https://fake/courses/101/files/77"),
    ]  # fmt: skip
    program_id, _, course = await _course(api)
    started = await api.call(
        "POST", f"/courses/{course}/lms/imports:assignments", json={"external_ids": ["a1"]}
    )
    await api.commit(started["session_id"])
    # Attachments are not brought into the course's files: they open from the announcement.
    body = {"scope_type": "course", "scope_id": course,
            "values": {"announcement_attachments": False}}  # fmt: skip
    await api.call("PATCH", "/me/settings/lms.materials", json=body)
    board.post(
        "n1",
        "Lab 1 is out",
        clock.now,
        html='<p><a href="https://fake/courses/101/files/77">notes</a> '
        '<a href="https://fake/courses/101/assignments/a1">lab</a> '
        '<a href="https://fake/courses/101/pages/missing">page</a></p>',
        attachments=[
            Attachment(external_id="77", name="Notes.pdf", size_bytes=10),
            Attachment(
                external_id="88",
                name="Rubric.pdf",
                size_bytes=20,
                download_url="https://fake/files/88/download?verifier=v",
            ),
        ],
    )
    await api.sync(program_id)

    [post] = (await _listed(api, course)).values()
    async with system_ctx(app.state) as ctx:
        notes = await ctx.db.scalar(select(FilesItem).where(FilesItem.display_name == "Notes.pdf"))
    assert notes is not None
    [assessment] = (await api.call("GET", f"/courses/{course}/assessments"))["items"]
    file_target = {
        "kind": "file", "id": notes.id, "course_id": course, "folder_id": notes.folder_id,
    }  # fmt: skip
    assert post["targets"] == [
        {"kind": "file", "ref": "77", "target": file_target},
        {
            "kind": "assignment",
            "ref": "a1",
            "target": {
                "kind": "assessment",
                "id": assessment["id"],
                "course_id": course,
                "folder_id": None,
            },
        },
    ]
    assert [(a["name"], a["file"]) for a in post["attachments"]] == [
        ("Notes.pdf", file_target),
        ("Rubric.pdf", None),
    ]
    assert "download_url" not in post["attachments"][1]
    # One not in the course's files opens from the address the announcement gave, without the
    # file lookup a course with its files hidden refuses.
    fake.calls.clear()
    r = await api.client.get(f"/courses/{course}/lms/files/88/content")
    assert (r.status_code, r.content) == (200, b"hello")
    assert ("file", "88") not in fake.calls


async def test_an_ended_term_is_read_when_the_user_asks(api: Api, fake: FakeProvider, clock: Clock):
    board = Board(fake)
    program_id, _, _ = await setup_program(api)
    term = {"name": "Fall 2025", "start_date": "2025-09-02", "end_date": "2025-12-05"}
    term_id = (await api.call("POST", f"/programs/{program_id}/terms", json=term))["term"]["id"]
    course = await api.course(program_id, term_id)
    await api.link(course, "101")
    board.post("n1", "Final grades", clock.now)
    # The sync no longer reads it on its own, so the list says why it is empty.
    await api.sync(program_id)
    assert (await api.call("GET", f"/courses/{course}/lms/announcements"))["not_read"] == "ended"
    # Asked for this course, it reads it all the same.
    await api.call("POST", f"/courses/{course}/lms:refresh")
    await api.run_jobs()
    out = await api.call("GET", f"/courses/{course}/lms/announcements")
    assert (out["not_read"], [a["title"] for a in out["items"]]) == (None, ["Final grades"])
