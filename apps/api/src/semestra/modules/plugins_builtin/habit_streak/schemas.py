import datetime as dt
from typing import Annotated, Literal

from pydantic import BaseModel, Field

PLUGIN_ID = "habit-streak"
# The habit calendar ("habit.board") became the ring card's M and L sizes (migration 0028).
CARD_IDS = ("habit.ring",)

# Defaults of the card settings (M14 §2); the card's zod schema uses the same values.
DEFAULT_GOAL = "daily"
DEFAULT_WEEKLY_TARGET = 3
# Check-ins may be changed for today and the seven days before it.
BACKFILL_DAYS = 7
# `habit.checkin.list` never spans more than this many days.
MAX_LIST_DAYS = 400

InstanceId = Annotated[str, Field(min_length=1, max_length=64)]


class CheckinToggleInput(BaseModel):
    instance_id: InstanceId = Field(description="Habit card instance id")
    date: dt.date = Field(
        description="Day to check or uncheck, in the Program's time zone: today or up to 7 days ago"
    )


class CheckinSetInput(BaseModel):
    instance_id: InstanceId = Field(description="Habit card instance id (layouts.card.list)")
    date: dt.date = Field(description="Day in the Program's time zone: today or up to 7 days ago")
    checked: bool = Field(default=True, description="True checks the day, false unchecks it")


class CheckinListInput(BaseModel):
    instance_id: InstanceId = Field(description="Habit card instance id")
    from_date: dt.date = Field(description="First day to list (inclusive)")
    to_date: dt.date = Field(description="Last day to list (inclusive)")


class StatsInput(BaseModel):
    instance_id: InstanceId = Field(description="Habit card instance id")


class CheckinToggleResult(BaseModel):
    date: dt.date
    checked: bool = Field(description="Whether the day is checked after the call")
    stats: HabitStreakGet


class CheckinList(BaseModel):
    items: list[dt.date] = Field(description="Checked days, ascending")


class HabitStreakGet(BaseModel):
    goal: Literal["daily", "weekly"]
    weekly_target: int = Field(description="Check-ins needed per week (weekly goal)")
    current_streak: int = Field(description="Days (daily goal) or weeks (weekly goal) in a row")
    longest_streak: int
    total: int = Field(description="All checked days")
    period_done: int = Field(description="Check-ins in the current day (daily) or week (weekly)")
    period_target: int = Field(description="1 for a daily goal, the weekly target otherwise")
    today: dt.date = Field(description="Today in the Program's time zone")
    week_start: Literal[1, 7] = Field(description="First day of the week: 1 Monday, 7 Sunday")
    checked_today: bool
