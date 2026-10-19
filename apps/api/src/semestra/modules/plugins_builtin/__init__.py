"""First-party plugins: the M14 set (counter, habit streak, pomodoro, sticky note, world clock)
and the M16 Canvas tab."""

from fastapi import FastAPI

from semestra.modules.plugins import PluginInfo, register_plugin
from semestra.modules.plugins_builtin import (  # noqa: F401  (registers on import)
    counter,
    habit_streak,
    pomodoro,
    sticky_note,
    world_clock,
)

# Ids match the frontend manifests. Counter and world clock have no tables or capabilities: their
# data lives in the card settings, so their packages only validate those settings.
PLUGINS = (
    PluginInfo(
        id="counter",
        default_installed=False,
        summary="A counter card with a range, a step and an optional progress ring.",
    ),
    PluginInfo(
        id="habit-streak",
        name_key="habit_name",
        description_key="habit_description",
        default_installed=True,
        summary="Daily or weekly habit check-ins with streaks.",
    ),
    PluginInfo(
        id="pomodoro",
        default_installed=True,
        summary="A focus timer that records finished focus sessions for statistics.",
    ),
    PluginInfo(
        id="sticky-note",
        name_key="sticky_name",
        description_key="sticky_description",
        default_installed=True,
        summary="Markdown sticky notes on a Program, term or course.",
    ),
    PluginInfo(
        id="world-clock",
        default_installed=False,
        summary="The time and date in up to three time zones.",
    ),
    # M16: frontend only, it reads everything through the core `lms.*` capabilities (M09).
    PluginInfo(
        id="canvas-tab",
        default_installed=False,
        summary="Browse a linked Canvas course: announcements, assignments, modules, pages.",
    ),
)
for _info in PLUGINS:
    register_plugin(_info)


def register(app: FastAPI) -> None:
    del app  # capabilities and subscribers register on import
