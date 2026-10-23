"""Names of tasks and task lists for the assistant's chat (`core.labels`)."""

from semestra.core.labels import owned_names, resolver
from semestra.modules.tasks.models import TasksItem, TasksList

task = owned_names(TasksItem, lambda row: row.title)
resolver("task")(task)
resolver("before_task")(task)
resolver("list", module="tasks")(owned_names(TasksList, lambda row: row.name))
