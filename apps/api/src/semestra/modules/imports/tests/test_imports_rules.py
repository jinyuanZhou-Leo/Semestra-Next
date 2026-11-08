"""Pure parts of imports: ICS grouping, relative dates, category and type mapping (M08 §9)."""

from datetime import date, time, timedelta
from typing import Any

import pytest

from semestra.core.config import Settings
from semestra.core.errors import AppError
from semestra.modules.academics.rules import BreakSpan, term_weeks
from semestra.modules.files.tests.conftest import make_pdf
from semestra.modules.imports import build, dates, deps
from semestra.modules.imports.ics import IcsResult, parse_ics, section_of

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


WINTER = dates.TermDates(
    date(2026, 1, 5), date(2026, 4, 24), dates.plain_weeks(date(2026, 1, 5), date(2026, 4, 24))
)
FALL = dates.TermDates(
    date(2025, 9, 2), date(2025, 12, 5), dates.plain_weeks(date(2025, 9, 2), date(2025, 12, 5))
)


def term_with_break(start: date, end: date, first: date, last: date) -> dates.TermDates:
    """A term whose break week has no number, as the academics module builds it."""
    spans = [BreakSpan("b", "Reading week", first, last)]
    weeks = term_weeks(start, end, spans, count_break_weeks=False, week_start=1)
    return dates.TermDates(
        start,
        end,
        [
            dates.TermWeekSpan(w.number, w.start_date, w.end_date, w.break_ is not None)
            for w in weeks
        ],
        [(first, last)],
    )


def parse(data: bytes, term: dates.TermDates = WINTER) -> IcsResult:
    return parse_ics(data, TZ, (term.start, term.end))


def meetings(data: bytes, terms: dict[str, dates.TermDates] | None = None) -> list[dict[str, Any]]:
    """Meeting items as an import builds them: into a course across `terms`, else into WINTER."""
    terms = terms or {"": WINTER}
    kind = "course" if "" not in terms else "term"
    span = (min(t.start for t in terms.values()), max(t.end for t in terms.values()))
    ctx = build.BuildContext(kind, None, terms.get(""), [], ["LEC", "TUT", "PRA"])
    items = build.from_ics(parse_ics(data, TZ, span), ctx, terms)
    return [i.data for i in items if i.type == "meeting"]


def test_acorn_rrules_group_by_course_and_section():
    result = parse(ACORN)
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
    assert (lec.dates[0], lec.dates[-1]) == (date(2026, 1, 5), date(2026, 4, 6))
    assert aps.meetings[1].dates[0] == date(2026, 1, 7)
    assert aps.meetings[2].type_code == "TUT"
    tut = meetings(ACORN)[2]
    assert tut["recurrence"] == "biweekly"
    assert tut["last_date"] >= "2026-03-20"
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
    (course,) = parse(ics(*events)).courses
    (meeting,) = course.meetings
    assert (meeting.weekday, meeting.start_time) == (1, time(14))
    (item,) = meetings(ics(*events))
    assert (item["recurrence"], item["first_date"], item["last_date"]) == (
        "weekly", "2026-03-02", "2026-03-16",
    )  # fmt: skip
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
    data = ics(series, cancelled, moved)
    (course,) = parse(data).courses
    (meeting,) = course.meetings
    assert meeting.start_time == time(10)
    (item,) = meetings(data)
    assert item["exceptions"] == ["2026-01-26", "2026-02-02"]
    (event,) = course.events
    assert (event.day, event.start_time, event.location) == (date(2026, 2, 2), time(14), "BA 1130")


def test_a_time_moved_for_the_rest_of_term_keeps_both_meetings():
    # The same UID on the same weekday at two times (from November on the class moves to the
    # afternoon): two meetings, each with its own reference, so neither overwrites the other.
    series = vevent(
        uid=":m1",
        summary=":APS105H1 LEC0101",
        dtstart=";TZID=America/Toronto:20250902T100000",
        dtend=";TZID=America/Toronto:20250902T110000",
        rrule=":FREQ=WEEKLY;UNTIL=20251202T235959Z",
    )
    moved = [
        vevent(
            uid=":m1",
            recurrence_id=f";TZID=America/Toronto:{d:%Y%m%d}T100000",
            summary=":APS105H1 LEC0101",
            dtstart=f";TZID=America/Toronto:{d:%Y%m%d}T140000",
            dtend=f";TZID=America/Toronto:{d:%Y%m%d}T150000",
        )
        for d in (date(2025, 11, 4) + timedelta(weeks=n) for n in range(5))
    ]
    items = meetings(ics(series, *moved), {"fall": FALL})
    assert [(i["start_time"], i["first_date"], i["last_date"]) for i in items] == [
        ("10:00:00", "2025-09-02", "2025-10-28"),
        ("14:00:00", "2025-11-04", "2025-12-02"),
    ]
    assert len({i["source_ref"] for i in items}) == 2


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
    pra, mon, wed = meetings(ics(every_third, counted))
    # Every third week: weekly with the two weeks between missing.
    assert pra["recurrence"] == "weekly"
    assert (pra["first_date"], pra["last_date"]) == ("2026-01-05", "2026-03-09")
    assert len(pra["exceptions"]) == 6
    # Five dates in all: Mon, Wed, Mon, Wed, Mon.
    assert (mon["last_date"], wed["last_date"]) == ("2026-01-19", "2026-01-14")


def test_only_the_terms_dates_are_read():
    # A calendar app's full export: a daily rule since 2018 and a class this winter. Only the
    # term is expanded, so the class is there and the old rule costs nothing.
    gym = vevent(
        uid=":gym",
        summary=":Gym",
        dtstart=";TZID=America/Toronto:20180101T070000",
        dtend=";TZID=America/Toronto:20180101T080000",
        rrule=":FREQ=DAILY",
    )
    old = [
        vevent(uid=f":o{n}", summary=":Dentist",
               dtstart=f":2019{1 + n % 12:02d}{1 + n % 28:02d}T150000Z",
               dtend=f":2019{1 + n % 12:02d}{1 + n % 28:02d}T160000Z")
        for n in range(300)
    ]  # fmt: skip
    lecture = vevent(
        uid=":aps",
        summary=":APS105H1 LEC0101",
        dtstart=";TZID=America/Toronto:20260106T100000",
        dtend=";TZID=America/Toronto:20260106T110000",
        rrule=":FREQ=WEEKLY;COUNT=12",
    )
    result = parse(ics(gym, *old, lecture))
    assert not result.truncated
    assert "APS105H1" in [c.code for c in result.courses]
    days = [d for c in result.courses for m in c.meetings for d in m.dates]
    assert min(days) >= WINTER.start
    assert all(e.day >= WINTER.start for e in result.events)


def test_too_many_dates_are_cut_and_say_so(monkeypatch: pytest.MonkeyPatch):
    from semestra.modules.imports import ics as ics_module

    monkeypatch.setattr(ics_module, "MAX_EVENTS", 3)
    result = parse(ACORN)
    assert result.truncated
    party = vevent(
        uid=":x", summary=":Party", dtstart=";VALUE=DATE:20260301", dtend=";VALUE=DATE:20260302"
    )
    assert not parse(ics(party)).truncated


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
    result = parse(ics(minutely))
    assert result.truncated
    assert clock.monotonic() - began < 30


def test_invalid_ics():
    with pytest.raises(AppError) as err:
        parse(b"not a calendar")
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
    lec = meetings(ACORN)
    # The EXDATE is a Monday: only the Monday meeting of the MO,WE rule gets it.
    assert [(m["weekday"], m["exceptions"]) for m in lec[:2]] == [(1, ["2026-02-16"]), (3, [])]

    weeks = [5, 12, 26]  # one VEVENT per class; the 19th is missing
    singles = ics(*(
        vevent(uid=f":p{day}", summary=":ECE231H1 PRA0101",
               dtstart=f";TZID=America/Toronto:202601{day:02d}T150000",
               dtend=f";TZID=America/Toronto:202601{day:02d}T180000")
        for day in weeks
    ))  # fmt: skip
    (meeting,) = meetings(singles)
    assert (meeting["recurrence"], meeting["exceptions"]) == ("weekly", ["2026-01-19"])


def test_a_class_in_two_terms_becomes_a_meeting_in_each():
    # A full-year course as one weekly rule from September to April: one meeting per term,
    # and the winter break between them is no cancellation.
    year = vevent(
        uid=":y",
        summary=":MAT137Y1 LEC0101",
        dtstart=";TZID=America/Toronto:20250908T090000",
        dtend=";TZID=America/Toronto:20250908T100000",
        rrule=":FREQ=WEEKLY;UNTIL=20260420T235959Z",
    )
    fall, winter = meetings(ics(year), {"fall": FALL, "winter": WINTER})
    assert (fall["term_ref"], fall["first_date"], fall["last_date"]) == (
        "term:fall", "2025-09-08", "2025-12-01",
    )  # fmt: skip
    assert (winter["term_ref"], winter["first_date"], winter["last_date"]) == (
        "term:winter", "2026-01-05", "2026-04-20",
    )  # fmt: skip
    assert fall["exceptions"] == winter["exceptions"] == []
    assert fall["source_ref"] != winter["source_ref"]


def test_every_other_week_across_a_reading_week():
    # Biweekly in teaching weeks: weeks 2, 4, 6 and 8 with an uncounted reading week between
    # 6 and 8, so the dates are 14, 14 and 21 days apart.
    term = term_with_break(
        date(2026, 1, 5), date(2026, 4, 24), date(2026, 2, 16), date(2026, 2, 20)
    )
    days = [date(2026, 1, 13), date(2026, 1, 27), date(2026, 2, 10), date(2026, 3, 3)]
    labs = ics(*(
        vevent(uid=f":l{d:%m%d}", summary=":ECE244H1 PRA0101",
               dtstart=f";TZID=America/Toronto:{d:%Y%m%d}T150000",
               dtend=f";TZID=America/Toronto:{d:%Y%m%d}T180000")
        for d in days
    ))  # fmt: skip
    (meeting,) = meetings(labs, {"": term})
    assert (meeting["recurrence"], meeting["exceptions"]) == ("biweekly", [])


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
