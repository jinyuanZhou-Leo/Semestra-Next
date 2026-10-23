"""The read cache and the reads that share it (M09 §2.4): what goes to the platform once."""

import pytest
from fastapi import FastAPI
from sqlalchemy import func, select

from semestra.core.context import system_ctx
from semestra.modules.lms.cache import LRU_BYTES, LmsRuntime
from semestra.modules.lms.models import LmsCache
from semestra.modules.lms.tests.conftest import Api, FakeProvider
from semestra.modules.lms.tests.test_lms import setup_program

pytestmark = pytest.mark.usefixtures("fake")


async def _rows(app: FastAPI) -> int:
    async with system_ctx(app.state) as ctx:
        return int(await ctx.db.scalar(select(func.count()).select_from(LmsCache)) or 0)


def _count(fake: FakeProvider, name: str) -> int:
    return sum(1 for call, _ in fake.calls if call == name)


async def test_second_level_is_written_after_the_request(api: Api, app: FastAPI):
    program_id, term_id, _ = await setup_program(api)
    course = await api.course(program_id, term_id)
    await api.link(course, "101")
    before = await _rows(app)
    await api.call("GET", f"/courses/{course}/lms/assignments")
    # Stored in its own transaction once the read committed (the read itself writes nothing).
    assert await _rows(app) == before + 1
    # A fresh process still answers from the second level.
    app.state.lms = LmsRuntime()
    again = await api.call("GET", f"/courses/{course}/lms/assignments")
    assert again["items"]


async def test_refresh_drops_one_course(api: Api, fake: FakeProvider):
    program_id, term_id, _ = await setup_program(api)
    first = await api.course(program_id, term_id)
    second = await api.course(program_id, term_id, code="MAT186H1", title="Calculus")
    await api.link(first, "101")
    await api.link(second, "102")
    for course in (first, second):
        await api.call("GET", f"/courses/{course}/lms/assignments")
    fake.calls.clear()
    state = await api.call("POST", f"/courses/{first}/lms:refresh")
    assert state["link"]["external_course_id"] == "101"
    for course in (first, second):
        await api.call("GET", f"/courses/{course}/lms/assignments")
    assert fake.calls == [("assignments", "101")]  # the other course stays cached


async def test_sync_keeps_the_course_content_cached(api: Api, fake: FakeProvider):
    program_id, term_id, _ = await setup_program(api)
    course = await api.course(program_id, term_id)
    await api.link(course, "101")
    await api.call("GET", f"/courses/{course}/lms/assignments")
    await api.call("POST", f"/courses/{course}/lms-link:sync")
    fake.calls.clear()
    await api.call("GET", f"/courses/{course}/lms/assignments")
    assert fake.calls == []


async def test_grades_reuse_the_assignments(api: Api, fake: FakeProvider):
    program_id, term_id, _ = await setup_program(api)
    course = await api.course(program_id, term_id)
    await api.link(course, "101")
    await api.call("GET", f"/courses/{course}/lms/assignments")
    grades = await api.call("GET", f"/courses/{course}/lms/grades")
    assert _count(fake, "assignments") == 1
    assert grades["items"][0]["kind"] == "total"
    assert [g["name"] for g in grades["items"][1:]] == ["Lab 1", "Lab 2", "Midterm"]
    assert grades["items"][1]["points_possible"] == 10


async def test_modules_carry_their_items(api: Api):
    program_id, term_id, _ = await setup_program(api)
    course = await api.course(program_id, term_id)
    await api.link(course, "101")
    out = await api.call("GET", f"/courses/{course}/lms/modules")
    week1, week2 = out["items"]
    assert [i["title"] for i in week1["items"]] == ["Intro"]
    assert week1["items"][0]["lock_explanation"] == "Opens Monday"  # shown as text
    assert week2["items"] is None


async def test_file_metadata_is_asked_once(api: Api, fake: FakeProvider):
    program_id, term_id, _ = await setup_program(api)
    course = await api.course(program_id, term_id)
    await api.link(course, "101")
    await api.call("GET", f"/courses/{course}/lms/files/f1")
    r = await api.client.get(f"/courses/{course}/lms/files/f1/content")
    assert r.content == b"hello"
    assert _count(fake, "file") == 1  # the download used the cached metadata


async def test_term_announcements_in_one_request(api: Api, fake: FakeProvider):
    program_id, term_id, _ = await setup_program(api)
    first = await api.course(program_id, term_id)
    second = await api.course(program_id, term_id, code="MAT186H1", title="Calculus")
    unlinked = await api.course(program_id, term_id, code="ESC101H1", title="Praxis")
    await api.link(first, "101")
    await api.link(second, "102")
    await api.call("GET", f"/courses/{first}/lms/announcements")  # cached already
    fake.calls.clear()
    out = await api.call("GET", f"/terms/{term_id}/lms/announcements")
    assert fake.calls == [("announcements", ["102"])]
    assert sorted(a["course_id"] for a in out["items"]) == sorted([first, second])
    assert sorted(out["linked_course_ids"]) == sorted([first, second])
    assert unlinked not in out["linked_course_ids"]
    # Stored per course: the course's own list is answered from it.
    fake.calls.clear()
    await api.call("GET", f"/courses/{second}/lms/announcements")
    assert fake.calls == []


def test_memory_level_is_bounded_by_size():
    from datetime import UTC, datetime, timedelta

    rt = LmsRuntime()
    later = datetime.now(UTC) + timedelta(minutes=5)
    rt.put("big", "c", None, later, "x" * (LRU_BYTES + 1))
    assert rt.get("big", datetime.now(UTC)) is None
    rt.put("a", "c", "course:1", later, "a")
    rt.put("b", "c", "course:2", later, "b")
    rt.drop("c", "course:1")
    assert rt.get("a", datetime.now(UTC)) is None
    assert rt.get("b", datetime.now(UTC)) == "b"
