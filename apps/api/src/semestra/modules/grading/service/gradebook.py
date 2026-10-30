"""One course: its result, gradebook and what-if (M03)."""

from collections.abc import Sequence
from dataclasses import dataclass, replace
from typing import Any, Literal

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.core.events import events
from semestra.modules.academics import service as academics
from semestra.modules.academics.models import AcademicsProgram
from semestra.modules.academics.schemas import Course
from semestra.modules.grading import engine, models
from semestra.modules.grading.schemas import (
    CourseResult,
    CourseResultUpdateInput,
    Gradebook,
    GradebookSummary,
    GradeTarget,
    GradingScaleInfo,
    IgnoredScore,
    ScoreSuggestion,
    SimulateCourseInput,
    SimulatedGradebook,
    SuggestedScore,
    SuggestInput,
)
from semestra.modules.grading.service.assessments import _assessment_rows, assessment_out
from semestra.modules.grading.service.categories import _category_rows, category_out
from semestra.modules.grading.service.common import _reject_nulls
from semestra.modules.grading.service.courses import (
    _course_and_program,
    _result_out,
    ensure_course_setup,
)
from semestra.modules.grading.service.scales import get_scale_row, scale_of

_PASS_FAIL: dict[str, Literal["pass", "fail"]] = {"pass": "pass", "fail": "fail"}


def _items(rows: Sequence[models.GradingAssessment]) -> tuple[engine.Item, ...]:
    return tuple(
        engine.Item(r.id, r.category_id, r.weight, r.score_percentage, r.dropped) for r in rows
    )


def _forecast_model(value: str) -> engine.ForecastModel:
    return "simple_minimum_needed" if value == "simple_minimum_needed" else "auto"


def _resolve_target(
    scale: engine.Scale, default_points: float, target: GradeTarget | None
) -> tuple[float, float | None]:
    """(target grade points, lowest percentage reaching them) for a requested target."""
    if target is None:
        return default_points, engine.min_percentage_for(scale, default_points)
    if target.kind == "percentage":
        return engine.points_for(scale, target.value), target.value
    return target.value, engine.min_percentage_for(scale, target.value)


def _course_input(
    course: Course, result: models.GradingCourseResult | None, items: tuple[engine.Item, ...]
) -> engine.CourseInput:
    return engine.CourseInput(
        course_id=course.id,
        credits=course.credits,
        include_in_gpa=course.include_in_gpa,
        term_ids=tuple(course.term_ids),
        basis="pass_fail" if result and result.basis == "pass_fail" else "percentage",
        gradebook_enabled=result.gradebook_enabled if result else True,
        manual_percentage=result.manual_percentage if result else None,
        final_override=result.final_override_percentage if result else None,
        pass_fail_result=_PASS_FAIL.get(result.pass_fail_result or "") if result else None,
        items=items,
    )


def _reachable(
    calc: engine.CourseCalc,
    use_gradebook: bool,
    target_percentage: float | None,
    override: float | None,
) -> bool | None:
    """Whether the target can still be met; False when the scale has no band that high."""
    if not use_gradebook or override is not None:
        return None
    if target_percentage is None and calc.weights_ok:
        return False
    return calc.reachable


def build_summary(
    course: engine.CourseInput,
    scale: engine.Scale,
    forecast_model: engine.ForecastModel,
    target_points: float,
    target_percentage: float | None,
) -> tuple[GradebookSummary, engine.CourseCalc]:
    calc = engine.compute_course(
        course.items,
        target_percentage=target_percentage if course.basis == "percentage" else None,
        forecast_model=forecast_model,
        override=course.final_override,
    )
    grade = engine.course_grade(course, scale, calc=calc)
    use_gradebook = course.basis == "percentage" and course.gradebook_enabled
    final = grade.percentage if grade.status == "completed" else None
    if final is None or course.basis != "percentage":
        final_points = final_letter = None
    else:
        final_points, final_letter = grade.points, grade.letter
    source: Any = None
    if final is not None:
        source = calc.final_source if use_gradebook else "manual"

    def points(p: float | None) -> float | None:
        return None if p is None else engine.points_for(scale, p)

    def letter(p: float | None) -> str | None:
        return None if p is None else engine.letter_for(scale, p)

    current = calc.current_percentage if use_gradebook else None
    forecast = calc.forecast_percentage if use_gradebook else None
    summary = GradebookSummary.model_validate(
        {
            "status": grade.status,
            "weight_total": calc.weight_total,
            "weight_gap": calc.weight_gap,
            "weights_ok": calc.weights_ok,
            "graded_count": calc.graded_count,
            "remaining_count": calc.remaining_count,
            "graded_weight": calc.graded_weight,
            "remaining_weight": calc.remaining_weight,
            "locked_contribution": calc.locked_contribution if use_gradebook else None,
            "current_percentage": current,
            "current_points": points(current),
            "current_letter": letter(current),
            "final_percentage": final,
            "final_points": final_points,
            "final_letter": final_letter,
            "final_source": source,
            "overridden": use_gradebook and course.final_override is not None,
            "forecast_percentage": forecast,
            "forecast_points": points(forecast),
            "forecast_letter": letter(forecast),
            "predictions": calc.predictions if use_gradebook else {},
            "missing_history_category_ids": list(calc.missing_history) if use_gradebook else [],
            "target_points": target_points,
            "target_percentage": target_percentage,
            "required_average": calc.required_average if use_gradebook else None,
            "reachable": _reachable(calc, use_gradebook, target_percentage, course.final_override),
            "categories": [
                {
                    "category_id": c.category,
                    "weight": c.weight,
                    "graded_weight": c.graded_weight,
                    "average": c.average,
                    "contribution": c.contribution,
                }
                for c in calc.categories
            ]
            if use_gradebook
            else [],
        }
    )
    return summary, calc


@dataclass
class _CourseState:
    course: Course
    program: AcademicsProgram
    result: models.GradingCourseResult
    scale_row: models.GradingScale
    scale: engine.Scale
    categories: list[models.GradingCategory]
    rows: list[models.GradingAssessment]

    @property
    def default_target(self) -> float:
        """The course's own goal in grade points: the one chosen, else the scale's top."""
        chosen = self.result.target_points
        return self.scale_row.max_points if chosen is None else chosen


async def _load_course(ctx: Ctx, course_id: str) -> _CourseState:
    row, program = await _course_and_program(ctx, course_id)
    result = await ensure_course_setup(ctx, row.id, program.id)
    scale_row = await get_scale_row(ctx, program.id)
    return _CourseState(
        course=await academics.course_out(ctx, row),
        program=program,
        result=result,
        scale_row=scale_row,
        scale=scale_of(scale_row),
        categories=await _category_rows(ctx, row.id),
        rows=(await _assessment_rows(ctx, [row.id]))[row.id],
    )


def _summary_for(
    state: _CourseState, items: tuple[engine.Item, ...], target: GradeTarget | None = None
) -> tuple[GradebookSummary, engine.CourseCalc]:
    target_points, target_percentage = _resolve_target(state.scale, state.default_target, target)
    course = _course_input(state.course, state.result, items)
    return build_summary(
        course,
        state.scale,
        _forecast_model(state.result.forecast_model),
        target_points,
        target_percentage,
    )


async def get_gradebook(ctx: Ctx, course_id: str) -> Gradebook:
    state = await _load_course(ctx, course_id)
    summary, _ = _summary_for(state, _items(state.rows))
    tz = state.program.timezone
    return Gradebook(
        course_id=state.course.id,
        program_id=state.program.id,
        scale=GradingScaleInfo(
            max_points=state.scale_row.max_points,
            hide_gpa=state.scale_row.hide_gpa,
            round_before_lookup=state.scale_row.round_before_lookup,
        ),
        result=_result_out(state.result),
        categories=[category_out(c) for c in state.categories],
        assessments=[assessment_out(r, tz, ctx.now) for r in state.rows],
        summary=summary,
    )


async def update_result(ctx: Ctx, inp: CourseResultUpdateInput) -> CourseResult:
    course, program = await _course_and_program(ctx, inp.course_id)
    row = await ensure_course_setup(ctx, course.id, program.id)
    sent = inp.model_fields_set - {"course_id"}
    _reject_nulls(inp, {"basis", "forecast_model", "gradebook_enabled"})
    if inp.target_points is not None:
        scale = await get_scale_row(ctx, program.id)
        if inp.target_points > scale.max_points:
            raise AppError("grading.points_invalid", 422, reason="above_scale_maximum")
    for field in sorted(sent):
        setattr(row, field, getattr(inp, field))
    row.updated_at = ctx.now
    await ctx.db.flush()
    await events.publish(
        ctx, "grading.course_result.updated", {"course_id": course.id, "program_id": program.id}
    )
    return _result_out(row)


def _require_complete_weights(calc: engine.CourseCalc) -> None:
    if not calc.weights_ok:
        raise AppError(
            "grading.weights_not_100",
            422,
            weight_total=calc.weight_total,
            weight_gap=calc.weight_gap,
        )


async def simulate_course(ctx: Ctx, inp: SimulateCourseInput) -> SimulatedGradebook:
    state = await _load_course(ctx, inp.course_id)
    graded = {i.id for i in _items(state.rows) if i.score is not None}
    known = {r.id for r in state.rows}
    ignored = [
        IgnoredScore(id=aid, reason="graded" if aid in graded else "unknown")
        for aid in inp.scores
        if aid not in known or aid in graded
    ]
    items = tuple(
        engine.Item(
            i.id,
            i.category,
            i.weight,
            inp.scores[i.id] if i.score is None and i.id in inp.scores else i.score,
            i.dropped,
        )
        for i in _items(state.rows)
    )
    # What-if ignores the official grade: the question is what the marks would add up to.
    course = _course_input(state.course, state.result, items)
    course = replace(course, final_override=None)
    target_points, target_percentage = _resolve_target(
        state.scale, state.default_target, inp.target
    )
    summary, calc = build_summary(
        course,
        state.scale,
        _forecast_model(state.result.forecast_model),
        target_points,
        target_percentage,
    )
    _require_complete_weights(calc)
    return SimulatedGradebook(**summary.model_dump(), ignored=ignored)


async def suggest_scores(ctx: Ctx, inp: SuggestInput) -> ScoreSuggestion:
    state = await _load_course(ctx, inp.course_id)
    items = _items(state.rows)
    calc = engine.compute_course(items)
    _require_complete_weights(calc)
    _, target_percentage = _resolve_target(state.scale, state.default_target, inp.target)
    goal = 100.0 if target_percentage is None else target_percentage
    suggestion = engine.suggest_scores(items, goal)
    return ScoreSuggestion(
        items=[SuggestedScore(assessment_id=k, score=v) for k, v in suggestion.scores.items()],
        target_percentage=target_percentage,
        resulting_percentage=suggestion.resulting_percentage,
        reachable=suggestion.reachable and target_percentage is not None,
    )
