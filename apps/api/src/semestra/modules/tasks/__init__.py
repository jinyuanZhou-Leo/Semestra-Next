"""M05 待办: task lists and tasks per Program, smart lists, tasks generated from assessments."""

from fastapi import FastAPI

from semestra.modules.settings import register_settings
from semestra.modules.tasks import (  # noqa: F401  (registers)
    calendar,
    capabilities,
    models,
    portability,
    subscribers,
)
from semestra.modules.tasks.settings import TasksSettings

register_settings(namespace="tasks", schema=TasksSettings, levels=("program",))


def register(app: FastAPI) -> None:
    del app  # capabilities are mounted by the core
