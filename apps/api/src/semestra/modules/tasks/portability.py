"""M13 export/import adapter: task lists and tasks.

Version 2 links a task to its assessment by `assessment_id` (grading is imported first, so the
reference resolves); version 1 backups, which linked them through `source_kind='assessment'`, are
refused rather than converted (no compatibility before 2.0).
"""

from semestra.modules.portability import Table, table_adapter
from semestra.modules.tasks.models import TasksItem, TasksList

ADAPTER = table_adapter(
    module="tasks",
    schema_version=2,
    oldest_version=2,
    depends_on=("academics", "grading"),
    tables=(
        Table(TasksList, "lists", refs={"program_id": "required", "term_id": "optional"}),
        Table(
            TasksItem,
            "items",
            refs={
                "program_id": "required",
                "term_id": "optional",
                "course_id": "optional",
                "list_id": "optional",
                # When the assessment was not imported the task stays, as a plain one.
                "assessment_id": "optional",
            },
        ),
    ),
)
