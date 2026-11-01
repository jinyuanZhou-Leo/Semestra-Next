from datetime import date, datetime, time
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Integer,
    String,
    Time,
    UniqueConstraint,
    text,
)
from sqlalchemy import false as sa_false
from sqlalchemy.orm import Mapped, mapped_column

from semestra.core.db import Base, OwnedMixin, TimestampMixin, UTCDateTime, new_id


class ScheduleEventType(Base, OwnedMixin):
    """A kind of class or event (LEC, TUT, ...), shared by the courses of one Program (M04 §2)."""

    __tablename__ = "schedule_event_types"
    __table_args__ = (UniqueConstraint("program_id", "code", name="uq_schedule_event_types_code"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    program_id: Mapped[str] = mapped_column(
        String, ForeignKey("academics_programs.id", ondelete="CASCADE"), index=True
    )
    code: Mapped[str] = mapped_column(String)  # upper case, e.g. "LEC"
    name: Mapped[str] = mapped_column(String)
    color: Mapped[str | None] = mapped_column(String, default=None)  # "subject-N" or "#rrggbb"
    icon: Mapped[str | None] = mapped_column(String, default=None)  # lucide icon name
    builtin: Mapped[bool] = mapped_column(Boolean, default=False)
    position: Mapped[int] = mapped_column(Integer, default=0)


class ScheduleMeeting(Base, OwnedMixin, TimestampMixin):
    """A recurring class section of a course in one term. Weekday and times are wall-clock times
    in the Program's time zone."""

    __tablename__ = "schedule_meetings"
    __table_args__ = (
        CheckConstraint("start_time < end_time", name="ck_schedule_meetings_times"),
        Index("ix_schedule_meetings_course_term", "course_id", "term_id"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    course_id: Mapped[str] = mapped_column(
        String, ForeignKey("academics_courses.id", ondelete="CASCADE")
    )
    term_id: Mapped[str] = mapped_column(
        String, ForeignKey("academics_terms.id", ondelete="CASCADE"), index=True
    )
    section_code: Mapped[str] = mapped_column(String, default="")
    type_code: Mapped[str] = mapped_column(String)
    title: Mapped[str | None] = mapped_column(String, default=None)
    instructor: Mapped[str | None] = mapped_column(String, default=None)
    location: Mapped[str | None] = mapped_column(String, default=None)
    weekday: Mapped[int] = mapped_column(Integer)  # 1 = Monday .. 7 = Sunday
    start_time: Mapped[time] = mapped_column(Time)
    end_time: Mapped[time] = mapped_column(Time)
    recurrence: Mapped[str] = mapped_column(String, default="weekly")  # weekly | biweekly
    anchor_week: Mapped[int] = mapped_column(Integer, default=1)
    start_week: Mapped[int] = mapped_column(Integer, default=1)
    end_week: Mapped[int | None] = mapped_column(Integer, default=None)
    skip_breaks: Mapped[bool] = mapped_column(Boolean, default=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    source_kind: Mapped[str | None] = mapped_column(String, default=None)
    source_ref: Mapped[str | None] = mapped_column(String, default=None)


class ScheduleMeetingException(Base, OwnedMixin):
    """One cancelled or moved occurrence of a meeting."""

    __tablename__ = "schedule_meeting_exceptions"
    __table_args__ = (
        UniqueConstraint("meeting_id", "original_date", name="uq_schedule_exceptions_date"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    meeting_id: Mapped[str] = mapped_column(
        String, ForeignKey("schedule_meetings.id", ondelete="CASCADE"), index=True
    )
    original_date: Mapped[date] = mapped_column(Date)
    kind: Mapped[str] = mapped_column(String)  # cancelled | moved
    new_date: Mapped[date | None] = mapped_column(Date, default=None)
    new_start_time: Mapped[time | None] = mapped_column(Time, default=None)
    new_end_time: Mapped[time | None] = mapped_column(Time, default=None)
    new_location: Mapped[str | None] = mapped_column(String, default=None)
    note: Mapped[str | None] = mapped_column(String, default=None)
    # Written by an importer: a repeated import may remove it; the user's own changes it never
    # touches.
    imported: Mapped[bool] = mapped_column(Boolean, default=False, server_default=sa_false())


class ScheduleEvent(Base, OwnedMixin, TimestampMixin):
    """A one-off event: an exam, office hour or make-up class."""

    __tablename__ = "schedule_events"
    __table_args__ = (
        CheckConstraint("start_at <= end_at", name="ck_schedule_events_times"),
        Index("ix_schedule_events_program_start", "program_id", "start_at"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    program_id: Mapped[str] = mapped_column(
        String, ForeignKey("academics_programs.id", ondelete="CASCADE")
    )
    term_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("academics_terms.id", ondelete="CASCADE"), default=None
    )
    course_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("academics_courses.id", ondelete="CASCADE"), default=None, index=True
    )
    type_code: Mapped[str | None] = mapped_column(String, default=None)
    title: Mapped[str] = mapped_column(String)
    start_at: Mapped[datetime] = mapped_column(UTCDateTime)
    end_at: Mapped[datetime] = mapped_column(UTCDateTime)
    all_day: Mapped[bool] = mapped_column(Boolean, default=False)
    location: Mapped[str | None] = mapped_column(String, default=None)
    note: Mapped[str | None] = mapped_column(String, default=None)
    source_kind: Mapped[str | None] = mapped_column(String, default=None)
    source_ref: Mapped[str | None] = mapped_column(String, default=None)


class ScheduleFeed(Base, OwnedMixin):
    """A Program's read-only ICS subscription link (at most one not revoked): looked up by the
    token's hash, the token itself is kept encrypted so the link can be shown again (`None` for
    links made before 0029, which show no URL until reset)."""

    __tablename__ = "schedule_feeds"
    __table_args__ = (
        # One link per Program: two "turn on" requests at once must not leave a second live link.
        Index(
            "uq_schedule_feeds_active",
            "user_id",
            "program_id",
            unique=True,
            sqlite_where=text("revoked_at IS NULL"),
        ),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    program_id: Mapped[str] = mapped_column(
        String, ForeignKey("academics_programs.id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(String, unique=True)
    prefix: Mapped[str] = mapped_column(String)
    token_encrypted: Mapped[str | None] = mapped_column(String, default=None)
    sources: Mapped[list[Any]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime)
    last_fetched_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime, default=None)
