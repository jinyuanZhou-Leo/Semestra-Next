"""M13 §3.1: a backup made by 1.15 (`backup_1_15/`, exported by v1.15.0 from the test dataset
plus rows whose format changed in 2.0) restores into the current version."""

import io
import json
import zipfile
from collections.abc import Awaitable, Callable
from datetime import UTC, date, datetime, time
from pathlib import Path

from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import select

from semestra.modules.grading.models import GradingAssessment
from semestra.modules.lms.models import LmsImportedRef
from semestra.modules.portability import registry
from semestra.modules.schedule.models import (
    ScheduleMeeting,
    ScheduleMeetingException,
    ScheduleSection,
)
from semestra.modules.settings.models import SettingsValue
from semestra.modules.tasks.models import TasksItem
from semestra.testing import MakeUser, UserHandle

LoginAs = Callable[[AsyncClient, UserHandle], Awaitable[str]]
RunJobs = Callable[[], Awaitable[None]]
FIXTURE = Path(__file__).parent / "backup_1_15"


def _archive() -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        for path in sorted(FIXTURE.rglob("*.json")):
            z.write(path, path.relative_to(FIXTURE).as_posix())
    return out.getvalue()


async def test_a_1_15_backup_restores(
    app: FastAPI, client: AsyncClient, make_user: MakeUser, login_as: LoginAs, run_jobs: RunJobs
) -> None:
    user = await make_user()
    await login_as(client, user)
    uploaded = await client.post(
        "/me/imports", files={"file": ("backup.zip", _archive(), "application/zip")}
    )
    assert uploaded.status_code == 200, uploaded.text
    counts = uploaded.json()["preview"]["counts"]
    # Counted after the conversion: three sections, and two tasks gained, one lost.
    assert counts["schedule"]["sections"] == 3
    assert counts["tasks"]["items"] == 5
    assert counts["lms"]["refs"] == 3

    started = await client.post(
        f"/me/imports/{uploaded.json()['id']}:start",
        json={"mode": "merge", "include_preferences": True},
    )
    assert started.status_code == 200, started.text
    await run_jobs()
    done = (await client.get(f"/me/imports/{uploaded.json()['id']}")).json()
    assert done["status"] == "imported", done
    assert done["report"]["skipped"] == {}

    async with app.state.session_factory() as db:
        assessments = {
            a.title: a.id
            for a in await db.scalars(
                select(GradingAssessment).where(GradingAssessment.user_id == user.id)
            )
        }
        tasks = {
            t.assessment_id: t
            for t in await db.scalars(
                select(TasksItem).where(
                    TasksItem.user_id == user.id, TasksItem.assessment_id.is_not(None)
                )
            )
        }
        # The linked task keeps its own title; dated assessments without one get one, finished
        # when past due; the task of an assessment without a due date is gone.
        assert set(tasks) == {
            assessments["Midterm"],
            assessments["Lab report"],
            assessments["Final project"],
        }
        assert tasks[assessments["Midterm"]].title == "Study for the midterm"
        lab = tasks[assessments["Lab report"]]
        assert (lab.title, lab.due_date, lab.due_time) == (
            "APS100 · Lab report",
            date(2025, 11, 3),
            time(23, 59),
        )
        assert lab.completed_at == datetime(2025, 11, 4, 4, 59, tzinfo=UTC)
        project = tasks[assessments["Final project"]]
        assert (project.due_date, project.due_time, project.completed_at) == (
            date(2026, 4, 10),
            None,
            None,
        )
        assert project.term_id is not None
        titles = set(await db.scalars(select(TasksItem.title).where(TasksItem.user_id == user.id)))
        assert "Participation" not in titles
        assert set(
            await db.scalars(
                select(TasksItem.source_kind).where(TasksItem.user_id == user.id).distinct()
            )
        ) == {"manual", "lms"}

        # Where the platform item was both an assessment and a to-do, the assessment's ref stays.
        refs = list(
            await db.execute(
                select(LmsImportedRef.external_id, LmsImportedRef.target_kind).where(
                    LmsImportedRef.user_id == user.id
                )
            )
        )
        assert sorted(tuple(r) for r in refs) == [
            ("9001", "assessment"),
            ("9002", "assessment"),
            ("9003", "task"),
        ]

        # No class moves: of a code's times in different weeks, the first (Monday) keeps the
        # code and the Wednesday one becomes a section of its own, titled with the code.
        sections = list(
            await db.scalars(select(ScheduleSection).where(ScheduleSection.user_id == user.id))
        )
        assert sorted(s.section_code for s in sections) == ["", "", "LEC0101"]
        by_meeting = {
            (m.weekday, m.start_time): (m, s)
            for m, s in await db.execute(
                select(ScheduleMeeting, ScheduleSection).join(ScheduleSection)
            )
            if s.user_id == user.id
        }
        mon, lec = by_meeting[(1, time(14))]
        assert (lec.section_code, lec.start_week, lec.end_week, lec.instructor) == (
            "LEC0101",
            2,
            None,
            None,
        )
        wed, other = by_meeting[(3, time(9))]
        assert (other.section_code, other.start_week, other.end_week, other.instructor) == (
            "",
            1,
            6,
            "Dr. Lee",
        )
        assert (mon.title, wed.title) == (None, "LEC0101")
        cancelled = await db.scalar(
            select(ScheduleMeeting.weekday)
            .join(ScheduleMeetingException)
            .where(
                ScheduleMeetingException.user_id == user.id,
                ScheduleMeetingException.original_date == date(2025, 9, 10),
            )
        )
        assert cancelled == 3

        task_settings = await db.scalar(
            select(SettingsValue.data).where(
                SettingsValue.user_id == user.id, SettingsValue.namespace == "tasks"
            )
        )
        assert task_settings == {"default_priority": "high"}

    # What it restored exports in the current format.
    started = await client.post("/me/exports", json={"include_files": False})
    assert started.status_code == 200, started.text
    await run_jobs()
    export = (await client.get("/me/exports")).json()["items"][0]
    archive = (await client.get(f"/me/exports/{export['id']}/download")).content
    with zipfile.ZipFile(io.BytesIO(archive)) as z:
        modules = json.loads(z.read("manifest.json"))["modules"]
    current = {a.module: a.schema_version for a in registry.adapters()}
    assert modules == {m: current[m] for m in modules}
