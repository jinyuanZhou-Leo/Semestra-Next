"""ICS files from a school's registration system or a calendar app (M08 §4.1). Deterministic.

`parse_ics` turns VEVENTs into courses with weekly meetings and one-off events, in the Program's
wall-clock time. Events are grouped by the course code and section found in SUMMARY; repeating
events without an RRULE (one VEVENT per class, as some exports do) are merged into a meeting.
"""

import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from itertools import pairwise
from typing import Any
from zoneinfo import ZoneInfo

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
MAX_EVENTS = 5000


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
    # Dates of this weekday the class does not happen: EXDATEs, or the weeks missing between
    # one-VEVENT-per-class entries.
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
    uid: str
    summary: str
    start: datetime | date
    end: datetime | date
    rrule: dict[str, Any] | None
    location: str | None
    instructor: str | None
    exdates: list[date] = field(default_factory=lambda: [])


def _exdates(component: Any, tz: ZoneInfo) -> list[date]:
    """EXDATE values (one property or several, each with one or more dates) as local days."""
    value = component.get("exdate")
    if value is None:
        return []
    days: set[date] = set()
    for prop in value if isinstance(value, list) else [value]:
        for item in getattr(prop, "dts", []):
            try:
                local = _local(item.dt, tz)
            except ValueError:
                continue
            days.add(local.date() if isinstance(local, datetime) else local)
    return sorted(days)


def _read(data: bytes, tz: ZoneInfo) -> list[_Raw]:
    try:
        calendar = Calendar.from_ical(data)
    except Exception as exc:
        raise AppError("import.ics_invalid", 422) from exc
    raws: list[_Raw] = []
    for index, component in enumerate(calendar.walk("VEVENT")):
        if index >= MAX_EVENTS:
            break
        if str(component.get("status", "")).upper() == "CANCELLED":
            continue
        try:
            start = _local(component.decoded("dtstart"), tz)
        except KeyError, ValueError:
            continue
        try:
            end = _local(component.decoded("dtend"), tz)
        except KeyError, ValueError:
            end = start
        rrule = component.get("rrule")
        raws.append(
            _Raw(
                uid=_text(component, "uid") or f"event-{index}",
                summary=_text(component, "summary") or "",
                start=start,
                end=end,
                rrule=dict(rrule) if rrule else None,
                location=_text(component, "location"),
                instructor=_instructor(component),
                exdates=_exdates(component, tz),
            )
        )
    return raws


def _until(rrule: dict[str, Any], start: datetime, tz: ZoneInfo, weekdays: int) -> date | None:
    until = rrule.get("UNTIL")
    if until:
        value = until[0]
        if isinstance(value, datetime):
            return (value.astimezone(tz) if value.tzinfo else value).date()
        if isinstance(value, date):
            return value
    count = rrule.get("COUNT")
    if count:
        interval = int((rrule.get("INTERVAL") or [1])[0])
        weeks = -(-int(count[0]) // max(1, weekdays))
        return (start + timedelta(weeks=interval * (weeks - 1) + 1) - timedelta(days=1)).date()
    return None


def parse_ics(data: bytes, timezone: str) -> IcsResult:
    tz = ZoneInfo(timezone)
    raws = _read(data, tz)
    if not raws:
        raise AppError("import.no_content", 422)
    courses: dict[str, IcsCourse] = {}
    loose: list[IcsEvent] = []
    singles: defaultdict[tuple[str, str, int, time, time], list[_Raw]] = defaultdict(list)

    def course_for(code: str | None, raw: _Raw, section: str | None) -> IcsCourse:
        key = code or raw.summary.strip().lower()
        if key not in courses:
            courses[key] = IcsCourse(code=code, title=_title(raw.summary, code, section))
        return courses[key]

    for raw in raws:
        code = course_code(raw.summary)
        sec = section_of(raw.summary)
        type_code, section = sec if sec else ("LEC", "")
        timed = isinstance(raw.start, datetime) and isinstance(raw.end, datetime)
        freq = (raw.rrule or {}).get("FREQ", [""])[0]
        if timed and freq == "WEEKLY":
            assert isinstance(raw.start, datetime)
            assert isinstance(raw.end, datetime)
            days = [_WEEKDAYS[d[-2:]] for d in raw.rrule.get("BYDAY", []) if d[-2:] in _WEEKDAYS]  # pyright: ignore[reportOptionalMemberAccess]
            days = days or [raw.start.isoweekday()]
            interval = int((raw.rrule.get("INTERVAL") or [1])[0])  # pyright: ignore[reportOptionalMemberAccess]
            last = _until(raw.rrule, raw.start, tz, len(days))  # pyright: ignore[reportArgumentType]
            course = course_for(code, raw, section)
            for weekday in sorted(set(days)):
                offset = (weekday - raw.start.isoweekday()) % 7
                course.meetings.append(
                    IcsMeeting(
                        section_code=section,
                        type_code=type_code,
                        weekday=weekday,
                        start_time=raw.start.time(),
                        end_time=raw.end.time(),
                        recurrence="biweekly" if interval == 2 else "weekly",
                        first_date=raw.start.date() + timedelta(days=offset),
                        last_date=last,
                        location=raw.location,
                        instructor=raw.instructor,
                        source_ref=f"{raw.uid}:{weekday}",
                        exceptions=[d for d in raw.exdates if d.isoweekday() == weekday],
                    )
                )
            continue
        if timed and code:
            assert isinstance(raw.start, datetime)
            assert isinstance(raw.end, datetime)
            key = (code, section, raw.start.isoweekday(), raw.start.time(), raw.end.time())
            singles[key].append(raw)
            continue
        event = _event(raw, type_code if sec else None)
        if code:
            course_for(code, raw, section).events.append(event)
        else:
            loose.append(event)

    for (code, section, weekday, start, end), group in singles.items():
        group.sort(key=lambda r: r.start)
        first = group[0]
        course = course_for(code, first, section)
        if len(group) < 2:
            sec = section_of(first.summary)
            course.events.append(_event(first, sec[0] if sec else None))
            continue
        days = [r.start.date() for r in group]  # pyright: ignore[reportAttributeAccessIssue]
        gaps = {(b - a).days for a, b in pairwise(days)}
        biweekly = min(gaps) >= 14
        step = timedelta(days=14 if biweekly else 7)
        held = set(days)
        missing: list[date] = []
        day = days[0] + step
        while day < days[-1]:
            if day not in held:
                missing.append(day)
            day += step
        sec = section_of(first.summary)
        course.meetings.append(
            IcsMeeting(
                section_code=section,
                type_code=sec[0] if sec else "LEC",
                weekday=weekday,
                start_time=start,
                end_time=end,
                recurrence="biweekly" if biweekly else "weekly",
                first_date=first.start.date(),  # pyright: ignore[reportAttributeAccessIssue]
                last_date=group[-1].start.date(),  # pyright: ignore[reportAttributeAccessIssue]
                location=first.location,
                instructor=first.instructor,
                source_ref=f"{code}:{section}:{weekday}:{start.isoformat('minutes')}",
                exceptions=missing,
            )
        )
    ordered = sorted(courses.values(), key=lambda c: (c.code is None, c.code or c.title))
    return IcsResult(courses=[c for c in ordered if c.meetings or c.events], events=loose)


def _event(raw: _Raw, type_code: str | None) -> IcsEvent:
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
            source_ref=raw.uid,
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
        source_ref=raw.uid,
    )
