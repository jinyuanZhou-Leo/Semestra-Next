"""The `tasks` settings namespace (M05 §5.4, M11): Program-level defaults."""

from pydantic import BaseModel, Field

from semestra.modules.tasks.schemas import Priority


class TasksSettings(BaseModel):
    auto_tasks_from_assessments: bool = Field(
        default=False,
        description="Create a task for every assessment with a due date and keep it in sync",
    )
    default_priority: Priority = Field(
        default="none", description="Priority of tasks created without one"
    )
    show_completed_in_lists: bool = Field(
        default=False, description="Keep completed tasks visible in lists and smart lists"
    )
