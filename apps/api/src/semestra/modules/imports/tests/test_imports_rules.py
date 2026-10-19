"""Pure parts of imports: ICS grouping, relative dates, category and type mapping (M08 §9)."""

from datetime import date, time

from semestra.modules.imports import build, dates
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
    assert (lec.first_date, lec.last_date) == (date(2026, 1, 5), date(2026, 4, 10))
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
    assert dates.week_of(date(2026, 2, 6), term.weeks) == 5


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
