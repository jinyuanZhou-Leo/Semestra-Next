"""ICS files from a school's registration system or a calendar app (M08 §4.1). Deterministic.

`parse_ics` turns VEVENTs into courses with weekly meetings and one-off events, in the Program's
wall-clock time. Recurring events are expanded into their dates first (`recurring-ical-events`:
RRULE, EXDATE, RDATE and moved or cancelled single dates), then dates are grouped by the course
code and section found in SUMMARY, so one VEVENT per class (as some exports do) and a recurring
event become the same weekly meeting.
"""

import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from itertools import pairwise
from typing import Any
from zoneinfo import ZoneInfo

import recurring_ical_events
from icalendar import Calendar

from semestra.core.errors import AppError

COURSE_CODE = re.compile(r"\b([A-Z]{2,4})\s?(\d{3,4}[A-Z0-9]*)\b")
# Section patterns; extend the table for other schools' naming.
SECTION_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\b(LEC|TUT|PRA|LAB|SEM|DIS|REC|STU)\s?-?\s?(\d{4})\b"),
    re.compile(r"\b(LEC|TUT|PRA|LAB|SEM|DIS|REC|STU)\s?-?\s?(\d{1,3}[A-Z]?)\b"),
)
TYPE_ALIASES = {"DIS": "TUT", "REC": "TUT", "STU": "LAB"}
_WEEKDAYS = {"MO": 1, "TU": 2, "WE": 3, "TH": 4, "FR": 5, "SA": 6, "SU": 7}
MAX_EVENTS = 5000  # dates after expansion; the rest is dropped and the import says so
HORIZON_DAYS = 366
WINDOW_DAYS = 28  # expanded a window at a time, stopping at MAX_EVENTS
SUB_DAILY = {"SECONDLY", "MINUTELY", "HOURLY"}
# Missing occurrences in a row still read as cancellations; more is a break (see `parse`).
MAX_MISSED_IN_A_ROW = 2


@dataclass
class IcsMeeting:
    section_code: str
    type_code: str
    weekday: int
    start_time: time
    end_time: time
    recurrence: str
    first_date: date
    last_date: date | None
    location: str | None
    instructor: str | None
    source_ref: str
    # Dates of this weekday the class does not happen: a week or two missing between held ones
    # (an EXDATE, a cancelled or moved date, or a gap between one-VEVENT-per-class entries).
    exceptions: list[date] = field(default_factory=lambda: [])


@dataclass
class IcsEvent:
    title: str
    day: date
    start_time: time | None
    end_time: time | None
    end_day: date
    all_day: bool
    location: str | None
    type_code: str | None
    source_ref: str


@dataclass
class IcsCourse:
    code: str | None
    title: str
    meetings: list[IcsMeeting] = field(default_factory=lambda: [])
    events: list[IcsEvent] = field(default_factory=lambda: [])


@dataclass
class IcsResult:
    courses: list[IcsCourse]
    # One-off events without a course code.
    events: list[IcsEvent]
    # The file had more than MAX_EVENTS dates; the later ones were left out.
    truncated: bool = False


def course_code(text: str) -> str | None:
    match = COURSE_CODE.search(text.upper())
    return f"{match.group(1)}{match.group(2)}" if match else None


def normalize_code(code: str | None) -> str:
    return re.sub(r"[\s-]", "", (code or "").upper())


def section_of(text: str) -> tuple[str, str] | None:
    """(type code, section code) such as ("LEC", "LEC0101")."""
    upper = text.upper()
    for pattern in SECTION_PATTERNS:
        match = pattern.search(upper)
        if match:
            kind = match.group(1)
            return TYPE_ALIASES.get(kind, kind), f"{kind}{match.group(2)}"
    return None


def _title(summary: str, code: str | None, section: str | None) -> str:
    text = summary
    if code:
        text = re.sub(r"\b[A-Za-z]{2,4}\s?\d{3,4}[A-Za-z0-9]*\b", " ", text, count=1)
    if section:
        for pattern in SECTION_PATTERNS:
            text = re.compile(pattern.pattern, re.IGNORECASE).sub(" ", text)
    text = re.sub(r"\s+", " ", text).strip(" -:|,·")
    return text or (code or summary.strip() or "Course")


def _local(value: Any, tz: ZoneInfo) -> datetime | date:
    if isinstance(value, datetime):
        if value.tzinfo is None:  # floating time: already wall-clock
            return value
        return value.astimezone(tz).replace(tzinfo=None)
    if isinstance(value, date):
        return value
    raise ValueError("unsupported DTSTART")


def _text(component: Any, name: str) -> str | None:
    value = component.get(name)
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _instructor(component: Any) -> str | None:
    description = _text(component, "description") or ""
    match = re.search(
        r"(?:Instructor|Professor|Teacher|教师|讲师)\s*[:\uff1a]\s*([^\n;]+)", description
    )
    return match.group(1).strip()[:200] if match else None


@dataclass
class _Raw:
    """One occurrence: a plain VEVENT, or one date of an expanded recurring one."""

    uid: str
    summary: str
    start: datetime | date
    end: datetime | date
    location: str | None
    instructor: str | None


def _read(data: bytes, tz: ZoneInfo) -> tuple[list[_Raw], bool]:
    """Every occurrence in the file, recurring events expanded by `recurring-ical-events` (RRULE,
    RDATE, EXDATE and RECURRENCE-ID overrides), cancelled ones left out. The second value says
    some dates were dropped: past `MAX_EVENTS`, or a rule repeating more often than daily."""
    try:
        calendar = Calendar.from_ical(data)
        starts = [
            _local(c.decoded("dtstart"), tz) for c in calendar.walk("VEVENT") if "dtstart" in c
        ]
    except Exception as exc:
        raise AppError("import.ics_invalid", 422) from exc
    if not starts:
        return [], False
    days = [s.date() if isinstance(s, datetime) else s for s in starts]
    # Rules without an end stop a year after the last event starts: past any term in the file.
    first, horizon = min(days), max(days) + timedelta(days=HORIZON_DAYS)
    # Classes never repeat more often than daily: a finer rule keeps only its first date (and
    # the import says it was cut), so a FREQ=MINUTELY file cannot expand half a million dates.
    cut = False
    for component in calendar.walk("VEVENT"):
        rule = component.get("rrule")
        if rule and str((rule.get("FREQ") or [""])[0]).upper() in SUB_DAILY:
            del component["rrule"]
            cut = True
    try:
        query = recurring_ical_events.of(calendar, skip_bad_series=True)
    except Exception as exc:
        raise AppError("import.ics_invalid", 422) from exc
    raws: list[_Raw] = []
    seen: set[tuple[str, str]] = set()
    # In windows, in time order, so a large file stops at the cap with its earliest dates.
    window = first
    while window <= horizon:
        until = min(window + timedelta(days=WINDOW_DAYS), horizon + timedelta(days=1))
        try:
            components = sorted(
                query.between(window, until), key=lambda c: _day(_local(c.decoded("dtstart"), tz))
            )
        except Exception as exc:
            raise AppError("import.ics_invalid", 422) from exc
        window = until
        for component in components:
            if str(component.get("status", "")).upper() == "CANCELLED":
                continue
            try:
                start = _local(component.decoded("dtstart"), tz)
            except KeyError, ValueError:
                continue
            key = (_text(component, "uid") or "", start.isoformat())
            if key in seen:  # an event spanning two windows comes back in both
                continue
            seen.add(key)
            try:
                end = _local(component.decoded("dtend"), tz)
            except KeyError, ValueError:
                end = start
            if len(raws) >= MAX_EVENTS:
                return _sorted(raws), True
            raws.append(
                _Raw(
                    uid=_text(component, "uid") or f"event-{len(raws)}",
                    summary=_text(component, "summary") or "",
                    start=start,
                    end=end,
                    location=_text(component, "location"),
                    instructor=_instructor(component),
                )
            )
    return _sorted(raws), cut


def _sorted(raws: list[_Raw]) -> list[_Raw]:
    return sorted(raws, key=lambda r: _day(r.start))


def _day(value: datetime | date) -> date:
    return value.date() if isinstance(value, datetime) else value


def parse_ics(data: bytes, timezone: str) -> IcsResult:
    tz = ZoneInfo(timezone)
    raws, truncated = _read(data, tz)
    if not raws:
        raise AppError("import.no_content", 422)
    courses: dict[str, IcsCourse] = {}
    loose: list[IcsEvent] = []
    # Timed classes by course, section, weekday and time: a recurring event's dates and the
    # one-VEVENT-per-class exports some schools use end up the same way here. Without a course
    # code only the dates of one recurring event go together.
    groups: defaultdict[tuple[str, str, int, time, time], list[_Raw]] = defaultdict(list)
    per_uid = Counter(r.uid for r in raws)

    def course_for(code: str | None, raw: _Raw, section: str | None) -> IcsCourse:
        key = code or raw.summary.strip().lower()
        if key not in courses:
            courses[key] = IcsCourse(code=code, title=_title(raw.summary, code, section))
        return courses[key]

    def add_event(raw: _Raw, code: str | None) -> None:
        sec = section_of(raw.summary)
        # Dates of one recurring event share its UID; each needs its own reference.
        ref = raw.uid if per_uid[raw.uid] == 1 else f"{raw.uid}:{_day(raw.start).isoformat()}"
        event = _event(raw, sec[0] if sec else None, ref)
        if code:
            course_for(code, raw, sec[1] if sec else "").events.append(event)
        else:
            loose.append(event)

    for raw in raws:
        code = course_code(raw.summary)
        if not (isinstance(raw.start, datetime) and isinstance(raw.end, datetime)):
            add_event(raw, code)
            continue
        sec = section_of(raw.summary)
        section = sec[1] if sec else ""
        if code is None and per_uid[raw.uid] < 2:
            add_event(raw, None)
            continue
        key = (
            code or f"uid:{raw.uid}",
            section,
            raw.start.isoweekday(),
            raw.start.time(),
            raw.end.time(),
        )
        groups[key].append(raw)

    for (key, section, weekday, start, end), group in groups.items():
        first = group[0]
        code = None if key.startswith("uid:") else key
        if len(group) < 2:
            add_event(first, code)
            continue
        days = [_day(r.start) for r in group]
        gaps = {(b - a).days for a, b in pairwise(days)}
        # Every other week only when every gap is a whole number of fortnights; any other
        # spacing (every third week, a missed week here and there) is weekly with gaps.
        biweekly = min(gaps) >= 14 and all(g % 14 == 0 for g in gaps)
        step = timedelta(days=14 if biweekly else 7)
        # A class or two missing between held ones is a cancellation (a holiday); a longer gap
        # is a break between terms or a reading week the term already has.
        missing: list[date] = []
        for a, b in pairwise(days):
            skipped = [a + step * n for n in range(1, (b - a) // step)]
            if len(skipped) <= MAX_MISSED_IN_A_ROW:
                missing.extend(skipped)
        sec = section_of(first.summary)
        uids = {r.uid for r in group}
        # One recurring event keeps the reference earlier imports gave it.
        ref = (
            f"{first.uid}:{weekday}"
            if len(uids) == 1
            else f"{code or key}:{section}:{weekday}:{start.isoformat('minutes')}"
        )
        course_for(code, first, section).meetings.append(
            IcsMeeting(
                section_code=section,
                type_code=sec[0] if sec else "LEC",
                weekday=weekday,
                start_time=start,
                end_time=end,
                recurrence="biweekly" if biweekly else "weekly",
                first_date=days[0],
                last_date=days[-1],
                location=first.location,
                instructor=first.instructor,
                source_ref=ref,
                exceptions=missing,
            )
        )
    for course in courses.values():
        course.meetings.sort(key=lambda m: (m.section_code, m.weekday, m.start_time))
    ordered = sorted(courses.values(), key=lambda c: (c.code is None, c.code or c.title))
    return IcsResult(
        courses=[c for c in ordered if c.meetings or c.events], events=loose, truncated=truncated
    )


def _event(raw: _Raw, type_code: str | None, ref: str) -> IcsEvent:
    if isinstance(raw.start, datetime):
        end = raw.end if isinstance(raw.end, datetime) else raw.start
        return IcsEvent(
            title=raw.summary.strip() or "Event",
            day=raw.start.date(),
            start_time=raw.start.time(),
            end_time=end.time(),
            end_day=end.date(),
            all_day=False,
            location=raw.location,
            type_code=type_code,
            source_ref=ref,
        )
    end_day = raw.end if isinstance(raw.end, date) and not isinstance(raw.end, datetime) else None
    # DTEND of an all-day event is exclusive.
    last = (end_day - timedelta(days=1)) if end_day and end_day > raw.start else raw.start
    return IcsEvent(
        title=raw.summary.strip() or "Event",
        day=raw.start,
        start_time=None,
        end_time=None,
        end_day=last,
        all_day=True,
        location=raw.location,
        type_code=type_code,
        source_ref=ref,
    )
