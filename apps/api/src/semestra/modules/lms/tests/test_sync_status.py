"""What a course's last sync left not updated, as the course's settings and the sync panel
tell it (M09 表 5c). Each row's reasons by read and answer are in `test_sync_failures`; here,
the course's state and the rows the panel leaves out."""

from typing import Any

import pytest

from semestra.modules.lms.errors import lms_error
from semestra.modules.lms.tests.conftest import Api, FakeProvider, SyncFailures, report
from semestra.modules.lms.tests.test_sync import _course
from semestra.testing import Clock


async def _state(api: Api, course: str) -> str:
    return (await api.call("GET", f"/courses/{course}/lms-link"))["link"]["sync_state"]


async def test_the_course_state_is_what_its_rows_tell(
    api: Api,
    fake: FakeProvider,
    clock: Clock,
    monkeypatch: pytest.MonkeyPatch,
    expect_sync_failures: SyncFailures,
):
    program_id, course = await _course(api)
    await api.sync(program_id)
    assert await _state(api, course) == "ok"

    # The platform not answering for a part: not updated ("stale").
    async def unreachable(*_: Any, **__: Any) -> Any:
        raise lms_error("lms.unreachable")

    with monkeypatch.context() as mp:
        mp.setattr(type(fake), "announcements", unreachable)
        clock.advance(minutes=1)
        status = await api.sync(program_id)
    assert report(status) == {(6, ("announcements",), "lms.unreachable")}
    assert await _state(api, course) == "stale"

    # Semestra's own problem: an error ("failed"), above what the platform did not give.
    async def broken(*_: Any, **__: Any) -> Any:
        raise RuntimeError("provider bug")

    with monkeypatch.context() as mp:
        mp.setattr(type(fake), "announcements", broken)
        clock.advance(minutes=1)
        status = await api.sync(program_id)
    assert report(status) == {(4, "announcements", "common.internal")}
    assert await _state(api, course) == "failed"

    # Read back: nothing left, by itself.
    clock.advance(minutes=1)
    status = await api.sync(program_id)
    assert report(status) == set()
    assert await _state(api, course) == "ok"


async def test_a_course_the_platform_refuses_is_one_row(
    api: Api, fake: FakeProvider, clock: Clock, monkeypatch: pytest.MonkeyPatch
):
    """表 5c, row 5: the course itself refused says it all; its parts are not listed too."""
    program_id, course = await _course(api)
    await api.sync(program_id)

    async def refused(*_: Any, **__: Any) -> Any:
        raise lms_error("lms.forbidden")

    monkeypatch.setattr(type(fake), "get_course", refused)
    clock.advance(minutes=1)
    status = await api.sync(program_id)
    assert report(status) == {(5, ("course",), "lms.forbidden")}
    assert await _state(api, course) == "stale"


async def test_an_area_never_open_is_not_listed(api: Api, fake: FakeProvider, clock: Clock):
    """表 5c, row 10: nothing of it in Semestra, so nothing is out of date; closed after it was
    read, it is listed (row 8), though as the teacher's setting, not as out of date."""
    fake.files_hidden = True
    program_id, course = await _course(api)
    status = await api.sync(program_id)
    assert report(status) == set()
    assert await _state(api, course) == "ok"

    fake.files_hidden = False
    clock.advance(minutes=1)
    await api.sync(program_id)
    fake.files_hidden = True
    clock.advance(minutes=1)
    status = await api.sync(program_id)
    assert report(status) == {(8, "files")}
    assert await _state(api, course) == "ok"


async def test_a_course_the_sync_no_longer_visits_keeps_only_its_calendar_listed(
    api: Api, fake: FakeProvider, clock: Clock
):
    """表 5c: of a course whose term ended more than 30 days ago only the calendar is read, so
    what its last visit left (rows 8, 9) is not listed for ever: it would never read back."""
    program_id, course = await _course(api, "a1")
    await api.sync(program_id)
    fake.assignments_hidden = True  # closed: a1 is read on its own
    fake.faults["assignment"] = lms_error("lms.unreachable")
    clock.advance(minutes=1)
    status = await api.sync(program_id)
    assert report(status) == {
        (8, "assignments"),
        (9, "assignment", "Lab 1", "lms.unreachable"),
    }
    assert await _state(api, course) == "stale"

    # Its term moved to last fall: ended more than 30 days ago.
    [term] = (await api.call("GET", f"/programs/{program_id}/terms"))["items"]
    ended = {"start_date": "2025-09-02", "end_date": "2025-12-05"}
    await api.call("PATCH", f"/terms/{term['id']}", json=ended)
    status = await api.call("GET", f"/programs/{program_id}/lms/sync")
    assert report(status) == set()
    assert await _state(api, course) == "ok"
