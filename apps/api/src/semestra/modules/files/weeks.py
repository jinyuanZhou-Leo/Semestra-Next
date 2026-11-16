"""The teaching week of each course file (M07 §3.4): the rules' answer kept on the item, or the
user's.

Rule weeks (`week_source` = `rule`) are worked out again whenever what the rules read changes:
the course's files (`subscribers.py`, on `files.item.*`), its terms and timetable
(`calendar.changed`, which schedule also publishes for term dates and breaks), and what another
module knows of its files (`assign` after an LMS sync). A week the user set (`user`) is never
touched again.

Another module that keeps files in step with a source adds what it knows about where they sit
(an LMS module's name and opening date) with `register_week_clues(<source_ref prefix>, fn)`.
"""

from collections.abc import Awaitable, Callable, Iterable, Sequence
from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.events import events
from semestra.modules.academics import service as academics
from semestra.modules.academics.models import AcademicsCourse
from semestra.modules.files.models import FilesItem
from semestra.modules.files.week_rules import (
    CourseCalendar,
    TermWeek,
    WeekClues,
    needs_lectures,
)
from semestra.modules.files.week_rules import (
    assign as assign_weeks,
)
from semestra.modules.schedule.calendar import OccurrenceQuery, collect

RULE = "rule"
USER = "user"
WEEKS_CHANGED = "files.weeks.changed"
LECTURE = "LEC"

# What a source knows of its files, by item id: the clues beyond the file's own name.
ClueSource = Callable[[Ctx, Sequence[FilesItem]], Awaitable[dict[str, WeekClues]]]
_sources: dict[str, ClueSource] = {}


def register_week_clues(prefix: str, fn: ClueSource) -> None:
    """Clues for the items whose `source_ref` starts with `prefix` (e.g. "lms:")."""
    _sources[prefix] = fn


async def course_calendar(ctx: Ctx, course_id: str, *, lectures: bool) -> CourseCalendar | None:
    """The weeks of the course's terms (None: it has none), with its lecture days if asked."""
    terms = await academics.course_terms(ctx, course_id)
    if not terms:
        return None
    weeks = [
        TermWeek(w.start_date, w.end_date, w.number)
        for t in terms
        for w in await academics.weeks_of(ctx, t)
    ]
    first, last = terms[0].start_date, terms[-1].end_date
    days: list[date] = []
    if lectures:
        days = await _lecture_days(ctx, course_id, first, last)
    return CourseCalendar(weeks, first, last, days)


async def _lecture_days(ctx: Ctx, course_id: str, first: date, last: date) -> list[date]:
    """The days of the course's lectures in its timetable, in order (cancelled ones left out)."""
    course = await academics.get_course_row(ctx, course_id)
    program = await academics.get_program_row(ctx, course.program_id)
    tz = ZoneInfo(program.timezone)
    query = OccurrenceQuery(
        program_id=program.id,
        range_start=datetime.combine(first, time(), tz).astimezone(UTC),
        range_end=datetime.combine(last + timedelta(days=1), time(), tz).astimezone(UTC),
        course_ids=frozenset((course_id,)),
    )
    found = await collect(ctx, query, wanted=("schedule.meetings",), kinds=("class",))
    starts = sorted(
        {o.start_at for o in found if o.type_code == LECTURE and o.status != "cancelled"}
    )
    return [s.astimezone(tz).date() for s in starts]


def week_start(day: date | None, cal: CourseCalendar | None) -> date | None:
    """`day` as the first day of its week of the course (the user's week start may have changed
    since it was kept)."""
    if day is None or cal is None:
        return day
    return cal.week_of(day) or day


async def _clues(ctx: Ctx, rows: Sequence[FilesItem]) -> dict[str, WeekClues]:
    clues = {r.id: WeekClues(title=r.display_name) for r in rows}
    for prefix, fn in _sources.items():
        mine = [r for r in rows if (r.source_ref or "").startswith(prefix)]
        if mine:
            clues.update(await fn(ctx, mine))
    return clues


async def assign(ctx: Ctx, course_ids: Iterable[str]) -> None:
    """Works out the rule weeks of the courses' files again and keeps the ones that changed."""
    for course_id in dict.fromkeys(course_ids):
        rows = list(
            await ctx.db.scalars(
                select(FilesItem).where(
                    FilesItem.user_id == ctx.user_id,
                    FilesItem.course_id == course_id,
                    FilesItem.week_source == RULE,
                )
            )
        )
        if not rows:
            continue
        clues = await _clues(ctx, rows)
        cal = await course_calendar(ctx, course_id, lectures=needs_lectures(clues))
        weeks = assign_weeks(clues, cal) if cal is not None else {}
        changed = False
        for row in rows:
            week = weeks.get(row.id)
            if row.week != week:
                row.week, changed = week, True
        if changed:
            await ctx.db.flush()
            await events.publish(ctx, WEEKS_CHANGED, {"course_id": course_id})


async def set_week(ctx: Ctx, rows: Sequence[FilesItem], week: date | None) -> None:
    """The user puts files in a week (None: the whole term); the rules leave them there. The
    day is kept as the first day of its week."""
    by_course: dict[str, CourseCalendar | None] = {}
    for row in rows:
        if row.course_id not in by_course:
            by_course[row.course_id] = await course_calendar(ctx, row.course_id, lectures=False)
        row.week, row.week_source = week_start(week, by_course[row.course_id]), USER
    await ctx.db.flush()
    for course_id in by_course:
        await events.publish(ctx, WEEKS_CHANGED, {"course_id": course_id})


async def assign_program(ctx: Ctx, program_id: str) -> None:
    """`assign` for every course of the Program that has rule weeks."""
    course_ids = await ctx.db.scalars(
        select(FilesItem.course_id)
        .join(AcademicsCourse, AcademicsCourse.id == FilesItem.course_id)
        .where(
            FilesItem.user_id == ctx.user_id,
            FilesItem.week_source == RULE,
            AcademicsCourse.program_id == program_id,
        )
        .distinct()
    )
    await assign(ctx, list(course_ids))


async def preview_set_week(
    ctx: Ctx, rows: Sequence[FilesItem], week: date | None
) -> dict[str, Any]:
    """The assistant's confirmation card: which files, and their week before and after."""
    names = sorted((r.display_name for r in rows), key=str.lower)
    target = ", ".join(names[:3]) + (" …" if len(names) > 3 else "")
    before = sorted({r.week.isoformat() if r.week else "term" for r in rows})
    after = week.isoformat() if week else "term"
    return {
        "target": target,
        "changes": [{"field": "week", "before": ", ".join(before), "after": after}],
    }
