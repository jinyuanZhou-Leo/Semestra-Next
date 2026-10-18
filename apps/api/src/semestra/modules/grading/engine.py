"""Grade calculations of M03 §3, as pure functions: no database, no clock.

Percentages are 0-100 (bonus marks may go above 100), weights are percentages of the course, and
`points` are grade points on the Program's scale. Every function works on plain dataclasses, so
each rule can be tested on its own; `service.py` loads the rows and calls in here.

Results are rounded to `PRECISION` decimals only when they leave this module's public result
types; intermediate arithmetic uses full precision.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from itertools import pairwise
from math import ceil
from typing import Literal

WEIGHT_TOLERANCE = 0.01
SHRINK_K = 3
PRECISION = 3
_EPS = 1e-9

ForecastModel = Literal["auto", "simple_minimum_needed"]
YearAttribution = Literal["end_term", "split_evenly"]
Basis = Literal["percentage", "pass_fail"]
Status = Literal["completed", "in_progress", "passed", "failed"]


def _round(value: float | None) -> float | None:
    return None if value is None else round(value, PRECISION)


# --- grading scale --------------------------------------------------------------------------


@dataclass(frozen=True)
class Band:
    """Percentages `min`..`max` (inclusive) are worth `points`, optionally shown as `letter`."""

    min: float
    max: float
    points: float
    letter: str | None = None


@dataclass(frozen=True)
class Scale:
    bands: tuple[Band, ...]  # highest `min` first
    max_points: float


class ScaleError(ValueError):
    """An invalid scale; `reason` is a short machine-readable key for the error params."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def make_scale(bands: Sequence[Band], max_points: float) -> Scale:
    return Scale(tuple(sorted(bands, key=lambda b: (-b.min, -b.max))), max_points)


def validate_bands(bands: Sequence[Band], max_points: float) -> None:
    """Raise `ScaleError` unless the bands are non-overlapping and reach from 0 to 100.

    Gaps between neighbouring bands (89 → 90 in whole-number tables) are fine: a percentage in
    the gap belongs to the band below, because lookup uses each band's `min` only.
    """
    if max_points <= 0:
        raise ScaleError("max_points_invalid")
    if not bands:
        raise ScaleError("empty")
    ordered = sorted(bands, key=lambda b: b.min)
    for band in ordered:
        if band.min < 0 or band.max > 100 or band.min > band.max:
            raise ScaleError("range_invalid")
        if band.points < 0 or band.points > max_points:
            raise ScaleError("points_out_of_range")
    for lower, upper in pairwise(ordered):
        if upper.min <= lower.max:
            raise ScaleError("overlap")
    if ordered[0].min != 0:
        raise ScaleError("not_from_zero")
    if ordered[-1].max < 100:
        raise ScaleError("not_to_hundred")


def band_for(scale: Scale, percentage: float) -> Band:
    """The highest band whose `min` is at or below the percentage (M03 §3.8)."""
    for band in scale.bands:  # highest min first
        if percentage >= band.min - _EPS:
            return band
    return scale.bands[-1]  # below every band (negative input): the lowest one


def points_for(scale: Scale, percentage: float) -> float:
    return band_for(scale, percentage).points


def letter_for(scale: Scale, percentage: float) -> str | None:
    return band_for(scale, percentage).letter


def min_percentage_for(scale: Scale, target_points: float) -> float | None:
    """The lowest percentage worth at least `target_points`; None if the scale never gets there."""
    qualifying = [b.min for b in scale.bands if b.points >= target_points - _EPS]
    return min(qualifying) if qualifying else None


# --- gradebook of one course ----------------------------------------------------------------


@dataclass(frozen=True)
class Item:
    """One assessment as the engine sees it. `score` is None until it is graded."""

    id: str
    category: str | None
    weight: float
    score: float | None
    dropped: bool = False


@dataclass(frozen=True)
class CourseCalc:
    """Everything computed from a course's assessments (M03 §3.1-7)."""

    weight_total: float
    weight_gap: float
    weights_ok: bool
    graded_count: int
    remaining_count: int
    graded_weight: float
    remaining_weight: float
    # Items below are None when the weights do not add up to 100 (or the data is missing).
    locked_contribution: float | None  # the final grade if every remaining item scored 0
    current_percentage: float | None  # the average so far, weighted
    computed_percentage: float | None  # the final grade, once every item is graded
    final_percentage: float | None  # official override first, else the computed grade
    final_source: Literal["override", "computed"] | None
    forecast_percentage: float | None
    predictions: dict[str, float] = field(default_factory=dict)
    missing_history: tuple[str | None, ...] = ()
    target_percentage: float | None = None
    required_average: float | None = None
    reachable: bool | None = None


def weight_status(items: Sequence[Item]) -> tuple[float, float, bool]:
    total = sum(i.weight for i in items if not i.dropped)
    return total, 100 - total, abs(total - 100) <= WEIGHT_TOLERANCE


def _weighted_mean(items: Sequence[Item]) -> float | None:
    graded = [i for i in items if i.score is not None]
    if not graded:
        return None
    weight = sum(i.weight for i in graded)
    if weight <= 0:  # only zero-weight history: fall back to a plain average
        return sum(i.score or 0 for i in graded) / len(graded)
    return sum(i.weight * (i.score or 0) for i in graded) / weight


def compute_course(
    items: Sequence[Item],
    *,
    target_percentage: float | None = None,
    forecast_model: ForecastModel = "auto",
    override: float | None = None,
) -> CourseCalc:
    active = [i for i in items if not i.dropped]
    total, gap, ok = weight_status(active)
    graded = [i for i in active if i.score is not None]
    remaining = [i for i in active if i.score is None]
    graded_weight = sum(i.weight for i in graded)
    remaining_weight = sum(i.weight for i in remaining)
    base = {
        "weight_total": total,
        "weight_gap": gap,
        "weights_ok": ok,
        "graded_count": len(graded),
        "remaining_count": len(remaining),
        "graded_weight": graded_weight,
        "remaining_weight": remaining_weight,
        "target_percentage": target_percentage,
    }
    if not ok:  # §3.1: nothing is calculated, but an official grade still stands
        return _rounded(
            CourseCalc(
                **base,
                locked_contribution=None,
                current_percentage=None,
                computed_percentage=None,
                final_percentage=override,
                final_source="override" if override is not None else None,
                forecast_percentage=None,
            )
        )

    contribution = sum(i.weight * (i.score or 0) for i in graded) / 100
    current = contribution / graded_weight * 100 if graded_weight > 0 else None
    computed = contribution if not remaining else None
    final = override if override is not None else computed
    source = "override" if override is not None else ("computed" if computed is not None else None)

    predictions: dict[str, float] = {}
    missing: list[str | None] = []
    forecast: float | None = None
    if not remaining:
        forecast = contribution
    elif forecast_model == "auto":
        by_category: dict[str | None, list[Item]] = {}
        for item in graded:
            by_category.setdefault(item.category, []).append(item)
        for item in remaining:
            history = _weighted_mean(by_category.get(item.category, []))
            if history is None:
                if item.category not in missing:
                    missing.append(item.category)
            else:
                predictions[item.id] = history
        if not missing:
            forecast = contribution + sum(i.weight * predictions[i.id] for i in remaining) / 100

    required: float | None = None
    reachable: bool | None = None
    if target_percentage is not None and override is None:
        if remaining_weight <= 0:
            reachable = contribution >= target_percentage - _EPS
            required = 0.0 if reachable else None
        else:
            needed = (target_percentage - contribution) / remaining_weight * 100
            required = max(needed, 0.0)
            reachable = needed <= 100 + _EPS
    return _rounded(
        CourseCalc(
            **base,
            locked_contribution=contribution,
            current_percentage=current,
            computed_percentage=computed,
            final_percentage=final,
            final_source=source,
            forecast_percentage=forecast,
            predictions=predictions,
            missing_history=tuple(missing),
            required_average=required,
            reachable=reachable,
        )
    )


def _rounded(calc: CourseCalc) -> CourseCalc:
    return CourseCalc(
        weight_total=round(calc.weight_total, PRECISION),
        weight_gap=round(calc.weight_gap, PRECISION),
        weights_ok=calc.weights_ok,
        graded_count=calc.graded_count,
        remaining_count=calc.remaining_count,
        graded_weight=round(calc.graded_weight, PRECISION),
        remaining_weight=round(calc.remaining_weight, PRECISION),
        locked_contribution=_round(calc.locked_contribution),
        current_percentage=_round(calc.current_percentage),
        computed_percentage=_round(calc.computed_percentage),
        final_percentage=_round(calc.final_percentage),
        final_source=calc.final_source,
        forecast_percentage=_round(calc.forecast_percentage),
        predictions={k: round(v, PRECISION) for k, v in calc.predictions.items()},
        missing_history=calc.missing_history,
        target_percentage=_round(calc.target_percentage),
        required_average=_round(calc.required_average),
        reachable=calc.reachable,
    )


# --- suggested scores (What If auto-fill) ---------------------------------------------------


@dataclass(frozen=True)
class Suggestion:
    scores: dict[str, float]
    resulting_percentage: float
    reachable: bool


def _round_up_half(value: float) -> float:
    return ceil(value * 2 - _EPS) / 2


def suggest_scores(items: Sequence[Item], target_percentage: float) -> Suggestion:
    """A score for every ungraded item that lands exactly on the target (M03 §3.7).

    Each item starts from its category's average, shrunk toward the overall average with
    weight `SHRINK_K`; all are shifted by one common amount until the final grade reaches the
    target; then each is rounded up to the next 0.5 and capped at 100.
    """
    active = [i for i in items if not i.dropped]
    graded = [i for i in active if i.score is not None]
    remaining = [i for i in active if i.score is None]
    contribution = sum(i.weight * (i.score or 0) for i in graded) / 100
    if not remaining:
        return Suggestion(
            {}, round(contribution, PRECISION), contribution >= target_percentage - _EPS
        )

    overall = _weighted_mean(graded)
    if overall is None:
        overall = target_percentage  # nothing graded yet: start from "equally good everywhere"
    baselines: dict[str, float] = {}
    for item in remaining:
        same = [g for g in graded if g.category == item.category]
        category_mean = _weighted_mean(same)
        n = len(same)
        baselines[item.id] = (
            overall
            if category_mean is None
            else (n * category_mean + SHRINK_K * overall) / (n + SHRINK_K)
        )

    def final_with(shift: float, *, rounded: bool) -> float:
        total = contribution
        for item in remaining:
            score = min(100.0, max(0.0, baselines[item.id] + shift))
            if rounded:
                score = min(100.0, _round_up_half(score))
            total += item.weight * score / 100
        return total

    low, high = -200.0, 200.0
    for _ in range(80):  # final_with is monotone in the shift: bisect to the target
        mid = (low + high) / 2
        if final_with(mid, rounded=False) < target_percentage:
            low = mid
        else:
            high = mid
    shift = high
    scores = {
        item.id: min(100.0, _round_up_half(min(100.0, max(0.0, baselines[item.id] + shift))))
        for item in remaining
    }
    resulting = final_with(shift, rounded=True)
    return Suggestion(scores, round(resulting, PRECISION), resulting >= target_percentage - _EPS)


# --- a course's effective grade -------------------------------------------------------------


@dataclass(frozen=True)
class CourseInput:
    """What the summaries need to know about one course."""

    course_id: str
    credits: float
    include_in_gpa: bool
    term_ids: tuple[str, ...]  # chronological; a year-long course has several
    basis: Basis = "percentage"
    gradebook_enabled: bool = True
    manual_percentage: float | None = None
    final_override: float | None = None
    pass_fail_result: Literal["pass", "fail"] | None = None
    items: tuple[Item, ...] = ()


@dataclass(frozen=True)
class CourseGrade:
    status: Status
    percentage: float | None  # the final grade; the current average when in-progress is included
    points: float | None
    letter: str | None
    counts_in_gpa: bool
    earns_credits: bool
    # The course's own current average (None without a gradebook), for display while in progress.
    current_percentage: float | None = None


def course_grade(
    course: CourseInput,
    scale: Scale,
    *,
    include_in_progress: bool = False,
    calc: CourseCalc | None = None,
) -> CourseGrade:
    """The grade a course contributes to term and Program summaries (M03 §3.9)."""
    if course.basis == "pass_fail":
        result = course.pass_fail_result
        status: Status = (
            "in_progress" if result is None else ("passed" if result == "pass" else "failed")
        )
        return CourseGrade(status, None, None, None, False, status == "passed")

    current: float | None = None
    if course.gradebook_enabled:
        calc = calc or compute_course(course.items, override=course.final_override)
        final = calc.final_percentage
        current = calc.current_percentage
    else:
        final = course.manual_percentage
    percentage = final
    if final is None and include_in_progress:
        percentage = current
    if percentage is None:
        return CourseGrade("in_progress", None, None, None, False, False, current)
    points = points_for(scale, percentage)
    counts = course.include_in_gpa and course.credits > 0
    completed = final is not None
    return CourseGrade(
        "completed" if completed else "in_progress",
        round(percentage, PRECISION),
        points,
        letter_for(scale, percentage),
        counts,
        completed and points > 0,
        _round(current),
    )


# --- term and Program summaries -------------------------------------------------------------


def attribute_credits(
    credits: float, term_ids: Sequence[str], rule: YearAttribution
) -> dict[str, float]:
    """How a course's credits are spread over its terms (M03 §3.10)."""
    if not term_ids:
        return {}
    if rule == "split_evenly":
        return {t: credits / len(term_ids) for t in term_ids}
    return {term_ids[-1]: credits}


@dataclass(frozen=True)
class GradedCourse:
    course: CourseInput
    grade: CourseGrade


@dataclass(frozen=True)
class Aggregate:
    gpa: float | None
    average_percentage: float | None
    credits_counted: float  # credits of the courses behind the GPA
    credits_earned: float
    excluded_count: int  # courses of the scope that do not count towards the GPA


def _aggregate(parts: Sequence[tuple[GradedCourse, float]]) -> Aggregate:
    counted = [(g, c) for g, c in parts if g.grade.counts_in_gpa and c > 0]
    weight = sum(c for _, c in counted)
    gpa = sum((g.grade.points or 0) * c for g, c in counted) / weight if weight > 0 else None
    average = (
        sum((g.grade.percentage or 0) * c for g, c in counted) / weight if weight > 0 else None
    )
    earned = sum(c for g, c in parts if g.grade.earns_credits)
    return Aggregate(
        _round(gpa),
        _round(average),
        round(weight, PRECISION),
        round(earned, PRECISION),
        len(parts) - len(counted),
    )


def _term_parts(
    graded: Sequence[GradedCourse], term_id: str, rule: YearAttribution
) -> list[tuple[GradedCourse, float]]:
    """The courses whose credits land in the term, with the credits that do."""
    parts: list[tuple[GradedCourse, float]] = []
    for g in graded:
        landed = attribute_credits(g.course.credits, g.course.term_ids, rule).get(term_id)
        if landed is not None:
            parts.append((g, landed))
    return parts


def term_aggregate(
    graded: Sequence[GradedCourse], term_id: str, rule: YearAttribution
) -> Aggregate:
    """GPA, average and credits of one term; a course counts only where its credits land."""
    return _aggregate(_term_parts(graded, term_id, rule))


def program_aggregate(graded: Sequence[GradedCourse]) -> Aggregate:
    """Cumulative figures: every course once, with its full credits (M03 §3.11)."""
    return _aggregate([(g, g.course.credits) for g in graded])


@dataclass(frozen=True)
class TermPoint:
    term_id: str
    aggregate: Aggregate
    cumulative_gpa: float | None
    cumulative_credits: float


def program_series(
    graded: Sequence[GradedCourse], term_order: Sequence[str], rule: YearAttribution
) -> list[TermPoint]:
    """Per-term GPA with the cumulative GPA up to and including each term."""
    points: list[TermPoint] = []
    seen: list[tuple[GradedCourse, float]] = []
    for term_id in term_order:
        term_parts = _term_parts(graded, term_id, rule)
        seen.extend((g, c) for g, c in term_parts if c > 0)
        cumulative = _aggregate(seen)
        points.append(
            TermPoint(term_id, _aggregate(term_parts), cumulative.gpa, cumulative.credits_counted)
        )
    return points


# --- term What If ---------------------------------------------------------------------------


@dataclass(frozen=True)
class TermSimulation:
    aggregate: Aggregate
    target_gpa: float | None
    gap: float | None  # target - simulated GPA; positive means short of the target
    max_possible_gpa: float | None
    reachable: bool | None
    required_percentage: float | None  # one average for the courses still blank that hits it


def _as_if(g: GradedCourse, percentage: float, scale: Scale) -> GradedCourse:
    c = g.course
    points = points_for(scale, percentage)
    grade = CourseGrade(
        "in_progress",
        round(percentage, PRECISION),
        points,
        letter_for(scale, percentage),
        c.include_in_gpa and c.credits > 0,
        False,
        g.grade.current_percentage,
    )
    return GradedCourse(c, grade)


def _open(g: GradedCourse) -> bool:
    """Courses whose final grade is unknown, so a what-if mark can stand in for it."""
    return g.course.basis == "percentage" and g.grade.status == "in_progress"


def simulate_term(
    graded: Sequence[GradedCourse],
    term_id: str,
    rule: YearAttribution,
    scale: Scale,
    hypothetical: Mapping[str, float],
    target_gpa: float | None = None,
) -> TermSimulation:
    def with_blank(fill: float | None) -> list[GradedCourse]:
        out: list[GradedCourse] = []
        for g in graded:
            if _open(g) and g.course.course_id in hypothetical:
                out.append(_as_if(g, hypothetical[g.course.course_id], scale))
            elif _open(g) and fill is not None:
                out.append(_as_if(g, fill, scale))
            else:
                out.append(g)
        return out

    aggregate = term_aggregate(with_blank(None), term_id, rule)
    blank = [
        g
        for g in graded
        if _open(g)
        and g.course.course_id not in hypothetical
        and g.course.include_in_gpa
        and attribute_credits(g.course.credits, g.course.term_ids, rule).get(term_id, 0) > 0
    ]
    best = term_aggregate(with_blank(100.0), term_id, rule).gpa
    gap = None
    reachable: bool | None = None
    required: float | None = None
    if target_gpa is not None:
        gap = _round(target_gpa - aggregate.gpa) if aggregate.gpa is not None else None
        reachable = best is not None and best >= target_gpa - _EPS
        if reachable and blank:
            # The GPA only changes at band boundaries: the first one that gets there is the answer.
            for band_min in sorted({b.min for b in scale.bands}):
                gpa = term_aggregate(with_blank(band_min), term_id, rule).gpa
                if gpa is not None and gpa >= target_gpa - _EPS:
                    required = band_min
                    break
    return TermSimulation(aggregate, target_gpa, gap, best, reachable, required)
