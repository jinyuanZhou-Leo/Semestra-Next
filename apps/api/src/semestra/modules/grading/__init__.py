"""M03 成绩与 GPA: gradebook, grading scale, forecasts and term / Program GPA."""

from fastapi import FastAPI

from semestra.core.capability import registry
from semestra.modules.grading import (  # noqa: F401  (registers on import)
    capabilities,
    labels,
    models,
    portability,
    settings,
    subscribers,
)
from semestra.modules.settings import register_settings

register_settings(namespace="grading", schema=settings.GradingSettings, levels=("program",))


def register(app: FastAPI) -> None:
    del app  # capabilities are mounted by the core; subscribers register on import
    registry.set_id_source("assessment_id", "grading.assessment.find")
    registry.set_id_source("category_id", "grading.gradebook.get")
