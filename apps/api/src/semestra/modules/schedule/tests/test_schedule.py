"""Schedule and calendar over HTTP and the agent surface (M04 §8)."""

from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from icalendar import Calendar
from sqlalchemy import func, select

from semestra.core.capability import registry
from semestra.core.context import system_ctx
from semestra.modules.auth.models import AuthRateLimit
from semestra.modules.schedule.schemas import Occurrences
from semestra.testing import Clock, MakeUser, UserHandle, collect_events

LoginAs = Callable[[AsyncClient, UserHandle], Awaitable[str]]

WINTER = {
    "name": "Winter 2026",
    "start_date": "2026-01-05",
    "end_date": "2026-04-24",
    "breaks": [{"name": "Reading week", "start_date": "2026-02-14", "end_date": "2026-02-22"}],
}


class Api:
    def __init__(self, client: AsyncClient) -> None:
        self.client = client

    async def call(self, method: str, url: str, status: int = 200, **kwargs: Any) -> Any:
        r = await self.client.request(method, url, **kwargs)
        assert r.status_code == status, r.text
        return r.json()

    async def setup(self) -> tuple[str, str, str]:
        """A Program in Toronto with the winter term and one course."""
        program = await self.call(
            "POST", "/programs", json={"name": "BASc", "timezone": "America/Toronto"}
        )
        term = (await self.call("POST", f"/programs/{program['id']}/terms", json=WINTER))["term"]
        course = await self.call(
            "POST",
            f"/programs/{program['id']}/courses",
            json={"title": "Programming", "code": "APS105H1", "term_ids": [term["id"]]},
        )
        return program["id"], term["id"], course["id"]

    async def meeting(self, course_id: str, term_id: str, **body: Any) -> Any:
        payload = {
            "term_id": term_id,
            "type_code": "LEC",
            "section_code": "LEC0101",
            "weekday": 1,
            "start_time": "10:00",
            "end_time": "11:00",
            **body,
        }
        return await self.call("POST", f"/courses/{course_id}/meetings", json=payload)

    async def calendar(self, program_id: str, start: str, end: str, **params: Any) -> Any:
        return await self.call(
            "GET", f"/programs/{program_id}/calendar", params={"start": start, "end": end, **params}
        )


@pytest.fixture
async def api(client: AsyncClient, make_user: MakeUser, login_as: LoginAs) -> Api:
    await login_as(client, await make_user())
    return Api(client)


def classes(result: dict[str, Any]) -> list[dict[str, Any]]:
    return [o for o in result["items"] if o["kind"] == "class"]


async def test_builtin_event_types_and_custom_ones(api: Api):
    program_id, term_id, course_id = await api.setup()
    types = await api.call("GET", f"/programs/{program_id}/event-types")
    assert [t["code"] for t in types["items"]] == ["LEC", "PRA", "TUT"]
    assert all(t["builtin"] for t in types["items"])

    lab = await api.call(
        "POST", f"/programs/{program_id}/event-types", json={"code": "lab", "name": "Lab"}
    )
    assert lab["code"] == "LAB"
    assert lab["position"] == 3
    await api.call(
        "POST",
        f"/programs/{program_id}/event-types",
        409,
        json={"code": "LAB", "name": "Again"},
    )
    lec = types["items"][0]
    await api.call("PATCH", f"/event-types/{lec['id']}", 422, json={"name": "Talk"})
    recolored = await api.call("PATCH", f"/event-types/{lec['id']}", json={"color": "subject-3"})
    assert recolored["color"] == "subject-3"
    await api.call("DELETE", f"/event-types/{lec['id']}", 422)

    await api.meeting(course_id, term_id, type_code="LAB")
    err = await api.call("DELETE", f"/event-types/{lab['id']}", 409)
    assert err["error"] == {
        "code": "schedule.event_type_in_use",
        "params": {"count": 1},
        "request_id": err["error"]["request_id"],
    }
    order = await api.call(
        "PUT",
        f"/programs/{program_id}/event-types:order",
        json={"event_type_ids": [lab["id"]]},
    )
    assert [t["code"] for t in order["items"]] == ["LAB", "LEC", "PRA", "TUT"]


async def test_meeting_validation(api: Api):
    program_id, term_id, course_id = await api.setup()
    other = await api.call(
        "POST",
        f"/programs/{program_id}/terms",
        json={"name": "Summer", "start_date": "2026-05-11", "end_date": "2026-08-14"},
    )
    r = await api.call(
        "POST",
        f"/courses/{course_id}/meetings",
        422,
        json={
            "term_id": other["term"]["id"],
            "type_code": "LEC",
            "weekday": 1,
            "start_time": "10:00",
            "end_time": "11:00",
        },
    )
    assert r["error"]["code"] == "schedule.term_not_in_course"
    r = await api.call(
        "POST",
        f"/courses/{course_id}/meetings",
        422,
        json={
            "term_id": term_id,
            "type_code": "LEC",
            "weekday": 1,
            "start_time": "11:00",
            "end_time": "10:00",
        },
    )
    assert r["error"]["code"] == "schedule.time_range_invalid"
    r = await api.call(
        "POST",
        f"/courses/{course_id}/meetings",
        422,
        json={
            "term_id": term_id,
            "type_code": "LEC",
            "weekday": 1,
            "start_time": "10:00",
            "end_time": "11:00",
            "start_week": 5,
            "end_week": 3,
        },
    )
    assert r["error"]["code"] == "schedule.week_range_invalid"
    r = await api.call(
        "POST",
        f"/courses/{course_id}/meetings",
        422,
        json={
            "term_id": term_id,
            "type_code": "XYZ",
            "weekday": 1,
            "start_time": "10:00",
            "end_time": "11:00",
        },
    )
    assert r["error"]["code"] == "common.validation"


async def test_calendar_expands_meetings_with_breaks_and_dst(api: Api):
    program_id, term_id, course_id = await api.setup()
    await api.meeting(course_id, term_id, location="BA1130")
    result = await api.calendar(program_id, "2026-02-09", "2026-03-16")
    starts = [o["start_at"] for o in classes(result)]
    # Reading week (Feb 16) has no class; Mar 9 is after the DST switch (EDT: UTC-4).
    assert starts == [
        "2026-02-09T15:00:00Z",
        "2026-02-23T15:00:00Z",
        "2026-03-02T15:00:00Z",
        "2026-03-09T14:00:00Z",
    ]
    first = classes(result)[0]
    assert first["id"].startswith("schedule.meetings:")
    assert first["id"].endswith(":2026-02-09")
    assert first["title"] == "APS105H1"
    assert first["type_code"] == "LEC"
    assert first["color_ref"].startswith("subject-")
    assert first["meta"]["week_number"] == 6
    assert first["meta"]["section_code"] == "LEC0101"
    assert result["timezone"] == "America/Toronto"
    assert [w["number"] for w in result["weeks"]] == [6, None, 7, 8, 9, 10]
    assert result["weeks"][1]["break_name"] == "Reading week"
    assert result["breaks"][0]["name"] == "Reading week"


async def test_count_break_weeks_shifts_the_week_range(api: Api):
    program_id, term_id, course_id = await api.setup()
    await api.meeting(course_id, term_id, start_week=7, end_week=8)
    got = [
        o["start_at"][:10]
        for o in classes(await api.calendar(program_id, "2026-02-01", "2026-04-01"))
    ]
    assert got == ["2026-02-23", "2026-03-02"]
    await api.call("PATCH", f"/terms/{term_id}", json={"count_break_weeks": True})
    got = [
        o["start_at"][:10]
        for o in classes(await api.calendar(program_id, "2026-02-01", "2026-04-01"))
    ]
    assert got == ["2026-02-23"]


async def test_fall_dst_end(api: Api):
    program_id, _, _ = await api.setup()
    fall = await api.call(
        "POST",
        f"/programs/{program_id}/terms",
        json={"name": "Fall 2026", "start_date": "2026-09-08", "end_date": "2026-12-11"},
    )
    course = await api.call(
        "POST",
        f"/programs/{program_id}/courses",
        json={"title": "Calculus", "term_ids": [fall["term"]["id"]]},
    )
    await api.meeting(course["id"], fall["term"]["id"])
    got = classes(await api.calendar(program_id, "2026-10-26", "2026-11-03"))
    assert [o["start_at"] for o in got] == ["2026-10-26T14:00:00Z", "2026-11-02T15:00:00Z"]


async def test_exceptions_cancel_and_move(api: Api):
    program_id, term_id, course_id = await api.setup()
    meeting = await api.meeting(course_id, term_id)
    mid = meeting["id"]
    await api.call(
        "PUT", f"/meetings/{mid}/exceptions/2026-02-09", json={"kind": "cancelled", "note": "Sick"}
    )
    # Move the Mar 2 class out of its week to the Friday, later in the day.
    moved = await api.call(
        "PUT",
        f"/meetings/{mid}/exceptions/2026-03-02",
        json={
            "kind": "moved",
            "new_date": "2026-03-06",
            "new_start_time": "14:00",
            "new_end_time": "15:30",
            "new_location": "MY150",
        },
    )
    assert [e["original_date"] for e in moved["exceptions"]] == ["2026-02-09", "2026-03-02"]
    await api.call("PUT", f"/meetings/{mid}/exceptions/2026-02-10", 422, json={"kind": "cancelled"})
    got = classes(await api.calendar(program_id, "2026-02-09", "2026-03-09"))
    by_date = {o["meta"]["original_date"]: o for o in got}
    assert by_date["2026-02-09"]["status"] == "cancelled"
    assert by_date["2026-02-09"]["meta"]["note"] == "Sick"
    assert by_date["2026-03-02"]["status"] == "moved"
    assert by_date["2026-03-02"]["start_at"] == "2026-03-06T19:00:00Z"
    assert by_date["2026-03-02"]["end_at"] == "2026-03-06T20:30:00Z"
    assert by_date["2026-03-02"]["location"] == "MY150"
    # A class moved out of the range disappears from it.
    outside = classes(await api.calendar(program_id, "2026-03-02", "2026-03-04"))
    assert outside == []
    # The last class can move past the end of its term and still shows up on its new date.
    await api.call(
        "PUT",
        f"/meetings/{mid}/exceptions/2026-04-20",
        json={"kind": "moved", "new_date": "2026-04-28"},
    )
    after_term = classes(await api.calendar(program_id, "2026-04-27", "2026-05-04"))
    assert [o["start_at"] for o in after_term] == ["2026-04-28T14:00:00Z"]

    restored = await api.call("DELETE", f"/meetings/{mid}/exceptions/2026-02-09")
    assert [e["original_date"] for e in restored["exceptions"]] == ["2026-03-02", "2026-04-20"]
    await api.call("DELETE", f"/meetings/{mid}/exceptions/2026-02-09", 404)


async def test_disabled_and_biweekly_and_conflicts(api: Api):
    program_id, term_id, course_id = await api.setup()
    lec = await api.meeting(course_id, term_id)
    tut1 = await api.meeting(
        course_id,
        term_id,
        type_code="TUT",
        section_code="TUT0101",
        start_time="10:30",
        end_time="11:30",
    )
    tut2 = await api.meeting(
        course_id,
        term_id,
        type_code="TUT",
        section_code="TUT0102",
        weekday=3,
        recurrence="biweekly",
        anchor_week=2,
    )
    conflicts = await api.call("GET", f"/terms/{term_id}/schedule-conflicts")
    assert [(c["meeting_id"], c["other_meeting_id"]) for c in conflicts["items"]] == [
        (lec["id"], tut1["id"])
    ]
    week = await api.calendar(program_id, "2026-01-11", "2026-01-18")
    lec_occ = next(o for o in classes(week) if o["meta"]["meeting_id"] == lec["id"])
    tut_occ = next(o for o in classes(week) if o["meta"]["meeting_id"] == tut1["id"])
    assert lec_occ["meta"]["conflicts_with"] == [tut_occ["id"]]
    assert [o["start_at"][:10] for o in classes(week) if o["meta"]["meeting_id"] == tut2["id"]] == [
        "2026-01-14"
    ]

    listed = await api.call(
        "PUT",
        f"/courses/{course_id}/meetings:enabled",
        json={"meeting_ids": [tut1["id"]], "enabled": False},
    )
    assert {m["id"]: m["enabled"] for m in listed["items"]}[tut1["id"]] is False
    week = await api.calendar(program_id, "2026-01-11", "2026-01-18")
    assert tut1["id"] not in {o["meta"]["meeting_id"] for o in classes(week)}
    assert (await api.call("GET", f"/terms/{term_id}/schedule-conflicts"))["items"] == []


async def test_create_many_dedupes_by_source(api: Api):
    _, term_id, course_id = await api.setup()
    item = {
        "term_id": term_id,
        "type_code": "LEC",
        "weekday": 2,
        "start_time": "09:00",
        "end_time": "10:00",
        "source_kind": "ics",
        "source_ref": "uid-1",
    }
    first = await api.call(
        "POST", f"/courses/{course_id}/meetings:batch", json={"meetings": [item]}
    )
    assert len(first["created_ids"]) == 1
    again = await api.call(
        "POST",
        f"/courses/{course_id}/meetings:batch",
        json={"meetings": [{**item, "location": "BA1160"}]},
    )
    assert again["created_ids"] == []
    assert again["updated_ids"] == first["created_ids"]
    listed = await api.call("GET", f"/courses/{course_id}/meetings")
    assert [m["location"] for m in listed["items"]] == ["BA1160"]


async def test_one_off_events(api: Api):
    program_id, term_id, course_id = await api.setup()
    midterm = await api.call(
        "POST",
        f"/programs/{program_id}/events",
        json={
            "title": "Midterm",
            "start_at": "2026-02-25T18:00",  # no offset: Toronto time
            "end_at": "2026-02-25T20:00",
            "course_id": course_id,
            "term_id": term_id,
        },
    )
    assert midterm["start_at"] == "2026-02-25T23:00:00Z"
    holiday = await api.call(
        "POST",
        f"/programs/{program_id}/events",
        json={
            "title": "Study day",
            "start_at": "2026-02-27T00:00:00-05:00",
            "end_at": "2026-02-27T00:00:00-05:00",
            "all_day": True,
        },
    )
    assert (holiday["start_at"], holiday["end_at"]) == (
        "2026-02-27T05:00:00Z",
        "2026-02-28T05:00:00Z",
    )
    moved = await api.call(
        "PATCH", f"/events/{midterm['id']}", json={"start_at": "2026-02-26T18:00:00-05:00"}
    )
    assert (moved["start_at"], moved["end_at"]) == ("2026-02-26T23:00:00Z", "2026-02-27T01:00:00Z")
    await api.call(
        "POST",
        f"/programs/{program_id}/events",
        422,
        json={"title": "Bad", "start_at": "2026-02-26T18:00", "end_at": "2026-02-26T17:00"},
    )
    result = await api.calendar(program_id, "2026-02-26", "2026-02-28")
    kinds = [(o["kind"], o["title"], o["all_day"]) for o in result["items"]]
    assert kinds == [("event", "APS105H1 · Midterm", False), ("event", "Study day", True)]
    listed = await api.call(
        "GET", f"/programs/{program_id}/events", params={"course_id": course_id}
    )
    assert [e["id"] for e in listed["items"]] == [midterm["id"]]
    await api.call("DELETE", f"/events/{midterm['id']}")
    assert (await api.call("GET", f"/programs/{program_id}/events"))["items"][0][
        "title"
    ] == "Study day"


async def test_range_limit_and_source_filter(api: Api):
    program_id, term_id, course_id = await api.setup()
    await api.meeting(course_id, term_id)
    r = await api.call(
        "GET",
        f"/programs/{program_id}/calendar",
        422,
        params={"start": "2026-01-01", "end": "2026-06-01"},
    )
    assert r["error"]["code"] == "schedule.range_too_large"
    only_events = await api.calendar(
        program_id, "2026-01-05", "2026-01-12", sources=["schedule.events"]
    )
    assert only_events["items"] == []
    by_course = await api.calendar(program_id, "2026-01-05", "2026-01-12", course_ids=["nope"])
    assert by_course["items"] == []


async def test_today(client: AsyncClient, make_user: MakeUser, login_as: LoginAs, clock: Clock):
    user = await make_user()
    await login_as(client, user)
    api = Api(client)
    program_id, term_id, course_id = await api.setup()
    # The clock is Thu 2026-01-15 12:00 UTC, i.e. 07:00 in Toronto.
    await api.meeting(course_id, term_id, weekday=4, start_time="09:00", end_time="10:00")
    await api.call(
        "POST",
        f"/programs/{program_id}/events",
        json={"title": "Office hour", "start_at": "2026-01-15T15:00", "end_at": "2026-01-15T16:00"},
    )
    today = await api.call("GET", f"/programs/{program_id}/today")
    assert today["day"] == "2026-01-15"
    assert today["week"]["number"] == 2
    assert today["week"]["term_name"] == "Winter 2026"
    assert [o["title"] for o in today["items"]] == ["APS105H1", "Office hour"]
    assert today["upcoming"] == []
    assert today["tasks"] == []
    clock.advance(days=35)  # Feb 19: reading week
    await login_as(client, user)  # the session would have expired
    today = await api.call("GET", f"/programs/{program_id}/today")
    assert today["week"]["number"] is None
    assert today["week"]["break_name"] == "Reading week"
    assert today["items"] == []


async def test_ics_export_and_feed(api: Api, client: AsyncClient):
    program_id, term_id, course_id = await api.setup()
    await api.meeting(course_id, term_id, location="BA1130")
    r = await client.get(
        f"/programs/{program_id}/calendar.ics", params={"start": "2026-01-05", "end": "2026-04-25"}
    )
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/calendar")
    cal = Calendar.from_ical(r.content)
    events_ = list(cal.walk("VEVENT"))
    assert len(events_) == 15
    assert str(events_[0]["SUMMARY"]) == "APS105H1 LEC0101"
    assert str(events_[0]["LOCATION"]) == "BA1130"
    # Courses hidden in the calendar filters stay out of the export.
    hidden = await client.get(
        f"/programs/{program_id}/calendar.ics",
        params={"start": "2026-01-05", "end": "2026-04-25", "exclude_course_ids": [course_id]},
    )
    assert list(Calendar.from_ical(hidden.content).walk("VEVENT")) == []

    created = await api.call(
        "POST", f"/programs/{program_id}/calendar-feeds", json={"name": "iPhone"}
    )
    url = created["url"]
    assert url.startswith("https://test/feeds/")
    assert url.endswith(".ics")
    path = url.removeprefix("https://test")
    anonymous = AsyncClient(transport=client._transport, base_url="https://test")  # pyright: ignore[reportPrivateUsage]
    feed = await anonymous.get(path)
    assert feed.status_code == 200
    assert len(list(Calendar.from_ical(feed.content).walk("VEVENT"))) == 15
    listed = await api.call("GET", f"/programs/{program_id}/calendar-feeds")
    assert listed["items"][0]["last_fetched_at"] is not None
    assert "url" not in listed["items"][0]

    await api.call("DELETE", f"/calendar-feeds/{created['feed']['id']}")
    gone = await anonymous.get(path)
    assert gone.status_code == 404
    assert gone.json()["error"]["code"] == "schedule.feed_revoked"
    unknown = await anonymous.get("/feeds/nope.ics")
    assert unknown.status_code == 404
    assert unknown.json()["error"]["code"] == "common.not_found"


async def test_feed_rate_limit(api: Api, client: AsyncClient, app: FastAPI):
    program_id, _, _ = await api.setup()
    # Unknown tokens are rejected before the limiter, so they cannot fill its table.
    for n in range(3):
        assert (await client.get(f"/feeds/guess{n}.ics")).status_code == 404
    async with app.state.session_factory() as db:
        assert await db.scalar(select(func.count()).select_from(AuthRateLimit)) == 0
    created = await api.call("POST", f"/programs/{program_id}/calendar-feeds", json={"name": "A"})
    path = created["url"].removeprefix("https://test")
    for _ in range(60):
        assert (await client.get(path)).status_code == 200
    r = await client.get(path)
    assert r.status_code == 429
    assert r.json()["error"]["code"] == "common.rate_limited"


async def test_cleanup_on_course_and_term_changes(api: Api, app: FastAPI):
    program_id, term_id, course_id = await api.setup()
    user_id = (await api.call("GET", "/account/me"))["id"]
    second = await api.call(
        "POST",
        f"/programs/{program_id}/terms",
        json={"name": "Summer", "start_date": "2026-05-11", "end_date": "2026-08-14"},
    )
    summer_id = second["term"]["id"]
    await api.call("PUT", f"/courses/{course_id}/terms", json={"term_ids": [term_id, summer_id]})
    await api.meeting(course_id, term_id)
    await api.meeting(course_id, summer_id)
    assert len((await api.call("GET", f"/courses/{course_id}/meetings"))["items"]) == 2
    summer_exam = await api.call(
        "POST",
        f"/programs/{program_id}/events",
        json={
            "title": "Summer quiz",
            "start_at": "2026-06-01T09:00",
            "end_at": "2026-06-01T10:00",
            "course_id": course_id,
            "term_id": summer_id,
        },
    )
    # Leaving the summer term drops its meetings; its events keep the course but not the term,
    # and clients hear about it after the clean-up commits.
    with collect_events(app, user_id) as pushed:
        await api.call("PUT", f"/courses/{course_id}/terms", json={"term_ids": [term_id]})
    assert [m["type"] for m in pushed][-3:] == [
        "schedule.meeting.deleted",
        "schedule.event.updated",
        "calendar.changed",
    ]
    meetings = (await api.call("GET", f"/courses/{course_id}/meetings"))["items"]
    assert [m["term_id"] for m in meetings] == [term_id]
    quiz = await api.call("PATCH", f"/events/{summer_exam['id']}", json={"title": "Quiz"})
    assert (quiz["course_id"], quiz["term_id"]) == (course_id, None)
    await api.call("DELETE", f"/events/{summer_exam['id']}")

    await api.call(
        "POST",
        f"/programs/{program_id}/events",
        json={
            "title": "Exam",
            "start_at": "2026-04-20T09:00",
            "end_at": "2026-04-20T11:00",
            "course_id": course_id,
        },
    )
    await api.call("DELETE", f"/courses/{course_id}")
    assert (await api.call("GET", f"/programs/{program_id}/events"))["items"] == []
    assert classes(await api.calendar(program_id, "2026-01-05", "2026-02-01")) == []
    await api.call("DELETE", f"/programs/{program_id}")


async def test_other_users_data_is_not_found(
    api: Api, client: AsyncClient, make_user: MakeUser, login_as: LoginAs
):
    program_id, term_id, course_id = await api.setup()
    meeting = await api.meeting(course_id, term_id)
    event = await api.call(
        "POST",
        f"/programs/{program_id}/events",
        json={"title": "Exam", "start_at": "2026-04-20T09:00", "end_at": "2026-04-20T11:00"},
    )
    await login_as(client, await make_user(email="other@example.com"))
    for method, url in [
        ("GET", f"/programs/{program_id}/calendar?start=2026-01-05&end=2026-01-12"),
        ("GET", f"/programs/{program_id}/today"),
        ("GET", f"/programs/{program_id}/event-types"),
        ("GET", f"/courses/{course_id}/meetings"),
        ("PATCH", f"/meetings/{meeting['id']}"),
        ("DELETE", f"/meetings/{meeting['id']}"),
        ("PUT", f"/meetings/{meeting['id']}/exceptions/2026-01-05"),
        ("PATCH", f"/events/{event['id']}"),
        ("DELETE", f"/events/{event['id']}"),
        ("GET", f"/terms/{term_id}/schedule-conflicts"),
        ("GET", f"/programs/{program_id}/calendar-feeds"),
        ("GET", f"/programs/{program_id}/calendar.ics?start=2026-01-05&end=2026-01-12"),
    ]:
        body = {"kind": "cancelled"} if method == "PUT" else {} if method == "PATCH" else None
        r = await client.request(method, url, json=body)
        assert r.status_code == 404, (method, url, r.text)


async def test_agent_surface(
    app: FastAPI, client: AsyncClient, make_user: MakeUser, login_as: LoginAs
):
    user = await make_user()
    await login_as(client, user)
    api = Api(client)
    program_id, term_id, course_id = await api.setup()
    await api.meeting(course_id, term_id)
    agent_names = {c.name for c in registry.list(expose="agent")}
    assert {"calendar.today", "calendar.occurrences", "schedule.exception.upsert"} <= agent_names
    assert "schedule.feed.create" not in agent_names  # the link is a secret
    assert registry.get("calendar.today").agent_core
    async with system_ctx(app.state, user.id) as ctx:
        result = await registry.invoke(
            ctx,
            "calendar.occurrences",
            {"program_id": program_id, "start": "2026-01-05", "end": "2026-01-06"},
            "agent",
        )
    assert isinstance(result, Occurrences)
    assert len(result.items) == 1


async def test_feed_window_moves_with_today(api: Api, clock: Clock):
    """The feed covers the last 12 months: a class from a year and a half ago drops out."""
    program_id, term_id, course_id = await api.setup()
    await api.meeting(course_id, term_id)
    created = await api.call("POST", f"/programs/{program_id}/calendar-feeds", json={"name": "A"})
    path = created["url"].removeprefix("https://test")
    clock.advance(days=540)
    r = await api.client.get(path)  # no session needed
    assert r.status_code == 200
    assert list(Calendar.from_ical(r.content).walk("VEVENT")) == []


async def test_calendar_hours_must_increase(api: Api):
    await api.setup()
    body = {"scope_type": "account", "values": {"day_start": "22:00", "day_end": "08:00"}}
    r = await api.call("PATCH", "/settings/calendar", 422, json=body)
    assert r["error"]["code"] == "settings.invalid_value"
    body["values"] = {"day_start": "09:00"}
    await api.call("PATCH", "/settings/calendar", json=body)
    await api.call(
        "PATCH",
        "/settings/calendar",
        422,
        json={"scope_type": "account", "values": {"day_end": "09:00"}},
    )


async def test_moving_an_all_day_event_keeps_its_days_across_dst(api: Api):
    program_id, _, _ = await api.setup()
    # Oct 31 to Nov 1 in Toronto spans the fall DST change, so it lasts 49 hours.
    event = await api.call(
        "POST",
        f"/programs/{program_id}/events",
        json={
            "title": "Retreat",
            "start_at": "2026-10-31T00:00",
            "end_at": "2026-11-02T00:00",
            "all_day": True,
        },
    )
    assert (event["start_at"], event["end_at"]) == ("2026-10-31T04:00:00Z", "2026-11-02T05:00:00Z")
    moved = await api.call("PATCH", f"/events/{event['id']}", json={"start_at": "2026-12-05T00:00"})
    assert (moved["start_at"], moved["end_at"]) == ("2026-12-05T05:00:00Z", "2026-12-07T05:00:00Z")


async def test_editing_a_weekly_meeting_with_a_null_anchor(api: Api):
    _, term_id, course_id = await api.setup()
    meeting = await api.meeting(course_id, term_id, start_week=3)
    # The meeting dialog sends every field; weekly meetings carry no anchor.
    edited = await api.call(
        "PATCH",
        f"/meetings/{meeting['id']}",
        json={"location": "MY150", "recurrence": "weekly", "anchor_week": None},
    )
    assert (edited["location"], edited["anchor_week"]) == ("MY150", 3)
