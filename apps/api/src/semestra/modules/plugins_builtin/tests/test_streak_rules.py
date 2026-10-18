from datetime import date, timedelta

from semestra.modules.plugins_builtin.habit_streak import streak


def d(n: int) -> date:
    """Day n of January 2026 (the 1st is a Thursday)."""
    return date(2026, 1, 1) + timedelta(days=n - 1)


def test_daily_streak_counts_back_from_today_or_yesterday():
    days = {d(3), d(4), d(5)}
    assert streak.daily_streaks(days, d(5)) == (3, 3)
    # Today not checked yet: the streak is still alive, counting back from yesterday.
    assert streak.daily_streaks(days, d(6)) == (3, 3)
    # Two days without a check-in end it, but the longest streak is remembered.
    assert streak.daily_streaks(days, d(7)) == (0, 3)


def test_daily_longest_streak_is_independent_of_the_current_one():
    days = {d(1), d(2), d(3), d(4), d(8), d(9)}
    assert streak.daily_streaks(days, d(9)) == (2, 4)
    assert streak.daily_streaks(set(), d(9)) == (0, 0)


def test_weekly_streak_counts_weeks_that_reach_the_target():
    # Monday-start weeks: Jan 5-11, Jan 12-18, Jan 19-25.
    days = {d(5), d(6), d(7), d(12), d(13), d(14), d(19)}
    assert streak.weekly_streaks(days, d(14), 3, 1) == (2, 2)
    # The running week (Jan 19-25) is still short, so it neither counts nor breaks the streak.
    assert streak.weekly_streaks(days, d(20), 3, 1) == (2, 2)
    # Once the running week is skipped entirely and the next one begins, the streak is over.
    assert streak.weekly_streaks(days, d(27), 3, 1) == (0, 2)


def test_weekly_streak_follows_the_week_start():
    # Sunday-start weeks put Sunday Jan 11 together with Mon-Wed Jan 12-14 (Jan 11-17).
    days = {d(11), d(12), d(13), d(14)}
    assert streak.weekly_streaks(days, d(14), 4, 7) == (1, 1)
    assert streak.weekly_streaks(days, d(14), 4, 1) == (0, 0)


def test_week_count_covers_the_week_of_today():
    days = {d(4), d(5)}  # Sunday Jan 4 and Monday Jan 5
    assert streak.week_count(days, d(7), 1) == 1  # Mon Jan 5 - Sun Jan 11
    assert streak.week_count(days, d(7), 7) == 2  # Sun Jan 4 - Sat Jan 10
