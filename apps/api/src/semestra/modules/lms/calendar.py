"""The `lms.events` calendar source (M09 §4, §6): the platform's calendar events of linked
courses (lectures, office hours, exam sittings). Assignments are not among them: their due dates
reach the calendar through the task or assessment they are imported as.

Read live (through the 5-minute cache), one provider call per connection for all its courses.
Courses with sync off are left out. An unreachable LMS leaves its events out instead of failing
the calendar.
"""

from datetime import timedelta
from typing import Any

import structlog

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules.academics import service as academics
from semestra.modules.lms import cache, html, service
from semestra.modules.schedule.calendar import (
    Occurrence,
    OccurrenceMeta,
    OccurrenceQuery,
    OccurrenceRef,
    calendar_source,
)

log = structlog.get_logger()
SOURCE = "lms.events"


@calendar_source(SOURCE, kinds=("event",))
async def lms_events(ctx: Ctx, q: OccurrenceQuery) -> list[Occurrence]:
    links = [
        li
        for li in await service.program_links(ctx, q.program_id)
        if li.sync_enabled and q.wants_course(li.course_id)
    ]
    if not links:
        return []
    program = await academics.get_program_row(ctx, q.program_id)
    rows = await academics.courses_by_id(ctx, [li.course_id for li in links])
    courses = {c.id: c for c in await academics.courses_out(ctx, program, rows)}
    links = [li for li in links if li.course_id in courses]
    if not links:
        return []
    if q.term_id is not None:
        links = [li for li in links if q.term_id in courses[li.course_id].term_ids]
    by_connection: dict[str, list[Any]] = {}
    for link in links:
        by_connection.setdefault(link.connection_id, []).append(link)

    out: list[Occurrence] = []
    for connection_id, group in by_connection.items():
        try:
            b = await service.bound(ctx, await service.get_connection_row(ctx, connection_id))
            if "calendar" not in b.provider.features:
                continue
            ids = sorted(li.external_course_id for li in group)
            # Whole days around the range, so the cache key does not change with every scroll.
            start = q.range_start.replace(hour=0, minute=0, second=0, microsecond=0)
            end = q.range_end.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
            data, _ = await service.cached(
                ctx,
                b,
                "calendar_events",
                {"courses": ids, "start": start.isoformat(), "end": end.isoformat()},
                lambda i, b=b, ids=ids, start=start, end=end: b.provider.calendar_events(
                    i, b.cfg, b.creds, ids, start, end
                ),
                scope=cache.CALENDAR_SCOPE,
            )
        except AppError as exc:
            log.info("lms_calendar_unavailable", connection_id=connection_id, code=exc.code)
            continue
        by_external = {li.external_course_id: li for li in group}
        for e in data:
            link = by_external.get(e["external_course_id"])
            if link is None:
                continue
            occurrence = _occurrence(e, link, courses[link.course_id])
            if q.range_start <= occurrence.start_at < q.range_end:
                out.append(occurrence)
    return out


def _occurrence(e: dict[str, Any], link: Any, course: Any) -> Occurrence:
    occ = Occurrence.model_validate(
        {
            "id": f"{SOURCE}:{link.id}:{e['external_id']}",
            "source": SOURCE,
            "kind": "event",
            "title": f"{course.alias or course.code or course.title} · {e['title']}",
            "start_at": e["start_at"],
            "end_at": e.get("end_at"),
            "all_day": bool(e.get("all_day")),
            "course_id": link.course_id,
            "location": e.get("location"),
            "color_ref": course.resolved_color,
            "ref": OccurrenceRef(entity="lms.calendar_event", id=e["external_id"]),
            "meta": OccurrenceMeta(note=html.to_text(e.get("html")), url=e.get("web_url")),
        }
    )
    if occ.end_at is not None and occ.end_at <= occ.start_at:
        occ.end_at = None
    return occ
