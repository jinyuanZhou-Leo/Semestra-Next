"""The platform's values fitted to what Semestra's objects take (M09 表 5c, "平台的值放不进
Semestra"): before an import creates an assessment or a to-do, and before the sync compares a
platform value with the object's (`rules.platform_value`), so a value Semestra can't hold never
turns into an error each round. The limits are read from the inputs of the modules' own
capabilities, never written here.

- Text longer than the object takes is cut to fit and ends with "…"; the mirror and the
  assignment's details keep the whole text.
- A number out of the object's range can't be fitted (`OUT`): an import writes the field's
  default, the sync neither writes nor follows it, and the panel lists it as set apart from the
  platform, "out of Semestra's range".
"""

from functools import cache
from typing import Any, Final, Literal

from pydantic import BaseModel

from semestra.modules.grading.schemas import AssessmentFields
from semestra.modules.imports.schemas import CategoryData
from semestra.modules.tasks.schemas import TaskFields

Kind = Literal["assessment", "task", "category"]


class _Out:
    def __repr__(self) -> str:
        return "OUT"


OUT: Final = _Out()
"""A platform number out of the object's range."""

ELLIPSIS = "…"

# A category is the assignment group an import creates with the assessments.
_MODELS: dict[str, type[BaseModel]] = {
    "assessment": AssessmentFields,
    "task": TaskFields,
    "category": CategoryData,
}
_TEXT = ("title", "name", "note", "notes")
_NUMBERS = ("weight", "weight_total")
# What an import writes for a field whose platform value can't be fitted.
DEFAULTS: dict[str, Any] = {"weight": 0, "score": None}


@cache
def _limits(kind: str, field: str) -> dict[str, Any]:
    """The JSON schema constraints of one field of the object's input (an optional one's
    non-null branch); none for a field the object doesn't have (a to-do's weight)."""
    prop = _MODELS[kind].model_json_schema()["properties"].get(field) or {}
    for branch in prop.get("anyOf", [prop]):
        if branch.get("type") != "null":
            return branch
    return prop


def _text(kind: str, field: str, value: str) -> str:
    most = _limits(kind, field).get("maxLength")
    if most is None or len(value) <= most:
        return value
    return value[: most - len(ELLIPSIS)].rstrip() + ELLIPSIS


def _in_range(kind: str, field: str, value: float) -> bool:
    c = _limits(kind, field)
    return not (
        ("minimum" in c and value < c["minimum"])
        or ("exclusiveMinimum" in c and value <= c["exclusiveMinimum"])
        or ("maximum" in c and value > c["maximum"])
        or ("exclusiveMaximum" in c and value >= c["exclusiveMaximum"])
    )


def fit(kind: str | None, name: str, value: Any) -> Any:
    """`value` of field `name` (in the sync's common form) as the object of `kind` takes it:
    text cut to fit, a number out of range `OUT`, the rest as it is."""
    kind = kind or "task"
    if value is None:
        return None
    if name in _TEXT:
        return _text(kind, "notes" if kind == "task" and name == "note" else name, str(value))
    if name in _NUMBERS:
        return value if _in_range(kind, name, float(value)) else OUT
    if name == "score" and isinstance(value, dict):
        fields = [
            f
            for f in ("points_earned", "points_possible", "score_percentage")
            if value.get(f) is not None
        ]
        return value if all(_in_range(kind, f, float(value[f])) for f in fields) else OUT
    return value


def fit_or_default(kind: str | None, name: str, value: Any) -> Any:
    """`fit`, with a value that can't be fitted taken as the field's default: what an import
    writes, and what the object took from a snapshot the platform gave out of range."""
    got = fit(kind, name, value)
    return DEFAULTS.get(name) if got is OUT else got


# Where an imported object's snapshot keeps the platform values out of its range, by field: the
# field itself keeps what the object took (its default, or the last value in range), so the
# sync follows again once the platform's value is back in range (M09 表 5c).
OUT_OF_RANGE = "out_of_range"


def snapshot_for(kind: str | None, snap: dict[str, Any]) -> dict[str, Any]:
    """An import's snapshot (`imports.snapshot`) as the object of `kind` took it: each number
    out of its range set aside under `OUT_OF_RANGE`, the field holding its default."""
    out = dict(snap.get(OUT_OF_RANGE) or {})
    snap = dict(snap)
    for name in DEFAULTS:
        if fit(kind, name, snap.get(name)) is OUT:
            out[name] = snap[name]
            snap[name] = DEFAULTS[name]
    if out:
        snap[OUT_OF_RANGE] = out
    return snap


def set_out(snap: dict[str, Any], name: str, raw: Any) -> None:
    """Notes in the snapshot that the platform's value of `name` is out of range (`raw`), or
    back in range (`raw` None)."""
    out = dict(snap.get(OUT_OF_RANGE) or {})
    if raw is None:
        out.pop(name, None)
    else:
        out[name] = raw
    if out:
        snap[OUT_OF_RANGE] = out
    else:
        snap.pop(OUT_OF_RANGE, None)
