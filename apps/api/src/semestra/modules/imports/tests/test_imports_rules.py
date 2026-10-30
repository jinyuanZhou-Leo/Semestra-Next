"""Pure parts of imports: ICS grouping, relative dates, category and type mapping (M08 §9)."""

from datetime import date, time, timedelta

import pytest

from semestra.core.config import Settings
from semestra.core.errors import AppError
from semestra.modules.files.tests.conftest import make_pdf
from semestra.modules.imports import build, dates, deps
from semestra.modules.imports.ics import parse_ics, section_of

TZ = "America/Toronto"


def ics(*events: str) -> bytes:
    body = "\r\n".join(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//EN", *events])
    return (body + "\r\nEND:VCALENDAR\r\n").encode()


def vevent(**props: str) -> str:
    lines = ["BEGIN:VEVENT"] + [f"{k.replace('_', '-').upper()}{v}" for k, v in props.items()]
    return "\r\n".join([*lines, "END:VEVENT"])


ACORN = ics(
    vevent(
        uid=":a1",
        summary=":APS105H1 LEC0101",
        dtstart=";TZID=America/Toronto:20260105T100000",
        dtend=";TZID=America/Toronto:20260105T110000",
        rrule=":FREQ=WEEKLY;UNTIL=20260410T235959Z;BYDAY=MO,WE",
        exdate=";TZID=America/Toronto:20260216T100000",
        location=":BA 1180",
    ),
    vevent(
        uid=":a2",
        summary=":APS105H1 TUT0103",
        dtstart=";TZID=America/Toronto:20260109T150000",
        dtend=";TZID=America/Toronto:20260109T170000",
        rrule=":FREQ=WEEKLY;INTERVAL=2;COUNT=6",
    ),
    vevent(
        uid=":a3",
        summary=":MAT188H1 LEC0201",
        dtstart=";TZID=America/Toronto:20260106T090000",
        dtend=";TZID=America/Toronto:20260106T100000",
        rrule=":FREQ=WEEKLY;UNTIL=20260407T140000Z",
    ),
    vevent(
        uid=":a4",
        summary=":APS105H1 Midterm",
        dtstart=";TZID=America/Toronto:20260226T183000",
        dtend=";TZID=America/Toronto:20260226T203000",
    ),
    vevent(
        uid=":a5",
        summary=":Reading week",
        dtstart=";VALUE=DATE:20260216",
        dtend=";VALUE=DATE:20260221",
    ),
)


def test_acorn_rrules_group_by_course_and_section():
    result = parse_ics(ACORN, TZ)
    assert [c.code for c in result.courses] == ["APS105H1", "MAT188H1"]
    aps = result.courses[0]
    assert [(m.section_code, m.weekday) for m in aps.meetings] == [
        ("LEC0101", 1),
        ("LEC0101", 3),
        ("TUT0103", 5),
    ]
    lec = aps.meetings[0]
    assert (lec.start_time, lec.end_time, lec.location) == (time(10), time(11), "BA 1180")
    # The last Monday before UNTIL, not UNTIL itself.
    assert (lec.first_date, lec.last_date) == (date(2026, 1, 5), date(2026, 4, 6))
    assert aps.meetings[1].first_date == date(2026, 1, 7)
    tut = aps.meetings[2]
    assert tut.recurrence == "biweekly"
    assert tut.type_code == "TUT"
    assert tut.last_date is not None
    assert tut.last_date >= date(2026, 3, 20)
    assert [e.title for e in aps.events] == ["APS105H1 Midterm"]
    assert [(e.title, e.all_day, e.day, e.end_day) for e in result.events] == [
        ("Reading week", True, date(2026, 2, 16), date(2026, 2, 20))
    ]


def test_one_event_per_class_is_merged_and_survives_dst():
    # A Google-style export: one VEVENT per class, in UTC. 8 March 2026 is the DST change in
    # Toronto, so the UTC hour changes while the local time stays 14:00.
    events = [
        vevent(uid=f":g{i}", summary=":CSC110Y1 LEC5101",
               dtstart=f":202603{d:02d}T{h}0000Z", dtend=f":202603{d:02d}T{h + 1}0000Z")
        for i, (d, h) in enumerate([(2, 19), (9, 18), (16, 18)])
    ]  # fmt: skip
    result = parse_ics(ics(*events), TZ)
    (course,) = result.courses
    (meeting,) = course.meetings
    assert (meeting.weekday, meeting.start_time, meeting.recurrence) == (1, time(14), "weekly")
    assert (meeting.first_date, meeting.last_date) == (date(2026, 3, 2), date(2026, 3, 16))
    assert build.year_long(course.code, None)


def test_moved_and_cancelled_dates_of_a_recurring_event():
    # Calendar apps export a change to one date as an override with the same UID and a
    # RECURRENCE-ID: 26 Jan is cancelled, 2 Feb moves to the afternoon.
    series = vevent(
        uid=":s1",
        summary=":CSC108H1 LEC0101",
        dtstart=";TZID=America/Toronto:20260112T100000",
        dtend=";TZID=America/Toronto:20260112T110000",
        rrule=":FREQ=WEEKLY;UNTIL=20260406T235959Z",
    )
    cancelled = vevent(
        uid=":s1",
        recurrence_id=";TZID=America/Toronto:20260126T100000",
        summary=":CSC108H1 LEC0101",
        dtstart=";TZID=America/Toronto:20260126T100000",
        dtend=";TZID=America/Toronto:20260126T110000",
        status=":CANCELLED",
    )
    moved = vevent(
        uid=":s1",
        recurrence_id=";TZID=America/Toronto:20260202T100000",
        summary=":CSC108H1 LEC0101",
        dtstart=";TZID=America/Toronto:20260202T140000",
        dtend=";TZID=America/Toronto:20260202T150000",
        location=":BA 1130",
    )
    (course,) = parse_ics(ics(series, cancelled, moved), TZ).courses
    (meeting,) = course.meetings
    assert meeting.start_time == time(10)
    assert meeting.exceptions == [date(2026, 1, 26), date(2026, 2, 2)]
    assert meeting.source_ref == "s1:1"
    (event,) = course.events
    assert (event.day, event.start_time, event.location) == (date(2026, 2, 2), time(14), "BA 1130")


def test_other_rule_shapes_expand_to_their_real_dates():
    every_third = vevent(
        uid=":t3",
        summary=":ECE297H1 PRA0101",
        dtstart=";TZID=America/Toronto:20260105T150000",
        dtend=";TZID=America/Toronto:20260105T170000",
        rrule=":FREQ=WEEKLY;INTERVAL=3;COUNT=4",
    )
    counted = vevent(
        uid=":c5",
        summary=":MAT188H1 TUT0101",
        dtstart=";TZID=America/Toronto:20260105T090000",
        dtend=";TZID=America/Toronto:20260105T100000",
        rrule=":FREQ=WEEKLY;COUNT=5;BYDAY=MO,WE",
    )
    courses = parse_ics(ics(every_third, counted), TZ).courses
    (pra,) = courses[0].meetings
    # Every third week: weekly with the two weeks between missing.
    assert pra.recurrence == "weekly"
    assert (pra.first_date, pra.last_date) == (date(2026, 1, 5), date(2026, 3, 9))
    assert len(pra.exceptions) == 6
    mon, wed = courses[1].meetings
    # Five dates in all: Mon, Wed, Mon, Wed, Mon.
    assert (mon.last_date, wed.last_date) == (date(2026, 1, 19), date(2026, 1, 14))


def test_too_many_dates_are_cut_and_say_so(monkeypatch: pytest.MonkeyPatch):
    from semestra.modules.imports import ics as ics_module

    monkeypatch.setattr(ics_module, "MAX_EVENTS", 3)
    result = parse_ics(ACORN, TZ)
    assert result.truncated
    party = vevent(
        uid=":x", summary=":Party", dtstart=";VALUE=DATE:20260301", dtend=";VALUE=DATE:20260302"
    )
    assert not parse_ics(ics(party), TZ).truncated


def test_a_rule_repeating_every_minute_stops_at_the_cap_quickly():
    import time as clock

    minutely = vevent(
        uid=":m",
        summary=":Ping",
        dtstart=":20260105T090000",
        dtend=":20260105T090100",
        rrule=":FREQ=MINUTELY",
    )
    began = clock.monotonic()
    result = parse_ics(ics(minutely), TZ)
    assert result.truncated
    assert clock.monotonic() - began < 30


def test_invalid_ics():
    import pytest

    from semestra.core.errors import AppError

    with pytest.raises(AppError) as err:
        parse_ics(b"not a calendar", TZ)
    assert err.value.code in ("import.ics_invalid", "import.no_content")


def test_sections():
    assert section_of("ECE244H1 LEC 0101") == ("LEC", "LEC0101")
    assert section_of("CS 101 lab 2") == ("LAB", "LAB2")
    assert section_of("No section") is None


def test_relative_dates():
    term = dates.TermDates(
        date(2026, 1, 5), date(2026, 4, 24), dates.plain_weeks(date(2026, 1, 5), date(2026, 4, 24))
    )
    assert dates.resolve("Week 5, Friday", term) == date(2026, 2, 6)
    assert dates.resolve("第 3 周周三", term) == date(2026, 1, 21)
    assert dates.resolve("Due Feb 13 at noon", term) == date(2026, 2, 13)
    assert dates.resolve("3月20日", term) == date(2026, 3, 20)
    assert dates.resolve("2026-04-02", None) == date(2026, 4, 2)
    assert dates.resolve("Week 5", term) is None
    assert dates.resolve("TBA", term) is None


def test_category_and_type_mapping():
    assert build.category_key("Midterm Exam") == "exam"
    assert build.category_key("Problem sets") == "assignment"
    assert build.category_key("期末考试") == "exam"
    assert build.category_key("Reflection journal") is None
    assert build.slug_key("Reflection journal") == "reflection-journal"
    assert build.type_code("Lab", ["LEC", "PRA", "TUT"]) == "PRA"
    assert build.type_code("LAB", ["LEC", "LAB"]) == "LAB"
    assert build.type_code("tutorial", ["LEC", "TUT"]) == "TUT"
    assert build.type_code("weird", ["LEC"]) == "LEC"
    assert build.year_long("MAT137Y1", None)
    assert not build.year_long("MAT137H1", "one_term")


def test_exdates_and_missing_weeks_become_exceptions():
    result = parse_ics(ACORN, TZ)
    lec = result.courses[0].meetings
    # The EXDATE is a Monday: only the Monday meeting of the MO,WE rule gets it.
    assert [(m.weekday, m.exceptions) for m in lec[:2]] == [(1, [date(2026, 2, 16)]), (3, [])]

    weeks = [5, 12, 26]  # one VEVENT per class; the 19th is missing
    singles = ics(*(
        vevent(uid=f":p{day}", summary=":ECE231H1 PRA0101",
               dtstart=f";TZID=America/Toronto:202601{day:02d}T150000",
               dtend=f";TZID=America/Toronto:202601{day:02d}T180000")
        for day in weeks
    ))  # fmt: skip
    meeting = parse_ics(singles, TZ).courses[0].meetings[0]
    assert (meeting.recurrence, meeting.exceptions) == ("weekly", [date(2026, 1, 19)])

    # A full-year course as one VEVENT per class: the winter break is no cancellation.
    days = [date(2025, 12, 1), date(2025, 12, 8), date(2026, 1, 5), date(2026, 1, 12)]
    year = ics(*(
        vevent(uid=f":y{d:%m%d}", summary=":MAT137Y1 LEC0101",
               dtstart=f";TZID=America/Toronto:{d:%Y%m%d}T090000",
               dtend=f";TZID=America/Toronto:{d:%Y%m%d}T100000")
        for d in days
    ))  # fmt: skip
    assert parse_ics(year, TZ).courses[0].meetings[0].exceptions == []


def test_meeting_weeks_from_dates():
    weeks = dates.plain_weeks(date(2026, 1, 5), date(2026, 4, 24))
    assert dates.first_week_from(date(2026, 1, 7), weeks) == 1
    assert dates.first_week_from(date(2025, 12, 1), weeks) == 1
    assert dates.first_week_from(date(2026, 9, 8), weeks) is None
    assert dates.last_week_until(date(2026, 4, 24), weeks) == len(weeks)
    assert dates.last_week_until(date(2026, 12, 7), weeks) == len(weeks)
    assert dates.last_week_until(date(2025, 12, 7), weeks) is None


def test_meeting_weeks_name_what_went_wrong():
    term = date(2026, 1, 5), date(2026, 4, 24)
    weeks = dates.plain_weeks(*term)
    reading = [w for w in weeks if w.number != 7]  # week 7 is a break
    assert dates.meeting_weeks(date(2026, 1, 6), date(2026, 4, 21), None, None, weeks)[2] is None
    assert dates.meeting_weeks(date(2026, 9, 8), date(2026, 12, 7), None, None, weeks) == (
        None, len(weeks), "import.outside_term",
    )  # fmt: skip
    in_break = reading[5].end_date + timedelta(days=2)
    assert dates.meeting_weeks(in_break, in_break, None, None, reading)[2] == (
        "import.no_teaching_weeks"
    )
    assert dates.meeting_weeks(None, None, 5, 3, weeks)[2] == "import.no_teaching_weeks"


async def test_an_upload_with_scanned_pages_is_read_in_two_children():
    data = make_pdf(
        ["typed page with enough words to count as a digital text page", "scan"], scanned={1}
    )
    texts, images = await deps.read_upload(Settings(env="test"), data, "s.pdf", "application/pdf")
    assert [p.page for p in texts] == [1]
    assert [i.mime for i in images] == ["image/png"]


async def test_an_upload_that_takes_too_long_says_so():
    data = make_pdf(["typed page with enough words to count as a digital text page"])
    settings = Settings(env="test", files_parse_timeout_seconds=0)
    with pytest.raises(AppError) as exc:
        await deps.read_upload(settings, data, "s.pdf", "application/pdf")
    assert (exc.value.code, exc.value.params) == ("import.file_too_complex", {"filename": "s.pdf"})
    with pytest.raises(AppError) as exc:
        await deps.render_pages(settings, data, "application/pdf", "t.pdf")
    assert exc.value.code == "import.file_too_complex"
