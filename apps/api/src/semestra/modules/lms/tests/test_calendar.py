"""Calendar events kept by the course sync (M09 §4.8): stored, following the platform, read by
the calendar without asking it; which courses' calendars were never read, or never could be."""

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi import FastAPI

from semestra.modules.lms.schemas.dto import LmsCalendarEvent
from semestra.modules.lms.tests.conftest import Api, FakeProvider
from semestra.modules.lms.tests.test_lms import setup_program
from semestra.testing import Clock, collect_events

pytestmark = pytest.mark.usefixtures("fake")

WHEN = datetime(2026, 2, 6, 15, 0, tzinfo=UTC)


def event(external_id: str, course: str, title: str, at: datetime = WHEN, **kw: Any):
    return LmsCalendarEvent(
        external_id=external_id, external_course_id=course, title=title, start_at=at, **kw
    )


async def overlay(api: Api, program_id: str, start: str = "2026-02-01", end: str = "2026-02-10"):
    out = await api.call(
        "GET", f"/programs/{program_id}/calendar?start={start}&end={end}&sources=lms.events"
    )
    return sorted(i["title"] for i in out["items"])


async def _two_courses(api: Api) -> tuple[str, str, str]:
    program_id, term_id, _ = await setup_program(api)
    course_a = await api.course(program_id, term_id)
    course_b = await api.course(program_id, term_id, code="MAT186H1", title="Calculus")
    await api.link(course_a, "101")
    await api.link(course_b, "102")
    return program_id, course_a, course_b


async def test_the_calendar_shows_what_the_sync_kept_without_asking_the_platform(
    api: Api, fake: FakeProvider, app: FastAPI
):
    program_id, _, course_b = await _two_courses(api)
    fake.events = [
        event("e1", "101", "Review session", html="<p>Room <b>5</b></p>"),
        event("e2", "102", "Tutorial"),
        # Of any date: the sync keeps them all.
        event("e3", "101", "Orientation", datetime(2025, 12, 1, 15, tzinfo=UTC)),
    ]
    user_id = (await api.call("GET", "/account/me"))["id"]
    with collect_events(app, user_id) as seen:
        await api.sync(program_id)
    assert {"program_id": program_id} in [
        m["data"] for m in seen if m["type"] == "calendar.changed"
    ]
    fake.calls.clear()
    assert await overlay(api, program_id) == ["APS105H1 · Review session", "MAT186H1 · Tutorial"]
    assert await overlay(api, program_id, "2025-11-30", "2025-12-02") == ["APS105H1 · Orientation"]
    out = await api.call(
        "GET", f"/programs/{program_id}/calendar?start=2026-02-01&end=2026-02-10&sources=lms.events"
    )
    review = next(i for i in out["items"] if i["title"].endswith("Review session"))
    assert (review["meta"]["note"], review["kind"]) == ("Room 5", "event")
    assert not [c for c in fake.calls if c[0] == "calendar_events"]

    # Unreachable now, the calendar still shows what was kept.
    fake.calendar_down = True
    assert len(await overlay(api, program_id)) == 2

    # Sync off: the course leaves the calendar.
    await api.call("PATCH", f"/courses/{course_b}/lms-link", json={"sync_enabled": False})
    assert await overlay(api, program_id) == ["APS105H1 · Review session"]


async def test_an_event_across_the_range_start_is_in_the_range(api: Api, fake: FakeProvider):
    program_id, _, _ = await _two_courses(api)
    late = datetime(2026, 2, 1, 4, 0, tzinfo=UTC)  # Saturday 23:00 in Toronto
    fake.events = [event("e1", "101", "Late lab", late, end_at=late + timedelta(hours=2))]
    await api.sync(program_id)
    # A week from Sunday (midnight in Toronto): it is still on then.
    assert await overlay(api, program_id, "2026-02-01", "2026-02-08") == ["APS105H1 · Late lab"]


async def test_the_kept_events_follow_the_platform(api: Api, fake: FakeProvider, app: FastAPI):
    program_id, _, _ = await _two_courses(api)
    fake.events = [event("e1", "101", "Review session"), event("e2", "101", "Office hours")]
    await api.sync(program_id)
    fake.events = [event("e1", "101", "Review session (moved)")]
    # A cut-off list does not say what it left out: nothing is deleted.
    fake.calendar_truncated = True
    await api.sync(program_id)
    assert await overlay(api, program_id) == [
        "APS105H1 · Office hours",
        "APS105H1 · Review session (moved)",
    ]
    # Read whole, what is not there has left.
    fake.calendar_truncated = False
    await api.sync(program_id)
    assert await overlay(api, program_id) == ["APS105H1 · Review session (moved)"]
    # Nothing changed: no event.
    user_id = (await api.call("GET", "/account/me"))["id"]
    with collect_events(app, user_id) as seen:
        await api.sync(program_id)
    assert not [e for e in seen if e["type"] == "calendar.changed"]


async def test_courses_whose_calendar_was_never_read_or_never_could_be(
    api: Api, fake: FakeProvider, clock: Clock
):
    program_id, _, _ = await _two_courses(api)
    status = await api.call("GET", f"/programs/{program_id}/lms/sync")
    assert (status["calendar_waiting"], status["calendar_unreadable"]) == (2, 0)
    # Tried and not read back: unreadable, not read.
    fake.calendar_down = True
    status = await api.sync(program_id)
    assert (status["calendar_waiting"], status["calendar_unreadable"]) == (0, 2)
    # Read once, it stays read when a later round cannot read it.
    fake.calendar_down = False
    clock.advance(minutes=2)
    await api.sync(program_id)
    fake.calendar_down = True
    clock.advance(minutes=2)
    status = await api.sync(program_id)
    assert (status["calendar_waiting"], status["calendar_unreadable"]) == (0, 0)


async def test_a_course_that_cannot_be_read_tried_its_calendar(api: Api, fake: FakeProvider):
    program_id, _, _ = await _two_courses(api)
    fake.courses = [c for c in fake.courses if c.external_id != "102"]
    status = await api.sync(program_id)
    assert (status["calendar_waiting"], status["calendar_unreadable"]) == (0, 1)


async def test_an_ended_course_reads_only_its_calendar_the_first_time(api: Api, fake: FakeProvider):
    program_id, _, _ = await setup_program(api)
    term = {"name": "Fall 2025", "start_date": "2025-09-02", "end_date": "2025-12-05"}
    term_id = (await api.call("POST", f"/programs/{program_id}/terms", json=term))["term"]["id"]
    course = await api.course(program_id, term_id)
    await api.link(course, "101")
    await api.run_jobs()
    fake.events = [event("e1", "101", "Final exam", datetime(2025, 12, 10, 14, tzinfo=UTC))]
    fake.calls.clear()
    # Opening the Program reads it, though its term ended long ago: its calendar only.
    await api.call("POST", f"/programs/{program_id}/lms/sync", json={"force": False})
    await api.run_jobs()
    read = {c[0] for c in fake.calls}
    assert "calendar_events" in read
    assert not read & {"assignments", "my_submissions", "announcements", "course_files"}
    assert await overlay(api, program_id, "2025-12-09", "2025-12-11") == ["APS105H1 · Final exam"]
    # Tried once, it is left to the usual rules: not read again on opening.
    fake.calls.clear()
    await api.call("POST", f"/programs/{program_id}/lms/sync", json={"force": False})
    await api.run_jobs()
    assert not [c for c in fake.calls if c[0] == "calendar_events"]
