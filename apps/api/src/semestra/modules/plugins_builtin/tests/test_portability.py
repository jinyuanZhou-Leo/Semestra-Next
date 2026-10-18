"""Export, import and purge of the plugins' data (M13 §3 adapter shape)."""

from datetime import UTC, date, datetime
from typing import Any

from fastapi import FastAPI
from sqlalchemy import func, select

from semestra.core.context import Ctx, system_ctx
from semestra.modules.plugins_builtin import portability
from semestra.modules.plugins_builtin.habit_streak.models import HabitCheckin
from semestra.modules.plugins_builtin.pomodoro.models import PomodoroSession
from semestra.testing import MakeUser


class Capture:
    def __init__(self) -> None:
        self.objects: list[Any] = []

    def write_json(self, obj: Any) -> None:
        self.objects.append(obj)


async def test_export_import_purge_round_trip(make_user: MakeUser, app: FastAPI) -> None:
    user = await make_user()
    async with system_ctx(app.state, user.id) as ctx:
        await _round_trip(ctx, user.id)


async def _round_trip(ctx: Ctx, user_id: str) -> None:
    db = ctx.db
    start = datetime(2026, 1, 15, 14, 0, tzinfo=UTC)
    db.add_all(
        [
            HabitCheckin(user_id=user_id, instance_id="old-1", day=date(2026, 1, 14)),
            HabitCheckin(user_id=user_id, instance_id="old-1", day=date(2026, 1, 15)),
            PomodoroSession(
                user_id=user_id,
                instance_id="old-2",
                started_at=start,
                ended_at=start.replace(minute=25),
                duration_sec=1500,
                mode="focus",
            ),
        ]
    )
    await db.flush()

    out = Capture()
    await portability.export(ctx, out)
    payload = out.objects[0]
    assert await portability.preview(payload) == {"habit_checkins": 2, "pomodoro_sessions": 1}

    await portability.purge(ctx)
    for table in (HabitCheckin, PomodoroSession):
        assert await db.scalar(select(func.count()).select_from(table)) == 0

    report = await portability.import_(ctx, payload, {"old-1": "new-1"})
    assert report.imported == {"habit_checkins": 2, "pomodoro_sessions": 1}
    days = set(await db.scalars(select(HabitCheckin.instance_id)))
    assert days == {"new-1"}

    # Importing again changes nothing.
    again = await portability.import_(ctx, payload, {"old-1": "new-1"})
    assert again.imported == {"habit_checkins": 0, "pomodoro_sessions": 0}
    assert again.skipped == {"habit_checkins": 2, "pomodoro_sessions": 1}
