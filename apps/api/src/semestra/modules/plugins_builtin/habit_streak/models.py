from datetime import date

from sqlalchemy import Date, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from semestra.core.db import Base, OwnedMixin, TimestampMixin, new_id


class HabitCheckin(Base, OwnedMixin, TimestampMixin):
    """One checked day of one habit card (M14 §2). `day` is the date in the Program's zone."""

    __tablename__ = "plugin_habit_checkins"
    __table_args__ = (UniqueConstraint("instance_id", "day", name="uq_plugin_habit_checkins_day"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    # The M10 card instance; deleted together with the card (`layouts.card.deleted`).
    instance_id: Mapped[str] = mapped_column(String, index=True)
    day: Mapped[date] = mapped_column(Date)
