"""Helpers shared by the schedule services (M04)."""

from dataclasses import dataclass
from datetime import date
from typing import Any
from zoneinfo import ZoneInfo

from semestra.core.context import Ctx
from semestra.core.events import events
from semestra.modules.academics import service as academics
from semestra.modules.academics.models import AcademicsProgram, AcademicsTerm
from semestra.modules.academics.rules import BreakSpan, Week
from semestra.modules.academics.schemas import Course, CourseListInput

MAX_RANGE_DAYS = 120


EXPORT_MAX_RANGE_DAYS = 400


UPCOMING_DAYS = 7


def columns(row: Any) -> dict[str, Any]:
    return {c.key: getattr(row, c.key) for c in row.__table__.columns}


async def announce(ctx: Ctx, program_id: str, event_type: str, data: dict[str, Any]) -> None:
    """Every schedule write announces itself and that the Program's calendar changed."""
    await events.publish(ctx, event_type, {**data, "program_id": program_id})
    await events.publish(ctx, "calendar.changed", {"program_id": program_id})


def program_tz(program: AcademicsProgram) -> ZoneInfo:
    return ZoneInfo(program.timezone)


async def program_courses(ctx: Ctx, program_id: str) -> dict[str, Course]:
    courses: dict[str, Course] = {}
    cursor: str | None = None
    while True:
        page = await academics.list_courses(
            ctx, CourseListInput(program_id=program_id, cursor=cursor, limit=500)
        )
        courses.update((c.id, c) for c in page.items)
        if page.next_cursor is None:
            return courses
        cursor = page.next_cursor


async def program_course_ids(ctx: Ctx, program_id: str) -> list[str]:
    return list(await program_courses(ctx, program_id))


def course_label(course: Course) -> str:
    return course.alias or course.code or course.title


@dataclass
class TermInfo:
    term: AcademicsTerm
    weeks: list[Week]
    breaks: list[BreakSpan]


async def term_info(ctx: Ctx, term: AcademicsTerm) -> TermInfo:
    weeks = await academics.weeks_of(ctx, term)
    breaks = [
        BreakSpan(
            b["id"],
            b["name"],
            date.fromisoformat(b["start_date"]),
            date.fromisoformat(b["end_date"]),
        )
        for b in term.breaks
    ]
    return TermInfo(term, weeks, breaks)
