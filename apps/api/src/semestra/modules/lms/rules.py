"""Pure sync rules (M09 §4.1): the common value forms and the per-field three-way merge.
No database access.

Every field of an imported object is compared in three versions: the base (the platform value
last applied, its snapshot), ours (the value in Semestra) and theirs (the platform value now).
`merge` decides what the sync does with the field; the stage, the "different" list and taking a
platform value back all go through it, so they never disagree about a field.
"""

from datetime import datetime
from enum import StrEnum
from typing import Any
from zoneinfo import ZoneInfo

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
    value back, including a value filled in where the platform has none (owner 2026-11-12)."""
    action = merge(name, base, ours, theirs, False)
    if action is Action.CLEAR:
        return not _untouched(name, None, ours)
    return action in (Action.KEEP, Action.CONFLICT)


def held(name: str, value: Any) -> Any:
    """What Semestra holds for a value in the common form: an empty weight is 0 there."""
    return 0.0 if name == "weight" and value is None else value
