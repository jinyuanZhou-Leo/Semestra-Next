"""Pure rules of the academic structure (M02 §2, §3): subject codes, colors, term order, weeks.

No database access here, so every rule can be tested directly.
"""

import re
import zlib
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from difflib import SequenceMatcher
from typing import Any, Literal

PALETTE_SIZE = 12
_SUBJECT = re.compile(r"[A-Za-z]+")
_SPACES = re.compile(r"\s+")


def parse_subject_code(code: str | None) -> str:
    """The leading letters of a course code, upper-cased: 'aps105h1' → 'APS'; '' without any."""
    match = _SUBJECT.match((code or "").strip())
    return match.group(0).upper() if match else ""


def next_palette_slot(subject_colors: dict[str, Any]) -> int:
    """The palette slot used least by the Program's subjects (lowest slot on ties)."""
    counts = dict.fromkeys(range(1, PALETTE_SIZE + 1), 0)
    for color in subject_colors.values():
        slot = color.get("palette") if isinstance(color, dict) else None
        if isinstance(slot, int) and slot in counts:
            counts[slot] += 1
    return min(counts, key=lambda slot: (counts[slot], slot))


def color_ref(color: dict[str, Any] | None) -> str | None:
    """`{"palette": 3}` → 'subject-3', `{"hex": "#AbCdEf"}` → '#abcdef'."""
    if not isinstance(color, dict):
        return None
    slot = color.get("palette")
    if isinstance(slot, int) and 1 <= slot <= PALETTE_SIZE:
        return f"subject-{slot}"
    hex_value = color.get("hex")
    if isinstance(hex_value, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", hex_value):
        return hex_value.lower()
    return None


def resolve_course_color(
    color: dict[str, Any] | None,
    subject_code: str,
    subject_colors: dict[str, Any],
    fallback_key: str,
) -> str:
    """Course color > subject color > a palette slot hashed from the subject (M02 §2)."""
    own = color_ref(color)
    if own is None and subject_code:
        own = color_ref(subject_colors.get(subject_code))
    if own is not None:
        return own
    slot = zlib.crc32((subject_code or fallback_key).encode()) % PALETTE_SIZE + 1
    return f"subject-{slot}"


# --- terms ----------------------------------------------------------------------------------


def term_sort_key(term: Any) -> tuple[date, date, str]:
    """Chronological order of terms: start date, then end date, then id (any term-like row)."""
    return (term.start_date, term.end_date, term.id)


def is_consecutive(ordered_ids: Sequence[str], term_ids: Iterable[str]) -> bool:
    """Whether `term_ids` are neighbours in the Program's chronological order of terms."""
    positions = sorted(ordered_ids.index(t) for t in set(term_ids))
    return bool(positions) and positions[-1] - positions[0] == len(positions) - 1


def current_term[T](terms: Sequence[T], today: date) -> T | None:
    """The term today falls in; else the next to start; else the one that ended last."""
    ordered: list[Any] = sorted(terms, key=term_sort_key)
    running = [t for t in ordered if t.start_date <= today <= t.end_date]
    if running:
        return running[0]
    upcoming = [t for t in ordered if t.start_date > today]
    if upcoming:
        return upcoming[0]
    return max(ordered, key=lambda t: (t.end_date, t.start_date, t.id), default=None)


# --- weeks ----------------------------------------------------------------------------------

WeekStart = Literal[1, 7]


@dataclass(frozen=True)
class BreakSpan:
    id: str
    name: str
    start_date: date
    end_date: date


@dataclass(frozen=True)
class Week:
    start_date: date
    end_date: date
    number: int | None
    break_: BreakSpan | None


def week_start_of(day: date, week_start: WeekStart) -> date:
    offset = day.weekday() if week_start == 1 else (day.weekday() + 1) % 7
    return day - timedelta(days=offset)


def term_weeks(
    start: date,
    end: date,
    breaks: Sequence[BreakSpan],
    count_break_weeks: bool,
    week_start: WeekStart,
) -> list[Week]:
    """Every calendar week that touches the term, numbered from 1 (M02 §3).

    A week is a break week when more than half of its days inside the term fall in a break.
    Break weeks get no number unless `count_break_weeks`.
    """
    weeks: list[Week] = []
    number = 0
    first = week_start_of(start, week_start)
    for week_index in range((end - first).days // 7 + 1):
        week_first = first + timedelta(days=7 * week_index)
        week_last = week_first + timedelta(days=6)
        days = [
            week_first + timedelta(days=i)
            for i in range(7)
            if start <= week_first + timedelta(days=i) <= end
        ]
        covering: dict[str, int] = {}
        for day in days:
            for b in breaks:
                if b.start_date <= day <= b.end_date:
                    covering[b.id] = covering.get(b.id, 0) + 1
                    break
        in_break = sum(covering.values())
        brk = None
        if days and in_break * 2 > len(days):
            top = max(covering, key=lambda bid: covering[bid])
            brk = next(b for b in breaks if b.id == top)
        if brk is None or count_break_weeks:
            number += 1
            weeks.append(Week(week_first, week_last, number, brk))
        else:
            weeks.append(Week(week_first, week_last, None, brk))
    return weeks


def term_week_of(weeks: Sequence[Week], day: date) -> int | BreakSpan | None:
    """The week number of `day`, the break when it is an uncounted break week, or None when the
    day is outside the term."""
    for week in weeks:
        if week.start_date <= day <= week.end_date:
            return week.number if week.number is not None else week.break_
    return None


# --- fuzzy matching -------------------------------------------------------------------------


def normalize(text: str | None) -> str:
    """Case-insensitive and without spaces, so 'APS 105' matches 'aps105h1'."""
    return _SPACES.sub("", (text or "").casefold())


def matches(query: str, *texts: str | None) -> bool:
    q = normalize(query)
    return not q or any(q in normalize(t) for t in texts)


def match_score(query: str, code: str | None, alias: str | None, title: str) -> float:
    """How well `query` names a course, 0 to 1 (used by `academics.course.find`)."""
    q = normalize(query)
    if not q:
        return 0.0
    scores = [0.0]
    for text, weight in ((code, 1.0), (alias, 0.95), (title, 0.95)):
        n = normalize(text)
        if not n:
            continue
        if n == q:
            scores.append(weight)
        elif n.startswith(q):
            scores.append(0.9 * weight)
        elif q in n:
            scores.append(0.8 * weight)
        else:
            scores.append(0.6 * SequenceMatcher(None, q, n).ratio() * weight)
    words = query.casefold().split()
    title_words = title.casefold().split()
    if words and all(any(tw.startswith(w) for tw in title_words) for w in words):
        scores.append(0.85)
    return round(max(scores), 3)
