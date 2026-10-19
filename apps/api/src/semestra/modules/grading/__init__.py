"""M03 成绩与 GPA: gradebook, grading scale, forecasts and term / Program GPA."""

from fastapi import FastAPI

from semestra.modules.grading import (  # noqa: F401  (registers on import)
    calendar,
    capabilities,
    models,
    portability,
    subscribers,
)


def register(app: FastAPI) -> None:
    del app  # capabilities are mounted by the core; subscribers register on import
