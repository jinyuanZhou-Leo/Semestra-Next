"""Pure sync rules (M09 §4.2, table 3): submission and assignment state, whether an item is
still on the platform (`presence`), the common value forms and the per-field three-way merge.
No database access.

Every field of an imported object is compared in three versions: the base (the platform value
last applied, its snapshot), ours (the value in Semestra) and theirs (the platform value now).
`merge` decides what the sync does with the field; the stage, the "different" list and taking a
platform value back all go through it, so they never disagree about a field.
"""

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Any, Literal
from zoneinfo import ZoneInfo

from semestra.modules.lms.answers import (
    AREA_HIDDEN,
    AreaResult,
    Gone,
    ItemAnswer,
    ItemResult,
    Present,
)

TITLE_MAX = 200
CLEARABLE = ("weight", "score")
"""Fields the platform may leave empty with nothing to follow (no weights, not graded yet)."""


class Action(StrEnum):
    CLEAR = "clear"
    """The platform has no value (weight, grade): nothing to follow or ask about."""
    AGREE = "agree"
    """Both sides hold the same value: the base moves up to it."""
    KEEP = "keep"
    """Only the user changed it: their value stays, set apart from the platform."""
    CONFLICT = "conflict"
    """Both sides changed it: the user is asked (edited)."""
    ASK = "ask"
    """Only the platform changed it, and the user turned following that field off."""
    APPLY = "apply"
    """Only the platform changed it: its value is written and logged."""


def _due(raw: str | None, tz: ZoneInfo) -> dict[str, str | None] | None:
    if not raw:
        return None
    local = datetime.fromisoformat(raw).astimezone(tz)
    at = local.time().replace(second=0, microsecond=0).isoformat()
    return {"date": local.date().isoformat(), "time": at}


def platform_value(name: str, raw: Any, tz: ZoneInfo) -> Any:
    """A platform (snapshot) value in the common form: a due date is `{date, time}` in the
    Program's zone to the minute (Semestra keeps no seconds; Canvas's default is 23:59:59)."""
    if name == "due_at":
        return _due(raw, tz)
    if name == "title":
        return str(raw)[:TITLE_MAX] if raw is not None else None
    return raw


def _percent(score: dict[str, Any] | None) -> float | None:
    if not score:
        return None
    if score.get("points_earned") is not None and score.get("points_possible"):
        return 100 * float(score["points_earned"]) / float(score["points_possible"])
    pct = score.get("score_percentage")
    return float(pct) if pct is not None else None


def same(name: str, a: Any, b: Any) -> bool:
    """Whether two values of a field in the common form are the same: weights and grades to
    half a hundredth (a grade as a percentage, however it is given), the rest exactly."""
    if a is None or b is None:
        return a is None and b is None
    if name == "weight":
        return abs(float(a) - float(b)) < 0.005
    if name == "score":
        pa, pb = _percent(a), _percent(b)
        return pa is not None and pb is not None and abs(pa - pb) < 0.005
    return a == b


def _untouched(name: str, base: Any, ours: Any) -> bool:
    # A weight never set on either side is 0 in Semestra until the user sets one.
    return same(name, ours, base) or (name == "weight" and base is None and not ours)


def merge(name: str, base: Any, ours: Any, theirs: Any, follows: bool) -> Action:
    """What the sync does with one field (see `Action`). `follows` is the user's automatic
    update switch for the field."""
    if theirs is None and name in CLEARABLE:
        return Action.CLEAR
    if same(name, theirs, ours):
        return Action.AGREE
    if same(name, theirs, base):
        return Action.KEEP
    if not _untouched(name, base, ours):
        return Action.CONFLICT
    return Action.APPLY if follows else Action.ASK


def diverged(name: str, base: Any, ours: Any, theirs: Any) -> bool:
    """Whether the user set the field apart from the platform value `theirs` and can take that
    value back. An empty platform value (no due date, weight or grade) is the user's to fill in,
    so it is never offered (owner 2026-11-12)."""
    return theirs is not None and merge(name, base, ours, theirs, False) in (
        Action.KEEP,
        Action.CONFLICT,
    )


SubmissionStatus = Literal["unsubmitted", "submitted", "graded", "excused"]
"""Where the user's submission of an assignment stands, the same for every platform."""

# How an assignment is handed in (`Assignment.submission_types`): these ways are not online, so
# such an assignment has nothing to hand in here and is never missing by its date alone.
OFFLINE_SUBMISSIONS = frozenset(("on_paper", "none", "not_graded"))


def submission_status(
    *,
    excused: bool,
    score: float | None,
    grade: str | None,
    submitted_at: datetime | str | None,
    needs_grading: bool = False,
) -> SubmissionStatus:
    """The one rule for a submission's status: excused before graded (a score or a grade, a
    pass/fail or letter grade included), graded before handed in. Work waiting on the teacher
    (`needs_grading`: a quiz with questions graded by hand, a resubmission after a grade) is
    handed in, not graded, even with the score of an earlier attempt. Whether the platform marks
    it missing or late is a separate flag."""
    if excused:
        return "excused"
    if (score is not None or grade) and not needs_grading:
        return "graded"
    if submitted_at is not None or needs_grading:
        return "submitted"
    return "unsubmitted"


def status_of(submission: Mapping[str, Any] | None) -> SubmissionStatus:
    """`submission_status` of a submission as the reads give it (a dumped `Submission`), from
    its own fields: what a cache kept before a field was added reads the same."""
    s = submission or {}
    return submission_status(
        excused=bool(s.get("excused")),
        score=s.get("score"),
        grade=s.get("grade"),
        submitted_at=s.get("submitted_at"),
        needs_grading=bool(s.get("needs_grading")),
    )


def submits_online(submission_types: list[str]) -> bool:
    """Whether the assignment is handed in on the platform (no ways given counts as online)."""
    return not submission_types or not set(submission_types) <= OFFLINE_SUBMISSIONS


AssignmentState = Literal["graded", "excused", "submitted", "missing", "offline", "unsubmitted"]
"""Where the user is with an assignment, the same for every platform and every surface (the app,
Sem, MCP)."""


def assignment_state(status: SubmissionStatus, *, missing: bool, online: bool) -> AssignmentState:
    """The one rule for an assignment's state: what the submission says when it is handed in
    (graded, excused, submitted); else missing when the platform marks it missing; else offline
    when it is not handed in on the platform (on paper, or nothing to hand in); else unsubmitted.
    Only the platform's flag makes it missing: past due without it, it can still be handed in
    late. The due date is not part of it: filter on it alongside."""
    if status != "unsubmitted":
        return status
    if missing:
        return "missing"
    return "unsubmitted" if online else "offline"


DueState = Literal["none", "upcoming", "past", "overdue"]
"""Whether an assignment's due date still matters to the user (M09 table 3d)."""


def due_state(due_at: datetime | None, state: AssignmentState, now: datetime) -> DueState:
    """M09 table 3d: nothing to show without a due date or once handed in, graded or excused;
    `upcoming` before the due date; past it, `past` for work not handed in on the platform
    (whether it was done can't be known) and `overdue` for the rest."""
    if due_at is None or state in ("graded", "excused", "submitted"):
        return "none"
    if due_at > now:
        return "upcoming"
    return "past" if state == "offline" else "overdue"


def item_due_state(item: Mapping[str, Any], now: datetime) -> DueState:
    """M09 table 3d for a module item (as the reads give it): nothing without a due date, a
    completion requirement, or once done; else `upcoming` or, past the date, `overdue`."""
    raw = item.get("due_at")
    completion = item.get("completion")
    if not raw or not completion or completion.get("completed"):
        return "none"
    due = raw if isinstance(raw, datetime) else datetime.fromisoformat(raw)
    return "upcoming" if due > now else "overdue"


def due_state_of(assignment: Mapping[str, Any], now: datetime) -> DueState:
    """`due_state` of an assignment as the reads give it (a dumped `Assignment`)."""
    raw = assignment.get("due_at")
    due = (raw if isinstance(raw, datetime) else datetime.fromisoformat(raw)) if raw else None
    return due_state(due, state_of(assignment), now)


def state_of(assignment: Mapping[str, Any]) -> AssignmentState:
    """`assignment_state` of an assignment as the reads give it (a dumped `Assignment`)."""
    sub = assignment.get("submission") or {}
    return assignment_state(
        status_of(sub),
        missing=bool(sub.get("missing")),
        online=submits_online(list(assignment.get("submission_types") or [])),
    )


# --- presence (table 3c) ----------------------------------------------------------------------

CHECK_EVERY = timedelta(days=1)
"""A single read this recent stands for this round (rows 7 and 8)."""
CHECKS_PER_RUN = 100
"""Single reads one course's round may make (row 10 and finding materials share them)."""


@dataclass(frozen=True)
class Check:
    """The last single read of an item (`lms_item_checks`)."""

    result: ItemResult
    at: datetime
    reason: str | None = None


Presence = Literal["present", "gone", "unknown", "check"]
"""Still on the platform; gone from it; not judged this round; read it on its own to tell
(then ask again with the answer)."""


def presence(
    *,
    listed: bool,
    areas: Iterable[AreaResult],
    now: datetime,
    read: ItemAnswer | None = None,
    last: Check | None = None,
    before_lookback: bool = False,
) -> Presence:
    """The one rule for whether an item (a material, an assignment, an announcement) is still on
    the platform, M09 table 3c, first row that holds. `listed`: in one of this round's area lists
    (locked ones too); `areas`: this round's result of each area it may be listed in (only the
    areas the provider offers); `read`: its single read this round, if any; `last`: its last
    single read before; `before_lookback`: an announcement posted before the window read.
    A round whose course could not be read judges nothing (row 1): it never gets here."""
    if before_lookback:
        return "unknown"  # 2: the platform was not asked
    if listed:
        return "present"  # 3
    if read is not None:  # 4-6
        if isinstance(read, Present):
            return "present"
        return "gone" if isinstance(read, Gone) else "unknown"
    if last is not None and now - last.at < CHECK_EVERY:
        if last.result == "present":
            return "present"  # 7: only reachable on its own (linked, link-only files)
        if last.result == "unavailable" and last.reason == AREA_HIDDEN:
            return "unknown"  # 8: its area is closed; reading again tells nothing new
    results = [r for r in areas if r != "unsupported"]
    if results and all(r == "whole" for r in results):
        return "gone"  # 9
    if "hidden" in results and all(r in ("whole", "hidden") for r in results):
        return "check"  # 10
    return "unknown"  # 11


# --- areas and the calendar (M09 表 3c, §4.8) -------------------------------------------------

# A list that came back: what the sync keeps of it is the platform's as of then.
READ_BACK: frozenset[str] = frozenset(("whole", "partial"))
# Not read only this once (表 2 第 11、13 行): the next round reads it as usual.
PASSING: frozenset[str] = frozenset(("lms.rate_limited", "lms.unreachable"))


def area_entry(
    previous: Mapping[str, Any] | None,
    result: AreaResult,
    at: datetime,
    reason: str | None = None,
) -> dict[str, str]:
    """How an area's list read this round (`LmsCourseLink.area_reads[area]`): the result and
    when, why it was unavailable (an error code), when it last came back at all (`read_at`)
    and when it last came back whole (`whole_at`: since then what is kept of it is as the
    platform last showed it); a round that did not read them keeps both."""
    entry = {"result": result, "at": at.isoformat()}
    if result == "unavailable" and reason:
        entry["reason"] = reason
    read_at = at.isoformat() if result in READ_BACK else (previous or {}).get("read_at")
    if read_at:
        entry["read_at"] = read_at
    whole_at = at.isoformat() if result == "whole" else (previous or {}).get("whole_at")
    if whole_at:
        entry["whole_at"] = whole_at
    return entry


CalendarRead = Literal["read", "waiting", "unreadable", "unsupported"]


def calendar_read(entry: Mapping[str, Any] | None) -> CalendarRead:
    """Where a course's calendar stands (§4.8, first row that holds): read once at least, never
    tried, tried and never read back; a platform without calendars counts as none of these."""
    if entry and entry.get("read_at"):
        return "read"
    # Never tried, or kept from it only by a rate limit or an outage.
    if not entry or entry.get("reason") in PASSING:
        return "waiting"
    if entry.get("result") == "unsupported":
        return "unsupported"
    return "unreadable"
