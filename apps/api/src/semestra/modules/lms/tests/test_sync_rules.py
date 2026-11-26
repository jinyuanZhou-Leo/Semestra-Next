"""The per-field sync decision (M09 §4.1), every state combination."""

from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest

from semestra.modules.lms.older_backups import materials_from_programs
from semestra.modules.lms.rules import (
    Action,
    diverged,
    due_state_of,
    facts_due_state,
    facts_state,
    is_new,
    item_due_state,
    marks,
    merge,
    next_sync,
    platform_value,
    same,
    state_of,
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
    # Excused on the platform: not counted; excused no more: counted again, unless the user
    # changed it. Not excusing gives no value: one the user left out stays out, never listed.
    ("dropped", False, False, True, Action.APPLY, Action.ASK),
    ("dropped", True, True, False, Action.APPLY, Action.ASK),
    ("dropped", False, True, False, Action.KEEP, Action.KEEP),
    ("dropped", False, True, True, Action.AGREE, Action.AGREE),
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
    # Not excusing is no value from the platform, like no due date.
    given = theirs is not None and theirs is not False
    expected = given and off in (Action.KEEP, Action.CONFLICT)
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


@pytest.mark.parametrize(
    ("name", "assignment", "state"),
    [
        ("graded", {"submission": {"score": 9}}, "graded"),
        ("excused", {"submission": {"excused": True, "missing": True}}, "excused"),
        (
            "waiting on the teacher",
            {"submission": {"score": 9, "needs_grading": True, "submitted_at": "2026-01-12"}},
            "submitted",
        ),
        ("marked missing", {"submission": {"missing": True}}, "missing"),
        (
            "on paper, marked missing",
            {"submission_types": ["on_paper"], "submission": {"missing": True}},
            "missing",
        ),
        ("on paper", {"submission_types": ["on_paper"]}, "offline"),
        ("nothing to hand in", {"submission_types": ["none"]}, "offline"),
        # Past due without the platform's flag: can still be handed in late.
        (
            "past due, not marked",
            {"due_at": "2026-01-10T12:00:00+00:00", "submission_types": ["online_upload"]},
            "unsubmitted",
        ),
        ("no ways given", {}, "unsubmitted"),
    ],
)
def test_assignment_state(name: str, assignment: dict[str, Any], state: str):
    """Read from the assignment's own fields, so a list kept in the cache before `state` was
    part of the reads is sorted the same."""
    assert state_of(assignment) == state


NOW = "2026-01-15T12:00:00+00:00"
BEFORE, AFTER = "2026-01-10T12:00:00+00:00", "2026-01-20T12:00:00+00:00"


@pytest.mark.parametrize(
    ("name", "assignment", "due"),
    [
        # One case per row of M09 table 3d, in its order.
        ("no due date", {}, "none"),
        ("handed in", {"due_at": AFTER, "submission": {"submitted_at": "2026-01-12"}}, "none"),
        ("graded", {"due_at": BEFORE, "submission": {"score": 9}}, "none"),
        ("excused", {"due_at": BEFORE, "submission": {"excused": True}}, "none"),
        ("due later", {"due_at": AFTER}, "upcoming"),
        ("on paper, due later", {"due_at": AFTER, "submission_types": ["on_paper"]}, "upcoming"),
        ("on paper, past due", {"due_at": BEFORE, "submission_types": ["on_paper"]}, "past"),
        ("past due, not handed in", {"due_at": BEFORE}, "overdue"),
        (
            "past due, marked missing",
            {"due_at": BEFORE, "submission": {"missing": True}},
            "overdue",
        ),
    ],
)
def test_due_state(name: str, assignment: dict[str, Any], due: str):
    assert due_state_of(assignment, datetime.fromisoformat(NOW)) == due


@pytest.mark.parametrize(
    ("name", "item", "due"),
    [
        ("no due date", {"completion": {"type": "must_submit"}}, "none"),
        ("no requirement", {"due_at": BEFORE}, "none"),
        (
            "done",
            {"due_at": BEFORE, "completion": {"type": "must_view", "completed": True}},
            "none",
        ),
        ("due later", {"due_at": AFTER, "completion": {"type": "must_submit"}}, "upcoming"),
        (
            "past due, not done",
            {"due_at": BEFORE, "completion": {"type": "must_submit"}},
            "overdue",
        ),
    ],
)
def test_module_item_due_state(name: str, item: dict[str, Any], due: str):
    assert item_due_state(item, datetime.fromisoformat(NOW)) == due


@pytest.mark.parametrize(
    ("name", "imported", "dismissed", "assignment", "submission", "new"),
    [
        # One case per row of M09 table 3e, in its order.
        ("imported", True, False, {"due_at": AFTER}, {}, False),
        ("ignored", False, True, {"due_at": AFTER}, {}, False),
        ("still to do", False, False, {"due_at": AFTER}, {}, True),
        ("past due", False, False, {"due_at": BEFORE}, {}, False),
        ("no due date", False, False, {}, {}, False),
        ("handed in", False, False, {"due_at": AFTER}, {"submitted_at": "2026-01-12"}, False),
        ("excused", False, False, {"due_at": AFTER}, {"excused": True}, False),
    ],
)
def test_is_new(
    name: str,
    imported: bool,
    dismissed: bool,
    assignment: dict[str, Any],
    submission: dict[str, Any],
    new: bool,
):
    now = datetime.fromisoformat(NOW)
    got = is_new(assignment, submission, imported=imported, dismissed=dismissed, now=now)
    assert got is new


def test_a_submission_never_read_has_no_state_and_no_due_hint():
    """Table 3b row 0 and 3d: not knowing whether it was handed in, nothing says it is due."""
    assignment = {"due_at": BEFORE}
    assert facts_state(assignment, None) is None
    assert facts_due_state(assignment, None, datetime.fromisoformat(NOW)) == "none"
    assert facts_state(assignment, {}) == "unsubmitted"


@pytest.mark.parametrize(
    ("state", "missing", "late", "shown"),
    [
        # M09 3b marks, each state with each flag, in the table's order.
        ("excused", True, True, []),
        ("missing", True, False, []),
        ("missing", True, True, ["late"]),
        ("graded", True, False, ["missing"]),
        ("graded", False, True, ["late"]),
        ("graded", True, True, ["missing", "late"]),
        ("submitted", True, True, ["missing", "late"]),
        ("unsubmitted", False, True, ["late"]),
        ("offline", False, True, ["late"]),
        (None, True, True, []),
    ],
)
def test_marks(state: Any, missing: bool, late: bool, shown: list[str]):
    assert marks(state, missing=missing, late=late) == shown


T = datetime.fromisoformat("2026-03-01T12:00:00+00:00")
H = timedelta(hours=1)


@pytest.mark.parametrize(
    ("name", "since", "retry_at", "due"),
    [
        ("nothing passing: the account's interval", None, None, T + 6 * H),
        ("unreadable an hour: an hour more", T - H, None, T + H),
        ("just now: the server's shortest", T, None, T + H / 2),
        ("a rate limit's wait is longer", T - H, T + 2 * H, T + 2 * H),
        ("never longer than the interval", T - 30 * H, None, T + 6 * H),
    ],
)
def test_a_part_not_read_for_a_passing_reason_is_tried_again_sooner_then_less_often(
    name: str, since: datetime | None, retry_at: datetime | None, due: datetime
):
    """M09 表 5c, "再试": the waits double from the server's shortest up to the interval."""
    assert next_sync(T, 6 * H, H / 2, since, retry_at) == due
