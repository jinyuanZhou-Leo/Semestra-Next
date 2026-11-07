"""The `notifications` settings namespace (M18 §5, M11): what to be notified about.

They follow the account to every device; whether a device receives anything is the device's own
choice (its push subscription), made in Settings → Notifications → This device."""

from typing import Literal

from pydantic import BaseModel, Field

_TIME = r"^([01]\d|2[0-3]):[0-5]\d$"


class NotificationsSettings(BaseModel):
    # Reminders: minutes before the start (classes, events) or due time (to-dos); "off" = none.
    # The labels and options say enough, so these fields carry no description.
    class_reminder: Literal["off", "0", "5", "10", "15", "30"] = "10"
    event_reminder: Literal["off", "0", "15", "30", "60", "1440"] = "30"
    task_reminder: Literal["off", "0", "15", "60", "180", "1440"] = "60"
    # Hour (local time of the active Program) of the summary of today's classes and to-dos.
    daily_digest: Literal["off", "6", "7", "8", "9", "10"] = "8"
    jobs: bool = Field(
        default=True, description="Imports ready to review, finished or failed background tasks"
    )
    assistant: bool = Field(default=True, description="Sem waits for an approval")
    sign_in: bool = Field(default=True, description="A new sign-in to this account")
    quiet_hours: bool = Field(default=False, description="Hold back notifications at night")
    quiet_start: str = Field(default="23:00", pattern=_TIME, json_schema_extra={"format": "time"})
    quiet_end: str = Field(default="07:00", pattern=_TIME, json_schema_extra={"format": "time"})
