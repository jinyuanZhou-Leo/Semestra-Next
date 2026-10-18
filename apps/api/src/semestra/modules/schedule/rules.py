"""Pure scheduling rules (M04 §2): which dates a weekly meeting happens on, and time zones."""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from semestra.modules.academics.rules import BreakSpan, Week


@dataclass(frozen=True)
class Recurrence:
    weekday: int  # 1 = Monday .. 7 = Sunday
    recurrence: str  # weekly | biweekly
    anchor_week: int
    start_week: int
    end_week: int | None
    skip_breaks: bool


@dataclass(frozen=True)
class MeetingDate:
    day: date
    week_number: int | None  # None in an uncounted break week


def _day_in_week(week: Week, weekday: int) -> date:
    for offset in range(7):
        day = week.start_date + timedelta(days=offset)
        if day.isoweekday() == weekday:
            return day
    raise AssertionError("a week has every weekday")


def in_break(day: date, breaks: Sequence[BreakSpan]) -> bool:
    return any(b.start_date <= day <= b.end_date for b in breaks)


def meeting_dates(
    rule: Recurrence,
    term_start: date,
    term_end: date,
    weeks: Sequence[Week],
    breaks: Sequence[BreakSpan],
) -> list[MeetingDate]:
    """Every date the meeting happens on, before exceptions.

    Week numbers come from the term (M02 `term_weeks`), so with `count_break_weeks=false` the
    start and end weeks skip break weeks. With `skip_breaks` nothing happens in a break week or
    on a day inside a break (e.g. a single public holiday). Without it, a class in an uncounted
    break week belongs to the week before it for the week range; a biweekly class never falls
    in such a week, since it has no number to alternate on.
    """
    out: list[MeetingDate] = []
    last_number = 0
    for week in weeks:
        number = week.number
        if number is not None:
            last_number = number
        day = _day_in_week(week, rule.weekday)
        if not term_start <= day <= term_end:
            continue
        if rule.skip_breaks and (week.break_ is not None or in_break(day, breaks)):
            continue
        ref = number if number is not None else last_number
        if ref < rule.start_week or (rule.end_week is not None and ref > rule.end_week):
            continue
        if rule.recurrence == "biweekly" and (
            number is None or (number - rule.anchor_week) % 2 != 0
        ):
            continue
        out.append(MeetingDate(day, number))
    return out


def local_to_utc(day: date, at: time, tz: ZoneInfo) -> datetime:
    """Wall-clock time in `tz` → UTC; nonexistent times in a DST gap move forward with it."""
    return datetime.combine(day, at, tzinfo=tz).astimezone(UTC)


def local_midnight(day: date, tz: ZoneInfo) -> datetime:
    return local_to_utc(day, time(0, 0), tz)


def overlaps(a_start: datetime, a_end: datetime, b_start: datetime, b_end: datetime) -> bool:
    return a_start < b_end and b_start < a_end


def times_overlap(a_start: time, a_end: time, b_start: time, b_end: time) -> bool:
    return a_start < b_end and b_start < a_end
