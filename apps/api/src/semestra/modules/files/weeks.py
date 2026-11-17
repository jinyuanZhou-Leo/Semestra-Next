"""The teaching week of each course file (M07 §3.4).

Only a week the user chose is stored (`week_source` = `user`; `week` null then means the whole
term). Every other item's week is worked out when it is read, by the rules in `week_rules.py`,
from what they read now: the course's files, its terms and timetable, and what another module
knows about where its files sit. So nothing has to follow term dates, timetables or renames.

Another module that keeps files in step with a source adds what it knows (an LMS module's name
and opening date) with `register_week_clues(<source_ref prefix>, fn)`.
"""

from collections.abc import Awaitable, Callable, Sequence
from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.events import events
from semestra.modules.academics import service as academics
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

USER = "user"
# The user put files of a course in other weeks (one event for a whole batch).
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
        TermWeek(w.start_date, w.end_date, w.number, index)
        for index, t in enumerate(terms)
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


async def _clues(ctx: Ctx, rows: Sequence[FilesItem]) -> dict[str, WeekClues]:
    clues = {r.id: WeekClues(title=r.display_name) for r in rows}
    for prefix, fn in _sources.items():
        mine = [r for r in rows if (r.source_ref or "").startswith(prefix)]
        if mine:
            clues.update(await fn(ctx, mine))
    return clues


async def _course_weeks(ctx: Ctx, course_id: str) -> dict[str, date | None]:
    """Every item's week in the course, by id: the user's, or what the rules say."""
    rows = list(
        await ctx.db.scalars(
            select(FilesItem).where(
                FilesItem.user_id == ctx.user_id, FilesItem.course_id == course_id
            )
        )
    )
    ruled = [r for r in rows if r.week_source != USER]
    clues = await _clues(ctx, ruled) if ruled else {}
    cal = await course_calendar(ctx, course_id, lectures=needs_lectures(clues))
    weeks = assign_weeks(clues, cal) if cal is not None and clues else {}
    for row in rows:
        if row.week_source == USER:
            # Kept as the first day of its week then; the week may start on another day now.
            weeks[row.id] = (cal.week_of(row.week) or row.week) if cal and row.week else row.week
    return weeks


async def weeks_of(ctx: Ctx, rows: Sequence[FilesItem]) -> dict[str, date | None]:
    """The week of each item (by id): the first day of its week, or None for the whole term."""
    out: dict[str, date | None] = {}
    for course_id in dict.fromkeys(r.course_id for r in rows):
        out.update(await _course_weeks(ctx, course_id))
    return {r.id: out.get(r.id) for r in rows}


async def set_week(ctx: Ctx, rows: Sequence[FilesItem], week: date | None) -> None:
    """The user puts files in a week (None: the whole term); the rules leave them there. The
    day is kept as the first day of its week."""
    calendars: dict[str, CourseCalendar | None] = {}
    for row in rows:
        if row.course_id not in calendars:
            calendars[row.course_id] = await course_calendar(ctx, row.course_id, lectures=False)
        cal = calendars[row.course_id]
        row.week = (cal.week_of(week) or week) if cal and week else week
        row.week_source, row.updated_at = USER, ctx.now
    await ctx.db.flush()
    for course_id in calendars:
        await events.publish(ctx, WEEKS_CHANGED, {"course_id": course_id})


async def keep_current(ctx: Ctx, rows: Sequence[FilesItem]) -> None:
    """Fixes the items' weeks as they are now: what the rules read about them is going away
    (the LMS course they came from is unlinked)."""
    weeks = await weeks_of(ctx, [r for r in rows if r.week_source != USER])
    for row in rows:
        if row.id in weeks:
            row.week, row.week_source = weeks[row.id], USER
    await ctx.db.flush()


async def preview_set_week(
    ctx: Ctx, rows: Sequence[FilesItem], week: date | None
) -> dict[str, Any]:
    """The assistant's confirmation card: which files, and their week before and after, each as
    its dates (null: the whole term), which the card shows in the user's language."""
    names = sorted((r.display_name for r in rows), key=str.lower)
    target = ", ".join(names[:3]) + (" …" if len(names) > 3 else "")
    current = await weeks_of(ctx, rows)
    before = sorted({current[r.id] for r in rows}, key=lambda d: (d is not None, d or date.min))
    shown = [_dates(d) for d in before]
    cal = await course_calendar(ctx, rows[0].course_id, lectures=False) if rows else None
    after = (cal.week_of(week) or week) if cal and week else week
    return {
        "target": target,
        "changes": [
            {
                "field": "week",
                "before": shown[0] if len(shown) == 1 else shown,
                "after": _dates(after),
            }
        ],
    }


def _dates(week: date | None) -> dict[str, str] | None:
    """A week as the card shows it: its first and last day (None: the whole term)."""
    if week is None:
        return None
    return {"start_date": week.isoformat(), "end_date": (week + timedelta(days=6)).isoformat()}
