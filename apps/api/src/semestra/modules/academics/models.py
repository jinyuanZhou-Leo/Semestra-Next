from datetime import date
from typing import Any

from sqlalchemy import (
    JSON,
    CheckConstraint,
    Date,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column

from semestra.core.db import Base, OwnedMixin, TimestampMixin, new_id


class AcademicsProgram(Base, OwnedMixin, TimestampMixin):
    """A degree or study plan; the root of the academic hierarchy (M02 §2)."""

    __tablename__ = "academics_programs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String)
    institution: Mapped[str | None] = mapped_column(String, default=None)
    timezone: Mapped[str] = mapped_column(String)  # IANA name
    default_course_credits: Mapped[float] = mapped_column(Float, default=0.5)
    credit_requirement: Mapped[float | None] = mapped_column(Float, default=None)
    # {"APS": {"palette": 3} | {"hex": "#2563eb"}}; entries are never removed automatically.
    subject_colors: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class AcademicsTerm(Base, OwnedMixin, TimestampMixin):
    __tablename__ = "academics_terms"
    __table_args__ = (
        CheckConstraint("start_date <= end_date", name="ck_academics_terms_dates"),
        Index("ix_academics_terms_program_start", "program_id", "start_date"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    program_id: Mapped[str] = mapped_column(
        String, ForeignKey("academics_programs.id", ondelete="CASCADE")
    )
    name: Mapped[str] = mapped_column(String)
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    # [{id, name, start_date, end_date}] (ISO dates), validated by the service.
    breaks: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    count_break_weeks: Mapped[bool] = mapped_column(default=False)


class AcademicsCourse(Base, OwnedMixin, TimestampMixin):
    __tablename__ = "academics_courses"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    program_id: Mapped[str] = mapped_column(
        String, ForeignKey("academics_programs.id", ondelete="CASCADE"), index=True
    )
    code: Mapped[str | None] = mapped_column(String, default=None)
    title: Mapped[str] = mapped_column(String)
    alias: Mapped[str | None] = mapped_column(String, default=None)
    subject_code: Mapped[str] = mapped_column(String, default="")
    # {"palette": n} | {"hex": "#rrggbb"}; null uses the subject color.
    color: Mapped[dict[str, Any] | None] = mapped_column(JSON, default=None)
    credits: Mapped[float] = mapped_column(Float)
    include_in_gpa: Mapped[bool] = mapped_column(default=True)
    instructors: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    description: Mapped[str | None] = mapped_column(String, default=None)
    website_url: Mapped[str | None] = mapped_column(String, default=None)
    # How many consecutive terms the course is expected to span (year-long courses: 2).
    planned_terms: Mapped[int] = mapped_column(Integer, default=1)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class AcademicsCourseTerm(Base, OwnedMixin):
    """Which terms a course runs in: one for a half-year course, two or more for a year-long one."""

    __tablename__ = "academics_course_terms"

    course_id: Mapped[str] = mapped_column(
        String, ForeignKey("academics_courses.id", ondelete="CASCADE"), primary_key=True
    )
    term_id: Mapped[str] = mapped_column(
        String, ForeignKey("academics_terms.id", ondelete="CASCADE"), primary_key=True, index=True
    )
