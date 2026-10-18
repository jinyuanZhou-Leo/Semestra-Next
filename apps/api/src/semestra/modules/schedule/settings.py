"""The `calendar` settings namespace (M04 §5.2, M11): calendar display defaults."""

from typing import Literal

from pydantic import BaseModel, Field, model_validator


class CalendarSettings(BaseModel):
    default_view: Literal["week", "month", "list", "timetable"] = Field(
        default="week", description="View the term calendar opens with"
    )
    day_start: str = Field(
        default="08:00",
        pattern=r"^([01]\d|2[0-3]):[0-5]\d$",
        json_schema_extra={"format": "time"},
        description="First hour shown",
    )
    day_end: str = Field(
        default="22:00",
        pattern=r"^(([01]\d|2[0-3]):[0-5]\d|24:00)$",
        json_schema_extra={"format": "time"},
        description="Last hour shown",
    )
    show_weekends: bool = Field(default=True, description="Show Saturday and Sunday")
    min_column_width: int = Field(
        default=0, ge=0, le=400, description="Minimum width of a day column in pixels; 0 = fit"
    )
    cancelled_display: Literal["strike", "hide"] = Field(
        default="strike", description="How cancelled classes are shown"
    )

    @model_validator(mode="after")
    def _hours_increase(self) -> CalendarSettings:
        if self.day_end <= self.day_start:
            raise ValueError("day_end must be later than day_start")
        return self
