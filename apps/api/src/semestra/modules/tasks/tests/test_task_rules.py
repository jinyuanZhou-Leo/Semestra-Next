from datetime import date, datetime, time

from semestra.modules.tasks import rules


def local(day: str, clock: str) -> datetime:
    return datetime.fromisoformat(f"{day}T{clock}")


def test_overdue_needs_an_unfinished_task_past_its_due_moment():
    now = local("2026-01-15", "10:00")
    assert rules.is_overdue(date(2026, 1, 14), None, False, now)
    assert not rules.is_overdue(date(2026, 1, 14), None, True, now)
    assert not rules.is_overdue(None, None, False, now)
    assert not rules.is_overdue(date(2026, 1, 16), time(1, 0), False, now)


def test_a_date_without_time_is_due_until_the_day_ends():
    assert not rules.is_overdue(date(2026, 1, 15), None, False, local("2026-01-15", "23:59"))
    assert rules.is_overdue(date(2026, 1, 15), None, False, local("2026-01-16", "00:00"))


def test_a_timed_task_is_overdue_once_the_time_passes():
    due = (date(2026, 1, 15), time(9, 0))
    assert not rules.is_overdue(*due, False, local("2026-01-15", "08:59"))
    assert rules.is_overdue(*due, False, local("2026-01-15", "09:01"))


def test_position_between_neighbours():
    assert rules.position_between(None, None) == rules.POSITION_STEP
    assert rules.position_between(1.0, None) > 1.0
    assert rules.position_between(None, 1.0) < 1.0
    assert rules.position_between(1.0, 2.0) == 1.5


def test_due_sort_puts_undated_last_and_untimed_before_timed():
    keys = [
        rules.due_sort_key(None, None),
        rules.due_sort_key(date(2026, 1, 2), time(9, 0)),
        rules.due_sort_key(date(2026, 1, 2), None),
        rules.due_sort_key(date(2026, 1, 1), time(23, 0)),
    ]
    assert sorted(keys) == [keys[3], keys[2], keys[1], keys[0]]


def test_match_score_prefers_prefixes_and_ignores_spaces_and_case():
    assert rules.match_score("lab report", "Lab Report 2") > rules.match_score(
        "report", "Lab Report 2"
    )
    assert rules.match_score("LABREPORT2", "Lab report 2") == 1.0
    assert rules.match_score("zzz", "Lab report") < 0.35


def test_auto_title():
    assert rules.auto_title("APS105H1", "Midterm") == "APS105H1 · Midterm"
    assert rules.auto_title(None, "Midterm") == "Midterm"
