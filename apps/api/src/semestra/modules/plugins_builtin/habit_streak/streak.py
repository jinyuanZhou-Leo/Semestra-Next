"""Streak arithmetic for habit check-ins (M14 §2). Pure functions over dates."""

from collections.abc import Collection
from datetime import date, timedelta
from typing import Literal

WeekStart = Literal[1, 7]


def week_start_of(day: date, week_start: WeekStart) -> date:
    offset = day.weekday() if week_start == 1 else (day.weekday() + 1) % 7
    return day - timedelta(days=offset)


def _runs(sorted_units: list[int]) -> int:
    longest = run = 0
    previous: int | None = None
    for unit in sorted_units:
        run = run + 1 if previous is not None and unit == previous + 1 else 1
        longest = max(longest, run)
        previous = unit
    return longest


def daily_streaks(days: Collection[date], today: date) -> tuple[int, int]:
    """(current, longest) streak of consecutive days.

    A streak stays alive while today is not yet checked: it counts back from yesterday.
    """
    ordinals = sorted({d.toordinal() for d in days})
    if not ordinals:
        return 0, 0
    have = set(ordinals)
    cursor = today.toordinal()
    if cursor not in have:
        cursor -= 1
    current = 0
    while cursor in have:
        current += 1
        cursor -= 1
    return current, _runs(ordinals)


def weekly_streaks(
    days: Collection[date], today: date, target: int, week_start: WeekStart
) -> tuple[int, int]:
    """(current, longest) streak of consecutive weeks with at least `target` check-ins.

    The running week does not break the streak while it is still short of the target.
    """
    per_week: dict[int, int] = {}
    for d in set(days):
        week = week_start_of(d, week_start).toordinal() // 7
        per_week[week] = per_week.get(week, 0) + 1
    # Weeks are keyed by their start ordinal // 7: consecutive weeks differ by exactly 1 because
    # every week start is 7 days after the previous one and starts on the same weekday.
    good = sorted(w for w, n in per_week.items() if n >= target)
    if not good:
        return 0, 0
    have = set(good)
    cursor = week_start_of(today, week_start).toordinal() // 7
    if cursor not in have:
        cursor -= 1
    current = 0
    while cursor in have:
        current += 1
        cursor -= 1
    return current, _runs(good)


def week_count(days: Collection[date], today: date, week_start: WeekStart) -> int:
    """How many check-ins fall in the week containing `today`."""
    start = week_start_of(today, week_start)
    return sum(1 for d in set(days) if start <= d <= start + timedelta(days=6))
