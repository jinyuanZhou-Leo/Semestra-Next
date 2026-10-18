"""Export/import adapters of the built-in plugins, in the shape of M13 §3.

M13 owns the framework (`register_portability`, the archive writer, the id map); the plugins
provide the four callbacks and `ADAPTERS` lists them with their module name and schema version.
M13 registers them when it lands. `writer` needs only `write_json(obj)`; `id_map` maps ids of
other modules in the archive (card instances, courses) to the ids they got on import.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Protocol

from pydantic import BaseModel
from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules.academics import service as academics
from semestra.modules.plugins_builtin.habit_streak import service as habit
from semestra.modules.plugins_builtin.habit_streak.models import HabitCheckin
from semestra.modules.plugins_builtin.pomodoro import service as pomodoro
from semestra.modules.plugins_builtin.pomodoro.models import PomodoroSession

SCHEMA_VERSION = 1


class Writer(Protocol):
    def write_json(self, obj: Any) -> None: ...


class CheckinRow(BaseModel):
    instance_id: str
    day: date


class SessionRow(BaseModel):
    instance_id: str
    course_id: str | None = None
    started_at: datetime
    ended_at: datetime
    duration_sec: int
    mode: str


class PluginsPayload(BaseModel):
    schema_version: int = SCHEMA_VERSION
    habit_checkins: list[CheckinRow] = []
    pomodoro_sessions: list[SessionRow] = []


@dataclass
class ImportReport:
    imported: dict[str, int]
    skipped: dict[str, int]


async def export(ctx: Ctx, writer: Writer) -> None:
    assert ctx.user_id
    checkins = await ctx.db.scalars(
        select(HabitCheckin)
        .where(HabitCheckin.user_id == ctx.user_id)
        .order_by(HabitCheckin.instance_id, HabitCheckin.day)
    )
    sessions = await ctx.db.scalars(
        select(PomodoroSession)
        .where(PomodoroSession.user_id == ctx.user_id)
        .order_by(PomodoroSession.started_at)
    )
    writer.write_json(
        PluginsPayload(
            habit_checkins=[CheckinRow(instance_id=c.instance_id, day=c.day) for c in checkins],
            pomodoro_sessions=[
                SessionRow(
                    instance_id=s.instance_id,
                    course_id=s.course_id,
                    started_at=s.started_at,
                    ended_at=s.ended_at,
                    duration_sec=s.duration_sec,
                    mode=s.mode,
                )
                for s in sessions
            ],
        ).model_dump(mode="json")
    )


async def import_(
    ctx: Ctx, payload: dict[str, Any], id_map: Mapping[str, str], options: Any = None
) -> ImportReport:
    """Writes the archive's rows; rows that already exist (same card and day / start) are kept."""
    del options
    assert ctx.user_id
    data = PluginsPayload.model_validate(payload)
    report = ImportReport({"habit_checkins": 0, "pomodoro_sessions": 0}, {})

    have_days = {
        (c.instance_id, c.day)
        for c in await ctx.db.scalars(
            select(HabitCheckin).where(HabitCheckin.user_id == ctx.user_id)
        )
    }
    for row in data.habit_checkins:
        instance_id = id_map.get(row.instance_id, row.instance_id)
        if (instance_id, row.day) in have_days:
            report.skipped["habit_checkins"] = report.skipped.get("habit_checkins", 0) + 1
            continue
        have_days.add((instance_id, row.day))
        ctx.db.add(HabitCheckin(user_id=ctx.user_id, instance_id=instance_id, day=row.day))
        report.imported["habit_checkins"] += 1

    have_starts = {
        (s.instance_id, s.started_at)
        for s in await ctx.db.scalars(
            select(PomodoroSession).where(PomodoroSession.user_id == ctx.user_id)
        )
    }
    for srow in data.pomodoro_sessions:
        instance_id = id_map.get(srow.instance_id, srow.instance_id)
        if (instance_id, srow.started_at) in have_starts:
            report.skipped["pomodoro_sessions"] = report.skipped.get("pomodoro_sessions", 0) + 1
            continue
        have_starts.add((instance_id, srow.started_at))
        ctx.db.add(
            PomodoroSession(
                user_id=ctx.user_id,
                instance_id=instance_id,
                course_id=await _course_id(ctx, srow.course_id, id_map),
                started_at=srow.started_at,
                ended_at=srow.ended_at,
                duration_sec=srow.duration_sec,
                mode=srow.mode,
            )
        )
        report.imported["pomodoro_sessions"] += 1
    await ctx.db.flush()
    return report


async def _course_id(ctx: Ctx, source: str | None, id_map: Mapping[str, str]) -> str | None:
    """The course a session belongs to after import: the mapped one, the same id if that course
    exists here, else none (a selective import may leave the course's Program out)."""
    if not source:
        return None
    if source in id_map:
        return id_map[source]
    try:
        await academics.get_course_row(ctx, source)
    except AppError:
        return None
    return source


async def preview(payload: dict[str, Any]) -> dict[str, int]:
    data = PluginsPayload.model_validate(payload)
    return {
        "habit_checkins": len(data.habit_checkins),
        "pomodoro_sessions": len(data.pomodoro_sessions),
    }


async def purge(ctx: Ctx) -> None:
    assert ctx.user_id
    await habit.purge(ctx, ctx.user_id)
    await pomodoro.purge(ctx, ctx.user_id)


# What M13 registers: `register_portability(module=..., **ADAPTER)`.
ADAPTER = {
    "module": "plugins_builtin",
    "schema_version": SCHEMA_VERSION,
    "depends_on": ("academics", "layouts"),
    "export": export,
    "import_": import_,
    "preview": preview,
    "purge": purge,
}
