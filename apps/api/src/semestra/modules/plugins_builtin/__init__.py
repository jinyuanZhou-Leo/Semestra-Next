"""M14 built-in plugins: counter, habit streak, pomodoro, sticky note, world clock."""

from fastapi import FastAPI

from semestra.modules.plugins_builtin import (  # noqa: F401
    habit_streak,
    pomodoro,
    sticky_note,
)


def register(app: FastAPI) -> None:
    del app  # capabilities and subscribers register on import
