"""The per-field sync decision (M09 §4.1), every state combination."""

from typing import Any
from zoneinfo import ZoneInfo

import pytest

from semestra.modules.lms.rules import Action, diverged, merge, platform_value, same

A, B, C = "A1", "A1 (revised)", "A1 (final)"

# (base, ours, theirs) -> what happens with the automatic update on, and off.
CASES: list[tuple[str, Any, Any, Any, Action, Action]] = [
    # Nobody changed it.
    ("title", A, A, A, Action.AGREE, Action.AGREE),
    # Both changed it to the same value.
    ("title", A, B, B, Action.AGREE, Action.AGREE),
    # Only the user changed it.
    ("title", A, B, A, Action.KEEP, Action.KEEP),
    # Only the platform changed it.
    ("title", A, A, B, Action.APPLY, Action.ASK),
    # Both changed it, differently.
    ("title", A, B, C, Action.CONFLICT, Action.CONFLICT),
    # The platform took its due date away: followed like any change, unless the user moved it.
    (
        "due_at",
        {"date": "2026-11-04", "time": None},
        {"date": "2026-11-04", "time": None},
        None,
        Action.APPLY,
        Action.ASK,
    ),
    (
        "due_at",
        {"date": "2026-11-04", "time": None},
        {"date": "2026-11-05", "time": None},
        None,
        Action.CONFLICT,
        Action.CONFLICT,
    ),
    # The platform gives none where it gave one: a grade taken back, a course with no weights.
    ("score", {"score_percentage": 80}, {"score_percentage": 80}, None, Action.CLEAR, Action.CLEAR),
    ("weight", 10, 15, None, Action.CLEAR, Action.CLEAR),
    # A weight never set on either side is 0 in Semestra: the platform's first one is followed.
    ("weight", None, 0, 10, Action.APPLY, Action.ASK),
    ("weight", None, None, 10, Action.APPLY, Action.ASK),
    ("weight", None, 5, 10, Action.CONFLICT, Action.CONFLICT),
    # A first grade from the platform.
    ("score", None, None, {"score_percentage": 90}, Action.APPLY, Action.ASK),
    # The user filled in what the platform leaves empty.
    ("due_at", None, {"date": "2026-11-04", "time": None}, None, Action.KEEP, Action.KEEP),
    ("weight", None, 10, None, Action.CLEAR, Action.CLEAR),
    ("weight", None, 0, None, Action.CLEAR, Action.CLEAR),
    ("score", None, {"score_percentage": 85}, None, Action.CLEAR, Action.CLEAR),
    ("score", None, None, None, Action.CLEAR, Action.CLEAR),
]

# The cases (by index) whose field is listed as different from the platform: the user's value
# differs from the platform's, and nobody is asked about it.
LISTED = {2, 4, 6, 7, 8, 11, 13, 14, 16}


@pytest.mark.parametrize(("name", "base", "ours", "theirs", "on", "off"), CASES)
def test_merge(name: str, base: Any, ours: Any, theirs: Any, on: Action, off: Action):
    assert merge(name, base, ours, theirs, True) is on
    assert merge(name, base, ours, theirs, False) is off


@pytest.mark.parametrize(("index", "case"), list(enumerate(CASES)))
def test_the_different_list_is_what_the_user_set_apart(
    index: int, case: tuple[str, Any, Any, Any, Action, Action]
):
    name, base, ours, theirs, _, _ = case
    assert diverged(name, base, ours, theirs) is (index in LISTED)


@pytest.mark.parametrize(
    ("name", "a", "b", "equal"),
    [
        ("weight", 10, 10.004, True),
        ("weight", 10, 10.01, False),
        ("score", {"points_earned": 8, "points_possible": 10}, {"score_percentage": 80}, True),
        ("score", {"points_earned": 8, "points_possible": 10}, {"score_percentage": 81}, False),
        ("score", {"points_earned": None, "points_possible": 10}, {"score_percentage": 0}, False),
        ("title", None, None, True),
        ("title", None, "", False),
    ],
)
def test_same(name: str, a: Any, b: Any, equal: bool):
    assert same(name, a, b) is equal


def test_due_times_are_kept_to_the_minute_in_the_programs_zone():
    toronto = ZoneInfo("America/Toronto")
    due = platform_value("due_at", "2026-11-05T04:59:59Z", toronto)
    assert due == {"date": "2026-11-04", "time": "23:59:00"}
    assert same("due_at", due, {"date": "2026-11-04", "time": "23:59:00"})
