"""Pure rules: subject codes, colors, term order, week numbers, fuzzy matching (M02 §8)."""

from dataclasses import dataclass
from datetime import date

import pytest

from semestra.modules.academics import rules
from semestra.modules.academics.rules import BreakSpan


@pytest.mark.parametrize(
    ("code", "subject"),
    [("aps105h1", "APS"), ("MAT 137Y1", "MAT"), ("  csc148 ", "CSC"), ("105", ""), (None, "")],
)
def test_subject_code_is_the_leading_letters(code: str | None, subject: str):
    assert rules.parse_subject_code(code) == subject


def test_new_subjects_take_the_least_used_slot_lowest_first():
    assert rules.next_palette_slot({}) == 1
    used = {"APS": {"palette": 1}, "MAT": {"palette": 2}, "X": {"hex": "#000000"}}
    assert rules.next_palette_slot(used) == 3
    full = {f"S{i}": {"palette": i} for i in range(1, 13)} | {"T": {"palette": 1}}
    assert rules.next_palette_slot(full) == 2


def test_course_color_priority():
    subjects = {"APS": {"palette": 4}}
    assert rules.resolve_course_color({"hex": "#AABBCC"}, "APS", subjects, "c") == "#aabbcc"
    assert rules.resolve_course_color(None, "APS", subjects, "c") == "subject-4"
    hashed = rules.resolve_course_color(None, "ZZZ", subjects, "c")
    assert hashed.startswith("subject-")
    assert hashed == rules.resolve_course_color(None, "ZZZ", {}, "other")  # stable by subject


@dataclass
class T:
    id: str
    start_date: date
    end_date: date


FALL = T("fall", date(2026, 9, 8), date(2026, 12, 20))
WINTER = T("winter", date(2027, 1, 6), date(2027, 4, 30))
SUMMER = T("summer", date(2027, 5, 10), date(2027, 8, 15))


@pytest.mark.parametrize(
    ("today", "expected"),
    [
        (date(2026, 10, 1), "fall"),
        (date(2026, 12, 25), "winter"),  # between terms: the next one
        (date(2026, 8, 1), "fall"),
        (date(2027, 9, 1), "summer"),  # after everything: the last one
    ],
)
def test_current_term(today: date, expected: str):
    current = rules.current_term([WINTER, SUMMER, FALL], today)
    assert current is not None
    assert current.id == expected
    assert rules.current_term([], today) is None


def test_consecutive_terms():
    order = ["fall", "winter", "summer"]
    assert rules.is_consecutive(order, ["winter", "fall"])
    assert not rules.is_consecutive(order, ["fall", "summer"])
    assert not rules.is_consecutive(order, [])


READING = BreakSpan("b1", "Reading week", date(2026, 10, 12), date(2026, 10, 16))


def test_weeks_monday_start_skip_uncounted_break_weeks():
    weeks = rules.term_weeks(date(2026, 9, 8), date(2026, 10, 30), [READING], False, 1)
    assert weeks[0].start_date == date(2026, 9, 7)  # the Monday of the first day's week
    numbers = [w.number for w in weeks]
    assert numbers == [1, 2, 3, 4, 5, None, 6, 7]
    assert weeks[5].break_ == READING
    assert rules.term_week_of(weeks, date(2026, 10, 14)) == READING
    assert rules.term_week_of(weeks, date(2026, 10, 20)) == 6
    assert rules.term_week_of(weeks, date(2026, 11, 20)) is None


def test_weeks_counting_break_weeks_and_sunday_start():
    weeks = rules.term_weeks(date(2026, 9, 8), date(2026, 10, 30), [READING], True, 7)
    assert weeks[0].start_date == date(2026, 9, 6)  # a Sunday
    assert all(w.number is not None for w in weeks)
    assert rules.term_week_of(weeks, date(2026, 10, 14)) == 6
    # Mon-Fri of the break is 5 of 7 days: still a break week with a Sunday start.
    assert weeks[5].break_ == READING


def test_a_single_holiday_does_not_make_a_break_week():
    holiday = BreakSpan("h", "Thanksgiving", date(2026, 10, 12), date(2026, 10, 12))
    weeks = rules.term_weeks(date(2026, 9, 8), date(2026, 10, 30), [holiday], False, 1)
    assert all(w.number is not None for w in weeks)


def test_weeks_across_daylight_saving_change_stay_seven_days():
    # Clocks change on 2026-11-01 in North America; weeks are calendar dates, unaffected.
    weeks = rules.term_weeks(date(2026, 10, 26), date(2026, 11, 15), [], False, 1)
    assert [w.start_date.isoformat() for w in weeks] == ["2026-10-26", "2026-11-02", "2026-11-09"]
    assert rules.term_week_of(weeks, date(2026, 11, 1)) == 1


def test_fuzzy_matching_ignores_case_and_spaces():
    assert rules.matches("aps 105", "APS105H1", "Computer Fundamentals", None)
    assert not rules.matches("mat", "APS105H1", "Computer Fundamentals", None)
    exact = rules.match_score("APS105H1", "APS105H1", None, "Computer Fundamentals")
    prefix = rules.match_score("aps 105", "APS105H1", None, "Computer Fundamentals")
    title = rules.match_score("computer fund", "APS105H1", None, "Computer Fundamentals")
    nickname = rules.match_score("calc", "MAT137", "Calc", "Calculus with Proofs")
    unrelated = rules.match_score("history", "APS105H1", None, "Computer Fundamentals")
    assert exact == 1.0
    assert prefix > title > unrelated
    assert nickname >= 0.9
    assert unrelated < 0.35
