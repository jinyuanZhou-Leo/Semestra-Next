from datetime import datetime

from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from semestra.core.db import Base, OwnedMixin, new_id


class PomodoroSession(Base, OwnedMixin):
    """One finished focus session of a pomodoro card (M14 §3), kept for statistics."""

    __tablename__ = "plugin_pomodoro_sessions"
    __table_args__ = (
        UniqueConstraint("instance_id", "started_at", name="uq_plugin_pomodoro_sessions_start"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    # Not removed with the card: the statistics outlive it. Removed by `plugins.purge`.
    instance_id: Mapped[str] = mapped_column(String)
    course_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("academics_courses.id", ondelete="SET NULL"), index=True, default=None
    )
    started_at: Mapped[datetime]
    ended_at: Mapped[datetime]
    # Time actually spent, without pauses.
    duration_sec: Mapped[int] = mapped_column(Integer)
    mode: Mapped[str] = mapped_column(String)
