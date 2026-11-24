"""The platform's calendar events of linked courses (M09 §4.8): lectures, office hours, exam
sittings. Assignments are not among them: their due dates reach the calendar through the task or
assessment they are imported as.

The course sync's `calendar` stage reads all of a course's events, of any date, and keeps them in
`lms_calendar_events`, following the platform's edits and deletions; the `lms.events` calendar
source reads the stored rows only, so the calendar shows them without asking the platform. How
the list read is noted in `area_reads["calendar"]` (表 3c). Courses with sync off are left out.
The events get no reminders: those come from the timetable and the to-dos.
"""

from datetime import date, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, select

from semestra.core.context import Ctx
from semestra.core.events import events
from semestra.modules.academics import service as academics
from semestra.modules.academics.schemas import Course
from semestra.modules.lms import html, service
from semestra.modules.lms.models import LmsCalendarEvent, LmsCourseLink
from semestra.modules.lms.rules import presence
from semestra.modules.lms.schemas.dto import LmsCalendarEvent as CalendarEvent
from semestra.modules.lms.service import Bound
from semestra.modules.lms.sync import StageResult, hold, one_item, register_sync_stage
from semestra.modules.lms.sync_round import SyncRound
from semestra.modules.schedule.calendar import (
    Occurrence,
    OccurrenceMeta,
    OccurrenceQuery,
    OccurrenceRef,
    calendar_source,
)
from semestra.modules.schedule.rules import local_midnight

SOURCE = "lms.events"
AREA = "calendar"
KIND = "calendar_event"
# An all-day event's day starts at midnight in the Program's time zone, up to a day away from
# the platform's `start_at`: the query reaches that much further, then each is checked.
_DAY = timedelta(days=1)


# --- the sync stage -------------------------------------------------------------------------


async def stage(ctx: Ctx, link: LmsCourseLink, b: Bound, this_round: SyncRound) -> StageResult:
    if "calendar" not in b.provider.features:
        this_round.unsupported(AREA)
        await hold(ctx, link)
        await this_round.save(ctx, link)
        return StageResult()
    ext = link.external_course_id
    read = await this_round.area(
        ctx,
        link,
        b,
        AREA,
        lambda: service.call(
            ctx, b, lambda i: b.provider.calendar_events(i, b.cfg, b.creds, [ext])
        ),
        truncated=lambda got: got[1],
    )
    found = read[0] if read is not None else []
    await hold(ctx, link)
    rows = {
        r.external_id: r
        for r in await ctx.db.scalars(
            select(LmsCalendarEvent).where(LmsCalendarEvent.link_id == link.id)
        )
    }
    result = StageResult()
    changed = False
    seen: set[str] = set()
    for e in found:
        if not e.external_id or e.external_course_id != ext or e.external_id in seen:
            continue
        seen.add(e.external_id)
        async with one_item(ctx, link, result, KIND, e.external_id, e.title) as item:
            wrote = _write(ctx, link, b, e, rows.get(e.external_id))
        changed |= item.ok and wrote
    # Gone from the platform: the one rule (表 3c). Events are only ever in this list and never
    # read on their own, so only a list read whole says so.
    areas = this_round.results([AREA])
    for external_id, row in rows.items():
        listed = external_id in seen
        if presence(listed=listed, areas=areas, now=ctx.now) != "gone":
            continue
        async with one_item(ctx, link, result, KIND, external_id, row.title) as item:
            await ctx.db.delete(row)
            await ctx.db.flush()
        changed |= item.ok
    await this_round.save(ctx, link)
    if changed:
        await events.publish(ctx, "calendar.changed", {"program_id": link.program_id})
    return result


def _write(
    ctx: Ctx, link: LmsCourseLink, b: Bound, e: CalendarEvent, row: LmsCalendarEvent | None
) -> bool:
    """Keeps one listed event as the platform has it; whether anything changed."""
    values = {
        "title": e.title,
        "html": b.clean(e.html, e.web_url, link.external_course_id),
        "location": e.location,
        "web_url": e.web_url,
        "start_at": e.start_at,
        "end_at": e.end_at,
        "all_day": e.all_day,
        "all_day_date": e.all_day_date if e.all_day else None,
    }
    if row is None:
        ctx.db.add(
            LmsCalendarEvent(
                user_id=ctx.user_id, link_id=link.id, external_id=e.external_id, **values
            )
        )
        return True
    changed = False
    for name, value in values.items():
        if getattr(row, name) != value:
            setattr(row, name, value)
            changed = True
    return changed


register_sync_stage("calendar", stage, order=50, parts=(AREA,))


# --- the calendar source --------------------------------------------------------------------


@calendar_source(SOURCE, kinds=("event",))
async def lms_events(ctx: Ctx, q: OccurrenceQuery) -> list[Occurrence]:
    links = {
        li.id: li
        for li in await service.program_links(ctx, q.program_id)
        if li.sync_enabled and q.wants_course(li.course_id)
    }
    if not links:
        return []
    rows = list(
        await ctx.db.scalars(
            select(LmsCalendarEvent).where(
                LmsCalendarEvent.link_id.in_(links),
                LmsCalendarEvent.start_at < q.range_end + _DAY,
                func.coalesce(LmsCalendarEvent.end_at, LmsCalendarEvent.start_at)
                >= q.range_start - _DAY,
            )
        )
    )
    if not rows:
        return []
    program = await academics.get_program_row(ctx, q.program_id)
    course_rows = await academics.courses_by_id(ctx, list({li.course_id for li in links.values()}))
    courses = {c.id: c for c in await academics.courses_out(ctx, program, course_rows)}
    zone = ZoneInfo(program.timezone)
    out: list[Occurrence] = []
    for row in rows:
        link = links[row.link_id]
        course = courses.get(link.course_id)
        if course is None or (q.term_id is not None and q.term_id not in course.term_ids):
            continue
        occurrence = _occurrence(row, link, course, zone)
        if _overlaps(occurrence, q):
            out.append(occurrence)
    return out


def _overlaps(o: Occurrence, q: OccurrenceQuery) -> bool:
    """In the range when it overlaps it: one that began before and is still on (across a week's
    start, a multi-day one) is in it too (§4.8)."""
    if o.start_at >= q.range_end:
        return False
    if o.end_at is None:
        return o.start_at >= q.range_start
    return o.end_at > q.range_start


def _occurrence(
    row: LmsCalendarEvent, link: LmsCourseLink, course: Course, zone: ZoneInfo
) -> Occurrence:
    start, end = row.start_at, row.end_at
    if row.all_day and row.all_day_date is not None:
        # The platform's day, at midnight in the Program's time zone (as every all-day item).
        first: date = row.all_day_date
        start, end = local_midnight(first, zone), local_midnight(first + _DAY, zone)
    if end is not None and end <= start:
        end = None
    return Occurrence(
        id=f"{SOURCE}:{link.id}:{row.external_id}",
        source=SOURCE,
        kind="event",
        title=f"{course.alias or course.code or course.title} · {row.title}",
        start_at=start,
        end_at=end,
        all_day=row.all_day,
        course_id=link.course_id,
        location=row.location,
        color_ref=course.resolved_color,
        ref=OccurrenceRef(entity="lms.calendar_event", id=row.external_id),
        meta=OccurrenceMeta(note=html.to_text(row.html), url=row.web_url),
    )
