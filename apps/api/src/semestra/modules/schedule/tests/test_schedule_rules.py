"""Expanding weekly meetings into dates (M04 §8)."""

from datetime import UTC, date, datetime, time
from zoneinfo import ZoneInfo

from semestra.modules.academics.rules import BreakSpan, term_weeks
from semestra.modules.schedule.rules import Recurrence, local_to_utc, meeting_dates

START, END = date(2026, 1, 5), date(2026, 4, 24)
READING = BreakSpan("b1", "Reading week", date(2026, 2, 14), date(2026, 2, 22))


def dates(rule: Recurrence, *, count_break_weeks: bool = False, breaks=(READING,)) -> list[date]:
    weeks = term_weeks(START, END, list(breaks), count_break_weeks, 7)
    return [d.day for d in meeting_dates(rule, START, END, weeks, list(breaks))]


def monday(**kwargs: object) -> Recurrence:
    base: dict[str, object] = {
        "weekday": 1,
        "recurrence": "weekly",
        "anchor_week": 1,
        "start_week": 1,
        "end_week": None,
        "skip_breaks": True,
    }
    return Recurrence(**{**base, **kwargs})  # pyright: ignore[reportArgumentType]


def test_weekly_skips_the_break_week():
    got = dates(monday())
    assert len(got) == 15
    assert date(2026, 2, 16) not in got
    assert got[0] == date(2026, 1, 5)
    assert got[-1] == date(2026, 4, 20)


def test_break_week_without_skipping():
    got = dates(monday(skip_breaks=False))
    assert date(2026, 2, 16) in got
    assert len(got) == 16


def test_week_range_follows_count_break_weeks():
    # Uncounted break: week 7 is the first week after the break.
    assert dates(monday(start_week=7, end_week=8)) == [date(2026, 2, 23), date(2026, 3, 2)]
    # Counted break: week 7 is the break itself (skipped), week 8 the week after it.
    assert dates(monday(start_week=7, end_week=8), count_break_weeks=True) == [date(2026, 2, 23)]


def test_biweekly_alternates_on_week_numbers():
    got = dates(monday(recurrence="biweekly", anchor_week=1))
    assert got == [
        date(2026, 1, 5),
        date(2026, 1, 19),
        date(2026, 2, 2),
        date(2026, 2, 23),  # week 7: the uncounted break does not shift the rhythm
        date(2026, 3, 9),
        date(2026, 3, 23),
        date(2026, 4, 6),
        date(2026, 4, 20),
    ]
    assert dates(monday(recurrence="biweekly", anchor_week=2))[0] == date(2026, 1, 12)


def test_single_holiday_inside_a_normal_week():
    holiday = BreakSpan("h", "Family Day", date(2026, 2, 16), date(2026, 2, 16))
    got = dates(monday(), breaks=(holiday,))
    assert date(2026, 2, 16) not in got
    assert date(2026, 2, 23) in got


def test_days_outside_the_term_are_dropped():
    # Sunday weeks: the first week starts on Jan 4, before the term.
    sunday = dates(monday(weekday=7))
    assert sunday[0] == date(2026, 1, 11)


def test_wall_clock_times_follow_dst():
    tz = ZoneInfo("America/Toronto")
    assert local_to_utc(date(2026, 3, 2), time(10), tz) == datetime(2026, 3, 2, 15, tzinfo=UTC)
    assert local_to_utc(date(2026, 3, 9), time(10), tz) == datetime(2026, 3, 9, 14, tzinfo=UTC)
    assert local_to_utc(date(2026, 10, 26), time(10), tz) == datetime(2026, 10, 26, 14, tzinfo=UTC)
    assert local_to_utc(date(2026, 11, 2), time(10), tz) == datetime(2026, 11, 2, 15, tzinfo=UTC)
