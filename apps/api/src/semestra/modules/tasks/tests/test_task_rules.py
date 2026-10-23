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


def test_a_used_up_gap_no_longer_fits():
    assert rules.fits_between(1.5, 1.0, 2.0)
    assert rules.fits_between(rules.position_between(None, 1.0), None, 1.0)
    low = 1.0
    high = low + 2e-16  # the next float after 1.0
    assert not rules.fits_between(rules.position_between(low, high), low, high)


def test_match_score_prefers_prefixes_and_ignores_spaces_and_case():
    assert rules.match_score("lab report", "Lab Report 2") > rules.match_score(
        "report", "Lab Report 2"
    )
    assert rules.match_score("LABREPORT2", "Lab report 2") == 1.0
    assert rules.match_score("zzz", "Lab report") < 0.35


def test_auto_title():
    assert rules.auto_title("APS105H1", "Midterm") == "APS105H1 · Midterm"
    assert rules.auto_title(None, "Midterm") == "Midterm"
