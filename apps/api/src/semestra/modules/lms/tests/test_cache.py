"""The read cache and the reads that share it (M09 §2.4): what goes to the platform once."""

import pytest

from semestra.modules.lms.cache import LRU_BYTES, LmsRuntime
from semestra.modules.lms.tests.conftest import Api, FakeProvider
from semestra.modules.lms.tests.test_lms import setup_program

pytestmark = pytest.mark.usefixtures("fake")


def _count(fake: FakeProvider, name: str) -> int:
    return sum(1 for call, _ in fake.calls if call == name)


async def test_refresh_drops_one_course_and_syncs_it(api: Api, fake: FakeProvider):
    program_id, term_id, _ = await setup_program(api)
    first = await api.course(program_id, term_id)
    second = await api.course(program_id, term_id, code="MAT186H1", title="Calculus")
    await api.link(first, "101")
    await api.link(second, "102")
    for course in (first, second):
        await api.call("GET", f"/courses/{course}/lms/modules")
    fake.calls.clear()
    state = await api.call("POST", f"/courses/{first}/lms:refresh")
    assert state["link"]["external_course_id"] == "101"
    for course in (first, second):
        await api.call("GET", f"/courses/{course}/lms/modules")
    assert fake.calls == [("modules", "101")]  # the other course stays cached
    # What the app keeps of the course (announcements) is read again too.
    await api.run_jobs()
    links = {
        li["course_id"]: li
        for li in (await api.call("GET", f"/programs/{program_id}/lms-links"))["items"]
    }
    assert links[first]["synced_at"] is not None
    assert links[second]["synced_at"] is None


async def test_assignments_are_read_from_the_mirror_once_synced(api: Api, fake: FakeProvider):
    program_id, term_id, _ = await setup_program(api)
    course = await api.course(program_id, term_id)
    await api.link(course, "101")
    await api.sync(program_id, course)
    fake.calls.clear()
    await api.call("GET", f"/courses/{course}/lms/assignments")
    assert fake.calls == []


async def test_modules_carry_their_items(api: Api):
    program_id, term_id, _ = await setup_program(api)
    course = await api.course(program_id, term_id)
    await api.link(course, "101")
    out = await api.call("GET", f"/courses/{course}/lms/modules")
    week1, week2 = out["items"]
    assert [i["title"] for i in week1["items"]] == ["Intro"]
    assert week1["items"][0]["lock_explanation"] == "Opens Monday"  # shown as text
    assert week1["items"][0]["due_state"] == "none"  # worked out as read (table 3d)
    assert week2["items"] is None


async def test_file_metadata_is_asked_once(api: Api, fake: FakeProvider):
    program_id, term_id, _ = await setup_program(api)
    course = await api.course(program_id, term_id)
    await api.link(course, "101")
    await api.call("GET", f"/courses/{course}/lms/files/f1")
    r = await api.client.get(f"/courses/{course}/lms/files/f1/content")
    assert r.content == b"hello"
    assert _count(fake, "file") == 1  # the download used the cached metadata


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


async def test_module_items_come_from_the_cached_modules(api: Api, fake: FakeProvider):
    program_id, term_id, _ = await setup_program(api)
    course = await api.course(program_id, term_id)
    await api.link(course, "101")
    await api.call("GET", f"/courses/{course}/lms/modules")
    fake.calls.clear()
    out = await api.call("GET", f"/courses/{course}/lms/modules/m1/items")
    assert [i["title"] for i in out["items"]] == ["Intro"]
    assert fake.calls == []
    # A module the platform sent without items is still asked for.
    await api.call("GET", f"/courses/{course}/lms/modules/m2/items")
    assert _count(fake, "module_items") == 1
