"""Pure task rules (M05 §3): overdue, ordering and fuzzy matching. No database access."""

from datetime import date, datetime, time
from difflib import SequenceMatcher

from semestra.modules.academics.rules import normalize

PRIORITY_RANK = {"urgent": 0, "high": 1, "medium": 2, "low": 3, "none": 4}
POSITION_STEP = 1024.0


def is_overdue(
    due_date: date | None, due_time: time | None, completed: bool, now_local: datetime
) -> bool:
    """Unfinished and past its due moment. A date without a time is due until that day ends."""
    if completed or due_date is None:
        return False
    if due_date != now_local.date():
        return due_date < now_local.date()
    return due_time is not None and due_time < now_local.time().replace(tzinfo=None)


def position_between(before: float | None, after: float | None) -> float:
    """A manual-order position that sorts between two neighbours (None = open end)."""
    if before is None and after is None:
        return POSITION_STEP
    if before is None:
        assert after is not None
        return after - POSITION_STEP
    if after is None:
        return before + POSITION_STEP
    return (before + after) / 2


def due_sort_key(due_date: date | None, due_time: time | None) -> tuple[int, date, time]:
    """Earliest first; tasks without a due date last; a date without a time before timed ones."""
    if due_date is None:
        return (1, date.max, time.max)
    return (0, due_date, due_time or time.min)


def match_score(query: str, title: str, notes: str = "") -> float:
    """How well `query` names a task, 0 to 1 (used by `tasks.item.find`)."""
    q = normalize(query)
    n = normalize(title)
    if not q or not n:
        return 0.0
    if n == q:
        return 1.0
    scores = [0.0]
    if n.startswith(q):
        scores.append(0.9)
    elif q in n:
        scores.append(0.8)
    else:
        scores.append(0.6 * SequenceMatcher(None, q, n).ratio())
    words = query.casefold().split()
    title_words = title.casefold().split()
    if words and all(any(tw.startswith(w) for tw in title_words) for w in words):
        scores.append(0.85)
    if q in normalize(notes):
        scores.append(0.5)
    return round(max(scores), 3)


def auto_title(course_code: str | None, assessment_title: str) -> str:
    return f"{course_code} · {assessment_title}" if course_code else assessment_title
