"""The `tasks` settings namespace (M05 §5.4, M11): Program-level defaults."""

from typing import Literal

from pydantic import BaseModel, Field, field_validator

# The levels the app offers (M05 §5.1). Tasks can still be `urgent` through the API, but the
# default is one of these four; a stored `urgent` from before reads as `high`.
DefaultPriority = Literal["none", "low", "medium", "high"]


class TasksSettings(BaseModel):
    auto_tasks_from_assessments: bool = Field(
        default=False,
        description="Create a task for every assessment with a due date and keep it in sync",
    )
    default_priority: DefaultPriority = Field(
        default="none", description="Priority of tasks created without one"
    )
    show_completed_in_lists: bool = Field(
        default=False, description="Keep completed tasks visible in lists and smart lists"
    )

    @field_validator("default_priority", mode="before")
    @classmethod
    def _urgent_is_high(cls, value: object) -> object:
        return "high" if value == "urgent" else value
