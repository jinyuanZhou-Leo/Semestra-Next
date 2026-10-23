from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column

from semestra.core.db import Base, OwnedMixin, TimestampMixin, new_id


class GradingScale(Base, OwnedMixin, TimestampMixin):
    """A Program's percentage → grade point table and its grading defaults (M03 §2)."""

    __tablename__ = "grading_scales"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    program_id: Mapped[str] = mapped_column(String, unique=True)
    # [{min, max, points, letter?}], validated by the service.
    bands: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    max_points: Mapped[float] = mapped_column(Float, default=4.0)
    year_course_attribution: Mapped[str] = mapped_column(String, default="end_term")
    default_forecast_model: Mapped[str] = mapped_column(String, default="auto")
    # [{key, name, color}] copied into every new course.
    default_categories: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    hide_gpa: Mapped[bool] = mapped_column(Boolean, default=False)
    # Percentages are rounded to whole numbers before the band lookup (84.6 reads as 85).
    round_before_lookup: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())


class GradingCourseResult(Base, OwnedMixin, TimestampMixin):
    """How one course is graded; created with the course (or on first use)."""

    __tablename__ = "grading_course_results"

    course_id: Mapped[str] = mapped_column(String, primary_key=True)
    basis: Mapped[str] = mapped_column(String, default="percentage")
    manual_percentage: Mapped[float | None] = mapped_column(Float, default=None)
    final_override_percentage: Mapped[float | None] = mapped_column(Float, default=None)
    pass_fail_result: Mapped[str | None] = mapped_column(String, default=None)
    target_points: Mapped[float | None] = mapped_column(Float, default=None)
    forecast_model: Mapped[str] = mapped_column(String, default="auto")
    gradebook_enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class GradingCategory(Base, OwnedMixin):
    __tablename__ = "grading_categories"
    __table_args__ = (UniqueConstraint("course_id", "key", name="uq_grading_categories_key"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    course_id: Mapped[str] = mapped_column(String, index=True)
    key: Mapped[str] = mapped_column(String)
    name: Mapped[str] = mapped_column(String)
    # A color name from the built-in set or "#rrggbb".
    color: Mapped[str] = mapped_column(String)
    position: Mapped[int] = mapped_column(Integer, default=0)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)


class GradingAssessment(Base, OwnedMixin, TimestampMixin):
    __tablename__ = "grading_assessments"
    __table_args__ = (
        UniqueConstraint(
            "course_id", "source_kind", "source_ref", name="uq_grading_assessments_source"
        ),
        Index("ix_grading_assessments_user_due", "user_id", "due_at"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    course_id: Mapped[str] = mapped_column(String, index=True)
    category_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("grading_categories.id", ondelete="SET NULL"), default=None
    )
    title: Mapped[str] = mapped_column(String)
    due_at: Mapped[datetime | None] = mapped_column(default=None)
    due_has_time: Mapped[bool] = mapped_column(Boolean, default=False)
    weight: Mapped[float] = mapped_column(Float, default=0.0)
    score_percentage: Mapped[float | None] = mapped_column(Float, default=None)
    points_earned: Mapped[float | None] = mapped_column(Float, default=None)
    points_possible: Mapped[float | None] = mapped_column(Float, default=None)
    dropped: Mapped[bool] = mapped_column(Boolean, default=False)
    note: Mapped[str | None] = mapped_column(String, default=None)
    source_kind: Mapped[str | None] = mapped_column(String, default=None)
    source_ref: Mapped[str | None] = mapped_column(String, default=None)
    position: Mapped[int] = mapped_column(Integer, default=0)
