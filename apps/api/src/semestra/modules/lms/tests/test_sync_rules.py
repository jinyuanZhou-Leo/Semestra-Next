"""The per-field sync decision (M09 §4.1), every state combination."""

from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

import pytest

from semestra.modules.lms.older_backups import materials_from_programs
from semestra.modules.lms.rules import (
    Action,
    bucket,
    diverged,
    merge,
    platform_value,
    same,
    submission_status,
)

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
    # The user filled in what the platform leaves empty: theirs to keep, never listed as different.
    ("due_at", None, {"date": "2026-11-04", "time": None}, None, Action.KEEP, Action.KEEP),
    ("weight", None, 10, None, Action.CLEAR, Action.CLEAR),
    ("score", None, {"score_percentage": 85}, None, Action.CLEAR, Action.CLEAR),
]


@pytest.mark.parametrize(("name", "base", "ours", "theirs", "on", "off"), CASES)
def test_merge(name: str, base: Any, ours: Any, theirs: Any, on: Action, off: Action):
    assert merge(name, base, ours, theirs, True) is on
    assert merge(name, base, ours, theirs, False) is off


@pytest.mark.parametrize(("name", "base", "ours", "theirs", "on", "off"), CASES)
def test_the_different_list_is_what_the_user_set_apart(
    name: str, base: Any, ours: Any, theirs: Any, on: Action, off: Action
):
    del on
    expected = theirs is not None and off in (Action.KEEP, Action.CONFLICT)
    assert diverged(name, base, ours, theirs) is expected


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


def test_materials_settings_per_program_become_the_accounts_or_the_courses():
    """What every Program had alike becomes the account's; the rest goes to the courses of the
    Programs that differ from the default, where a course does not set it itself."""
    courses = {"p1": ["c1", "c2"], "p2": ["c3"]}
    alike = {"p1": {"store": "local", "sync": False}, "p2": {"store": "local"}}
    account, per_course = materials_from_programs(alike, courses, {"c2": {"sync": True}})
    assert account == {"store": "local"}
    assert per_course == {"c1": {"sync": False}}


@pytest.mark.parametrize(
    ("name", "kw", "status"),
    [
        ("nothing yet", {}, "unsubmitted"),
        ("handed in", {"submitted_at": "2026-02-01"}, "submitted"),
        ("graded without handing in", {"score": 0}, "graded"),
        ("a letter grade only", {"grade": "complete"}, "graded"),
        ("excused over a score", {"excused": True, "score": 0}, "excused"),
        (
            "resubmitted after a grade",
            {"score": 7, "submitted_at": "2026-02-03", "needs_grading": True},
            "submitted",
        ),
        ("held for grading by hand", {"score": 4, "needs_grading": True}, "submitted"),
    ],
)
def test_submission_status(name: str, kw: dict[str, Any], status: str):
    facts: dict[str, Any] = {"excused": False, "score": None, "grade": None, "submitted_at": None}
    assert submission_status(**(facts | kw)) == status


def test_the_filter_reads_the_submission_itself():
    """A list read before `status` was part of the reads (still in the cache) is sorted the
    same: from the submission's own fields."""
    now = datetime(2026, 1, 15, tzinfo=UTC)
    graded = {"due_at": "2026-01-10T12:00:00+00:00", "submission": {"score": 9}}
    waiting = {"submission": {"score": 9, "needs_grading": True, "submitted_at": "2026-01-12"}}
    on_paper = {"due_at": "2026-01-10T12:00:00+00:00", "submission_types": ["on_paper"]}
    late = {"due_at": "2026-01-10T12:00:00+00:00", "submission_types": ["online_upload"]}
    assert bucket(graded, now) == "graded"
    assert bucket(waiting, now) is None
    assert bucket(on_paper, now) is None
    assert bucket(late, now) == "missing"
