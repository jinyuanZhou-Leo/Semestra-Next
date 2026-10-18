"""The grading engine, rule by rule (M03 §3), against the hand-calculated cases in
`fixtures/grading_cases.json` and with property tests."""

import json
from pathlib import Path
from typing import Any

import pytest
from hypothesis import given
from hypothesis import strategies as st

from semestra.modules.grading import engine, presets
from semestra.modules.grading.engine import Band, Item

CASES: dict[str, Any] = json.loads(
    (Path(__file__).parent / "fixtures/grading_cases.json").read_text()
)


def uoft() -> engine.Scale:
    return engine.make_scale(
        [
            Band(b["min"], b["max"], b["points"], b["letter"])
            for b in presets.preset_bands("uoft_4_0")
        ],
        4.0,
    )


def items_of(rows: list[dict[str, Any]]) -> list[Item]:
    return [
        Item(r["id"], r["category"], r["weight"], r["score"], r.get("dropped", False)) for r in rows
    ]


# --- scale ----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("percentage", "points", "letter"),
    [
        (100, 4.0, "A+"),
        (105, 4.0, "A+"),  # bonus marks
        (90, 4.0, "A+"),
        (89.99, 4.0, "A"),
        (85, 4.0, "A"),
        (84.6, 3.7, "A-"),  # between 84 and 85: the band below
        (80, 3.7, "A-"),
        (79.5, 3.3, "B+"),
        (50, 0.7, "D-"),
        (49.9, 0.0, "F"),
        (0, 0.0, "F"),
        (-3, 0.0, "F"),
    ],
)
def test_percentage_to_points_boundaries(percentage: float, points: float, letter: str) -> None:
    assert engine.points_for(uoft(), percentage) == points
    assert engine.letter_for(uoft(), percentage) == letter


def test_minimum_percentage_for_points() -> None:
    scale = uoft()
    assert engine.min_percentage_for(scale, 4.0) == 85  # the A band starts lower than A+
    assert engine.min_percentage_for(scale, 3.7) == 80
    assert engine.min_percentage_for(scale, 0.0) == 0
    assert engine.min_percentage_for(scale, 4.5) is None


@pytest.mark.parametrize("preset", presets.PRESET_IDS)
def test_every_preset_is_a_valid_scale(preset: str) -> None:
    bands = [
        Band(b["min"], b["max"], b["points"], b["letter"]) for b in presets.preset_bands(preset)
    ]
    engine.validate_bands(bands, 4.0)


@pytest.mark.parametrize(
    ("bands", "max_points", "reason"),
    [
        ([], 4.0, "empty"),
        ([Band(0, 100, 4.0)], 0, "max_points_invalid"),
        ([Band(0, 100, 5.0)], 4.0, "points_out_of_range"),
        ([Band(50, 40, 1.0), Band(0, 49, 0)], 4.0, "range_invalid"),
        ([Band(0, 60, 1.0), Band(60, 100, 4.0)], 4.0, "overlap"),
        ([Band(0, 70, 1.0), Band(50, 100, 4.0)], 4.0, "overlap"),
        ([Band(10, 100, 1.0)], 4.0, "not_from_zero"),
        ([Band(0, 90, 1.0)], 4.0, "not_to_hundred"),
    ],
)
def test_invalid_scales(bands: list[Band], max_points: float, reason: str) -> None:
    with pytest.raises(engine.ScaleError) as info:
        engine.validate_bands(bands, max_points)
    assert info.value.reason == reason


def test_gaps_between_whole_number_bands_are_fine() -> None:
    engine.validate_bands([Band(0, 49, 0), Band(50, 100, 1.0)], 4.0)
    engine.validate_bands([Band(0, 49.5, 0), Band(50, 100, 1.0)], 4.0)


# --- one course -----------------------------------------------------------------------------


@pytest.mark.parametrize("case", CASES["course_cases"], ids=lambda c: c["name"])
def test_course_cases(case: dict[str, Any]) -> None:
    scale = uoft()
    items = items_of(case["items"])
    target_percentage = (
        engine.min_percentage_for(scale, case["target_points"]) if "target_points" in case else None
    )
    calc = engine.compute_course(
        items, target_percentage=target_percentage, override=case.get("override")
    )
    for key, expected in case["expect"].items():
        actual = getattr(calc, key)
        if key == "missing_history":
            actual = list(actual)
        assert actual == expected, f"{case['name']}: {key}"
    if "grade" in case:
        course = engine.CourseInput(
            "c", 0.5, True, ("t",), final_override=case.get("override"), items=tuple(items)
        )
        grade = engine.course_grade(course, scale)
        for key, expected in case["grade"].items():
            assert getattr(grade, key) == expected, f"{case['name']}: grade.{key}"


def test_override_applies_without_a_gradebook_too() -> None:
    course = engine.CourseInput(
        "c", 1.0, True, ("t",), gradebook_enabled=False, manual_percentage=81
    )
    grade = engine.course_grade(course, uoft())
    assert (grade.status, grade.percentage, grade.points) == ("completed", 81, 3.7)


def test_course_without_any_grade_is_in_progress() -> None:
    course = engine.CourseInput("c", 1.0, True, ("t",), gradebook_enabled=False)
    assert engine.course_grade(course, uoft()).status == "in_progress"


def test_in_progress_courses_can_count_their_current_average() -> None:
    items = tuple(items_of(CASES["course_cases"][1]["items"]))
    course = engine.CourseInput("c", 1.0, True, ("t",), items=items)
    plain = engine.course_grade(course, uoft())
    included = engine.course_grade(course, uoft(), include_in_progress=True)
    assert not plain.counts_in_gpa
    assert (included.counts_in_gpa, included.percentage, included.points) == (True, 80.0, 3.7)
    assert included.status == "in_progress"
    assert not included.earns_credits


def test_pass_fail_courses_never_count_for_gpa() -> None:
    def make(result: str | None) -> engine.CourseGrade:
        course = engine.CourseInput(
            "c",
            0.5,
            True,
            ("t",),
            basis="pass_fail",
            pass_fail_result=result,  # type: ignore[arg-type]
        )
        return engine.course_grade(course, uoft())

    passed, failed, unknown = make("pass"), make("fail"), make(None)
    assert (passed.status, passed.counts_in_gpa, passed.earns_credits) == ("passed", False, True)
    assert (failed.status, failed.earns_credits) == ("failed", False)
    assert unknown.status == "in_progress"


def test_zero_credit_or_excluded_courses_do_not_count() -> None:
    final = tuple(items_of([{"id": "a", "category": None, "weight": 100, "score": 90}]))
    zero = engine.CourseInput("c", 0, True, ("t",), items=final)
    excluded = engine.CourseInput("c", 1, False, ("t",), items=final)
    assert not engine.course_grade(zero, uoft()).counts_in_gpa
    assert not engine.course_grade(excluded, uoft()).counts_in_gpa


# --- suggested scores -----------------------------------------------------------------------


@pytest.mark.parametrize("case", CASES["suggest_cases"], ids=lambda c: c["name"])
def test_suggest_cases(case: dict[str, Any]) -> None:
    result = engine.suggest_scores(items_of(case["items"]), case["target_percentage"])
    assert result.scores == case["expect"]["scores"]
    assert result.resulting_percentage == case["expect"]["resulting_percentage"]
    assert result.reachable == case["expect"]["reachable"]


def test_suggestions_follow_category_history_and_land_on_the_target() -> None:
    items = [
        Item("q1", "quiz", 20, 95),
        Item("q2", "quiz", 20, None),
        Item("e1", "exam", 20, 60),
        Item("e2", "exam", 40, None),
    ]
    result = engine.suggest_scores(items, 80)
    assert result.reachable
    assert 80 <= result.resulting_percentage <= 80.2  # rounded up to half marks, never below
    assert result.scores["q2"] > result.scores["e2"]  # the student does better on quizzes
    assert all(score * 2 == int(score * 2) for score in result.scores.values())


def test_suggestions_reach_the_target_after_a_large_bonus_score() -> None:
    # 1% of the grade scored at 1000%: about 70.7% on the rest still lands on 80
    items = [Item("bonus", None, 1, 1000), Item("rest", None, 99, None)]
    result = engine.suggest_scores(items, 80)
    assert result.reachable
    assert result.scores["rest"] == pytest.approx(70.7, abs=0.5)
    assert result.resulting_percentage >= 80


def test_suggestions_without_remaining_items() -> None:
    result = engine.suggest_scores([Item("a", None, 100, 90)], 85)
    assert result.scores == {}
    assert result.reachable


# --- terms and the Program ------------------------------------------------------------------


def program_graded() -> list[engine.GradedCourse]:
    scale = uoft()
    graded: list[engine.GradedCourse] = []
    for c in CASES["program"]["courses"]:
        course = engine.CourseInput(
            c["id"],
            c["credits"],
            c["include_in_gpa"],
            tuple(c["terms"]),
            basis="pass_fail" if c.get("pass_fail") else "percentage",
            gradebook_enabled=False,
            manual_percentage=c.get("final"),
            pass_fail_result=c.get("pass_fail"),
        )
        graded.append(engine.GradedCourse(course, engine.course_grade(course, scale)))
    return graded


@pytest.mark.parametrize("rule", ["end_term", "split_evenly"])
def test_term_figures(rule: str) -> None:
    graded = program_graded()
    for term, expected in CASES["program"]["expect"][rule]["terms"].items():
        agg = engine.term_aggregate(graded, term, rule)  # type: ignore[arg-type]
        assert agg.gpa == expected["gpa"], term
        assert agg.average_percentage == expected["average"], term
        assert agg.credits_counted == expected["credits_counted"], term
        assert agg.credits_earned == expected["earned"], term
        assert agg.excluded_count == expected["excluded"], term


@pytest.mark.parametrize("rule", ["end_term", "split_evenly"])
def test_cumulative_gpa_per_term(rule: str) -> None:
    series = engine.program_series(program_graded(), CASES["program"]["terms"], rule)  # type: ignore[arg-type]
    expected = CASES["program"]["expect"][rule]["cumulative_gpa"]
    assert {p.term_id: p.cumulative_gpa for p in series} == expected


def test_program_figures_count_each_course_once() -> None:
    agg = engine.program_aggregate(program_graded())
    expected = CASES["program"]["expect"]["program"]
    assert agg.gpa == expected["gpa"]
    assert agg.average_percentage == expected["average"]
    assert agg.credits_counted == expected["credits_counted"]
    assert agg.credits_earned == expected["earned"]


def test_year_long_credits_by_rule() -> None:
    assert engine.attribute_credits(1.0, ["a", "b"], "end_term") == {"b": 1.0}
    assert engine.attribute_credits(1.0, ["a", "b"], "split_evenly") == {"a": 0.5, "b": 0.5}
    assert engine.attribute_credits(1.0, [], "end_term") == {}


# --- term What If ---------------------------------------------------------------------------


def open_courses() -> list[engine.GradedCourse]:
    scale = uoft()
    rows = [
        ("done", 1.0, 85.0),  # 4.0
        ("open1", 0.5, None),
        ("open2", 0.5, None),
    ]
    out: list[engine.GradedCourse] = []
    for course_id, credits, final in rows:
        course = engine.CourseInput(
            course_id, credits, True, ("t",), gradebook_enabled=False, manual_percentage=final
        )
        out.append(engine.GradedCourse(course, engine.course_grade(course, scale)))
    return out


def test_term_what_if_fills_in_unfinished_courses() -> None:
    result = engine.simulate_term(
        open_courses(), "t", "end_term", uoft(), {"open1": 77, "open2": 60}
    )
    # (4.0*1 + 3.3*.5 + 1.7*.5) / 2
    assert result.aggregate.gpa == 3.25


def test_term_what_if_target_needs_an_average_for_the_blank_courses() -> None:
    result = engine.simulate_term(open_courses(), "t", "end_term", uoft(), {"open1": 80}, 3.7)
    assert result.reachable is True
    # The other half-credit course at 77% (3.3): (4.0 + 1.85 + 1.65) / 2 = 3.75; at 73% only 3.675.
    assert result.required_percentage == 77
    assert result.max_possible_gpa == 3.925  # with the blank course at 100%


def test_an_ungraded_zero_weight_item_does_not_hold_the_course_open() -> None:
    items = [Item("exam", None, 100, 80), Item("placeholder", None, 0, None)]
    calc = engine.compute_course(items)
    assert calc.computed_percentage == 80
    assert calc.remaining_count == 0
    assert calc.final_percentage == 80
    assert engine.suggest_scores(items, 70).scores == {}


def test_a_scale_must_not_pay_less_for_a_higher_mark() -> None:
    bands = [Band(0, 89, 1.0), Band(90, 99, 4.0), Band(100, 100, 3.0)]
    with pytest.raises(engine.ScaleError) as error:
        engine.validate_bands(bands, 4.0)
    assert error.value.reason == "not_monotonic"
    engine.validate_bands([Band(0, 89, 1.0), Band(90, 100, 4.0)], 4.0)


def test_term_what_if_unreachable_target() -> None:
    scale = engine.make_scale([Band(0, 100, 2.0)], 4.0)
    course = engine.CourseInput("a", 1.0, True, ("t",), gradebook_enabled=False)
    graded = [engine.GradedCourse(course, engine.course_grade(course, scale))]
    result = engine.simulate_term(graded, "t", "end_term", scale, {}, 3.5)
    assert (result.reachable, result.required_percentage) == (False, None)


def test_term_what_if_ignores_marks_for_finished_courses() -> None:
    result = engine.simulate_term(open_courses(), "t", "end_term", uoft(), {"done": 0})
    assert result.aggregate.gpa == 4.0


# --- properties -----------------------------------------------------------------------------

scores = st.floats(min_value=0, max_value=100, allow_nan=False)


@st.composite
def complete_items(draw: st.DrawFn, graded_only: bool = True) -> list[Item]:
    n = draw(st.integers(min_value=1, max_value=8))
    raw = draw(st.lists(st.floats(min_value=0.5, max_value=50), min_size=n, max_size=n))
    total = sum(raw)
    weights = [w / total * 100 for w in raw]
    cats = draw(st.lists(st.sampled_from(["a", "b", None]), min_size=n, max_size=n))
    marks = draw(
        st.lists(scores if graded_only else st.one_of(scores, st.none()), min_size=n, max_size=n)
    )
    return [Item(f"i{k}", cats[k], weights[k], marks[k]) for k in range(n)]


@given(complete_items())
def test_property_complete_gradebook_stays_within_the_marks(items: list[Item]) -> None:
    calc = engine.compute_course(items)
    assert calc.weights_ok
    assert calc.final_percentage is not None
    assert -0.001 <= calc.final_percentage <= 100.001
    assert min(i.score or 0 for i in items) - 0.001 <= calc.final_percentage
    assert calc.final_percentage <= max(i.score or 0 for i in items) + 0.001


@given(complete_items(graded_only=False), st.floats(min_value=0, max_value=1000))
def test_property_override_wins(items: list[Item], override: float) -> None:
    calc = engine.compute_course(items, override=override)
    assert calc.final_percentage == round(override, 3)
    assert calc.final_source == "override"


@given(complete_items(graded_only=False), st.floats(min_value=1, max_value=100))
def test_property_dropped_items_change_nothing(items: list[Item], weight: float) -> None:
    extra = Item("dropped", "a", weight, 0.0, dropped=True)
    assert engine.compute_course(items) == engine.compute_course([*items, extra])


@given(complete_items(graded_only=False))
def test_property_locked_contribution_is_the_worst_case(items: list[Item]) -> None:
    calc = engine.compute_course(items)
    zeroed = [
        Item(i.id, i.category, i.weight, i.score if i.score is not None else 0) for i in items
    ]
    assert calc.locked_contribution == engine.compute_course(zeroed).final_percentage


@given(complete_items(graded_only=False), st.floats(min_value=1, max_value=100))
def test_property_suggestions_reach_the_target_when_reachable(
    items: list[Item], target: float
) -> None:
    result = engine.suggest_scores(items, target)
    if result.reachable:
        assert result.resulting_percentage >= round(target, 3) - 0.001
    assert all(0 <= s <= 100 for s in result.scores.values())


credit_choice = st.sampled_from([0.25, 0.5, 1.0, 1.5])


@given(
    st.lists(
        st.tuples(credit_choice, st.integers(min_value=1, max_value=3), scores),
        min_size=1,
        max_size=6,
    ),
    st.sampled_from(["end_term", "split_evenly"]),
)
def test_property_each_course_counts_once_in_the_program(
    rows: list[tuple[float, int, float]], rule: str
) -> None:
    scale = uoft()
    terms = ["t1", "t2", "t3"]
    graded: list[engine.GradedCourse] = []
    for k, (credits, span, mark) in enumerate(rows):
        start = k % 2
        course = engine.CourseInput(
            f"c{k}",
            credits,
            True,
            tuple(terms[start : start + span]),
            gradebook_enabled=False,
            manual_percentage=mark,
        )
        graded.append(engine.GradedCourse(course, engine.course_grade(course, scale)))
        parts = engine.attribute_credits(credits, course.term_ids, rule)  # type: ignore[arg-type]
        assert abs(sum(parts.values()) - credits) < 1e-9
    total = sum(engine.term_aggregate(graded, t, rule).credits_counted for t in terms)  # type: ignore[arg-type]
    program = engine.program_aggregate(graded)
    assert abs(total - program.credits_counted) < 0.01
    series = engine.program_series(graded, terms, rule)  # type: ignore[arg-type]
    assert series[-1].cumulative_gpa == program.gpa
