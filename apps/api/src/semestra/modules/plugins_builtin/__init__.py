"""M14 built-in plugins: counter, habit streak, pomodoro, sticky note, world clock."""

from fastapi import FastAPI

from semestra.modules.plugins_builtin import habit_streak, pomodoro  # noqa: F401


def register(app: FastAPI) -> None:
    del app  # capabilities and subscribers register on import
