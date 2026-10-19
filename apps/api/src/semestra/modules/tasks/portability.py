"""M13 export/import adapter: task lists and tasks.

`source_ref` of a task made from an assessment holds the assessment id, which the table adapter
remaps like any other id in the backup, so grading is imported first.
"""

from semestra.modules.portability import Table, table_adapter
from semestra.modules.tasks.models import TasksItem, TasksList

ADAPTER = table_adapter(
    module="tasks",
    schema_version=1,
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
            },
        ),
    ),
)
