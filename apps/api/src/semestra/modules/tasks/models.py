from datetime import date, datetime, time

from sqlalchemy import (
    Boolean,
    Date,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Time,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from semestra.core.db import Base, OwnedMixin, TimestampMixin, new_id


class TasksList(Base, OwnedMixin, TimestampMixin):
    """A named list of tasks; term-less lists are visible in every term of the Program."""

    __tablename__ = "tasks_lists"
    __table_args__ = (
        UniqueConstraint("program_id", "term_id", "name"),
        Index("ix_tasks_lists_program", "user_id", "program_id"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    program_id: Mapped[str] = mapped_column(
        String, ForeignKey("academics_programs.id", ondelete="CASCADE")
    )
    term_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("academics_terms.id", ondelete="CASCADE"), default=None
    )
    name: Mapped[str] = mapped_column(String)
    color: Mapped[str | None] = mapped_column(String, default=None)
    icon: Mapped[str | None] = mapped_column(String, default=None)
    position: Mapped[int] = mapped_column(Integer, default=0)


class TasksItem(Base, OwnedMixin, TimestampMixin):
    __tablename__ = "tasks_items"
    __table_args__ = (
        Index("ix_tasks_items_program", "user_id", "program_id"),
        Index("ix_tasks_items_course", "course_id"),
        Index("ix_tasks_items_list", "list_id"),
        # An LMS import never creates the same platform item twice.
        Index(
            "uq_tasks_items_source",
            "user_id",
            "source_kind",
            "source_ref",
            unique=True,
            sqlite_where=text("source_kind = 'lms'"),
        ),
        # A dated assessment has exactly one task (M05 §3).
        Index(
            "uq_tasks_items_assessment",
            "assessment_id",
            unique=True,
            sqlite_where=text("assessment_id IS NOT NULL"),
        ),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    program_id: Mapped[str] = mapped_column(
        String, ForeignKey("academics_programs.id", ondelete="CASCADE")
    )
    term_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("academics_terms.id", ondelete="SET NULL"), default=None
    )
    course_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("academics_courses.id", ondelete="SET NULL"), default=None
    )
    list_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("tasks_lists.id", ondelete="SET NULL"), default=None
    )
    title: Mapped[str] = mapped_column(String)
    notes: Mapped[str] = mapped_column(String, default="")
    due_date: Mapped[date | None] = mapped_column(Date, default=None)
    # Wall-clock time in the Program's time zone; only set together with `due_date`.
    due_time: Mapped[time | None] = mapped_column(Time, default=None)
    priority: Mapped[str] = mapped_column(String, default="none")
    flagged: Mapped[bool] = mapped_column(Boolean, default=False)
    completed_at: Mapped[datetime | None] = mapped_column(default=None)
    position: Mapped[float] = mapped_column(Float, default=0.0)
    source_kind: Mapped[str | None] = mapped_column(String, default=None)
    source_ref: Mapped[str | None] = mapped_column(String, default=None)
    # The assessment this task stands for: title, due date and course follow it (auto.py), and
    # the task goes with it.
    assessment_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("grading_assessments.id", ondelete="CASCADE"), default=None
    )
