"""Turning dates as a syllabus writes them into calendar dates (M08 §4.2 step 4).

"Week 5, Friday", "第 5 周周五", "Oct 3", "10月3日": week numbers come from the target term's
calendar (`academics.term.calendar_info`, or plain weeks from the wizard's start date), month and
day without a year take the year that puts the date inside the term.
"""

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date, timedelta

_WEEKDAY_WORDS: dict[str, int] = {
    "monday": 1, "mon": 1, "tuesday": 2, "tues": 2, "tue": 2, "wednesday": 3, "wed": 3,
    "thursday": 4, "thurs": 4, "thu": 4, "friday": 5, "fri": 5, "saturday": 6, "sat": 6,
    "sunday": 7, "sun": 7,
}  # fmt: skip
_ZH_WEEKDAYS = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7, "天": 7}
_MONTHS: dict[str, int] = {
    "january": 1, "jan": 1, "february": 2, "feb": 2, "march": 3, "mar": 3, "april": 4,
    "apr": 4, "may": 5, "june": 6, "jun": 6, "july": 7, "jul": 7, "august": 8, "aug": 8,
    "september": 9, "sept": 9, "sep": 9, "october": 10, "oct": 10, "november": 11, "nov": 11,
    "december": 12, "dec": 12,
}  # fmt: skip

_WEEK = re.compile(r"(?:\bweek|\bwk)\.?\s*(\d{1,2})\b|第\s*(\d{1,2})\s*周", re.IGNORECASE)
_EN_DAY = re.compile(r"\b(" + "|".join(sorted(_WEEKDAY_WORDS, key=len, reverse=True)) + r")\b\.?")
_ZH_DAY = re.compile(r"(?:周|星期|礼拜)([一二三四五六日天])")
_MONTH_DAY = re.compile(
    r"\b("
    + "|".join(sorted(_MONTHS, key=len, reverse=True))
    + r")\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b"
    r"|\b(\d{1,2})(?:st|nd|rd|th)?\s+(" + "|".join(sorted(_MONTHS, key=len, reverse=True)) + r")\b",
    re.IGNORECASE,
)
_ZH_MONTH_DAY = re.compile(r"(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]")
_ISO = re.compile(r"\b(\d{4})-(\d{1,2})-(\d{1,2})\b")


@dataclass(frozen=True)
class TermWeekSpan:
    number: int | None
    start_date: date
    end_date: date


@dataclass(frozen=True)
class TermDates:
    start: date
    end: date
    weeks: Sequence[TermWeekSpan]


def plain_weeks(start: date, end: date) -> list[TermWeekSpan]:
    """Monday-based weeks numbered from the week of `start` (the wizard, before the term exists
    and its breaks are known)."""
    monday = start - timedelta(days=start.weekday())
    weeks: list[TermWeekSpan] = []
    number = 1
    while monday <= end and number <= 60:
        weeks.append(TermWeekSpan(number, monday, monday + timedelta(days=6)))
        monday += timedelta(days=7)
        number += 1
    return weeks


def weekday_of(text: str) -> int | None:
    match = _ZH_DAY.search(text)
    if match:
        return _ZH_WEEKDAYS[match.group(1)]
    match = _EN_DAY.search(text.lower())
    if match:
        return _WEEKDAY_WORDS[match.group(1)]
    return None


def _in_term(month: int, day: int, term: TermDates) -> date | None:
    for year in (term.start.year, term.end.year, term.start.year + 1):
        try:
            candidate = date(year, month, day)
        except ValueError:
            continue
        if term.start - timedelta(days=14) <= candidate <= term.end + timedelta(days=31):
            return candidate
    return None


def _from_week(text: str, term: TermDates) -> date | None:
    match = _WEEK.search(text)
    if match is None:
        return None
    number = int(match.group(1) or match.group(2))
    weekday = weekday_of(text)
    week = next((w for w in term.weeks if w.number == number), None)
    if week is None or weekday is None:
        return None
    day = week.start_date
    while day <= week.end_date:
        if day.isoweekday() == weekday:
            return day
        day += timedelta(days=1)
    return None


def resolve(text: str | None, term: TermDates | None) -> date | None:
    """A calendar date for `text`, or None when it cannot be pinned down."""
    if not text:
        return None
    if match := _ISO.search(text):
        try:
            return date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
        except ValueError:
            return None
    if term is None:
        return None
    if found := _from_week(text, term):
        return found
    if match := _ZH_MONTH_DAY.search(text):
        return _in_term(int(match.group(1)), int(match.group(2)), term)
    if match := _MONTH_DAY.search(text):
        if match.group(1):
            return _in_term(_MONTHS[match.group(1).lower()], int(match.group(2)), term)
        return _in_term(_MONTHS[match.group(4).lower()], int(match.group(3)), term)
    return None


def week_of(day: date, weeks: Sequence[TermWeekSpan]) -> int | None:
    for week in weeks:
        if week.start_date <= day <= week.end_date:
            return week.number
    return None


def first_week_from(day: date, weeks: Sequence[TermWeekSpan]) -> int | None:
    """The week `day` falls in, else the next one (a day in a break, or before the term);
    None after the term."""
    return next((w.number for w in weeks if w.end_date >= day), None)


def last_week_until(day: date, weeks: Sequence[TermWeekSpan]) -> int | None:
    """The week `day` falls in, else the one before (a day in a break, or after the term);
    None before the term."""
    return next((w.number for w in reversed(weeks) if w.start_date <= day), None)


def meeting_weeks(
    first: date | None,
    last: date | None,
    start_week: int | None,
    end_week: int | None,
    weeks: Sequence[TermWeekSpan],
) -> tuple[int | None, int | None, str | None]:
    """A meeting's weeks in a term: explicit weeks win, else from its first and last dates.
    The third value is the error code when that leaves no teaching week: dates that miss the
    term (`import.outside_term`), or a range inside one break / reversed weeks
    (`import.no_teaching_weeks`)."""
    start = start_week or (first_week_from(first, weeks) if first else None)
    end = end_week or (last_week_until(last, weeks) if last else None)
    if (first and start is None) or (last and end is None):
        return start, end, "import.outside_term"
    if start and end and end < start:
        return start, end, "import.no_teaching_weeks"
    return start, end, None


def pick_term(
    target_term_id: str | None,
    course_term_ids: Sequence[str] | None,
    day: date | None,
    terms: Mapping[str, TermDates],
) -> str | None:
    """The term a meeting or event lands in: the course's term that contains `day` (a full-year
    course's fall meeting goes to fall, whatever the session's target), else the session's
    target term when its course runs then (or it has no course), else the course's only (or,
    without a day, last) term. None when that leaves no term. Validation and commit both use it,
    so the review flags exactly what the commit would refuse."""
    for term_id in course_term_ids or ():
        span = terms.get(term_id)
        if day is not None and span is not None and span.start <= day <= span.end:
            return term_id
    if target_term_id is not None and (
        course_term_ids is None or target_term_id in course_term_ids
    ):
        return target_term_id
    if not course_term_ids:
        return None
    if len(course_term_ids) == 1 or day is None:
        return course_term_ids[-1]
    return None
