import datetime as dt
from typing import Annotated, Literal

from pydantic import BaseModel, Field

PLUGIN_ID = "pomodoro"
CARD_IDS = ("pomodoro.timer",)
MAX_SESSION_SEC = 4 * 3600
MAX_STATS_DAYS = 400
DEFAULT_STATS_DAYS = 7

InstanceId = Annotated[str, Field(min_length=1, max_length=64)]
Mode = Literal["focus", "short_break", "long_break"]


class SessionRecordInput(BaseModel):
    instance_id: InstanceId = Field(description="Pomodoro card instance id")
    course_id: str | None = Field(
        default=None, max_length=64, description="Course the focus time was spent on, if any"
    )
    started_at: dt.datetime = Field(description="When the session started (UTC, timezone-aware)")
    ended_at: dt.datetime = Field(description="When the session ended (UTC, timezone-aware)")
    duration_sec: int = Field(
        ge=1, le=MAX_SESSION_SEC, description="Seconds actually spent, without pauses"
    )
    mode: Mode = Field(default="focus", description="Only focus sessions count towards statistics")


class SessionRecorded(BaseModel):
    id: str
    duplicate: bool = Field(description="True when this session had been recorded before")


class StatsInput(BaseModel):
    from_date: dt.date | None = Field(
        default=None, description="First day (inclusive); defaults to 6 days before to_date"
    )
    to_date: dt.date | None = Field(
        default=None, description="Last day (inclusive); defaults to today"
    )
    course_id: str | None = Field(
        default=None, max_length=64, description="Only count focus time spent on this course"
    )
    program_id: str | None = Field(
        default=None,
        max_length=64,
        description="Program whose time zone defines the days; defaults to the active Program",
    )


class DayFocus(BaseModel):
    date: dt.date
    focus_sec: int
    sessions: int


class CourseFocus(BaseModel):
    course_id: str | None = Field(description="Null for focus time not tied to a course")
    focus_sec: int
    sessions: int


class PomodoroSessionSummarize(BaseModel):
    from_date: dt.date
    to_date: dt.date
    today: dt.date = Field(description="Today in the time zone used for the days")
    timezone: str
    total_focus_sec: int
    total_sessions: int
    days: list[DayFocus] = Field(description="Days with focus time, ascending")
    by_course: list[CourseFocus] = Field(description="Focus time per course, longest first")
