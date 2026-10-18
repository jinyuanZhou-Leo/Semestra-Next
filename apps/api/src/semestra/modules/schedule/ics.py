"""ICS files for export and subscription feeds (M04 §4). Event titles are user data, so the file
needs no translation (M00 §3.11)."""

from collections.abc import Sequence
from datetime import datetime
from zoneinfo import ZoneInfo

from icalendar import Calendar
from icalendar import Event as VEvent

from semestra.modules.schedule.calendar import Occurrence

PRODID = "-//Semestra//Semestra-Next//EN"


def _summary(o: Occurrence) -> str:
    if o.kind == "class" and (o.meta.section_code or o.type_code):
        return f"{o.title} {o.meta.section_code or o.type_code}"
    return o.title


def build_calendar(name: str, timezone: str, items: Sequence[Occurrence], now: datetime) -> bytes:
    tz = ZoneInfo(timezone)
    cal = Calendar()
    cal.add("prodid", PRODID)
    cal.add("version", "2.0")
    cal.add("calscale", "GREGORIAN")
    cal.add("x-wr-calname", name)
    cal.add("x-wr-timezone", timezone)
    for o in items:
        ev = VEvent()
        ev.add("uid", f"{o.id}@semestra")
        ev.add("dtstamp", now)
        ev.add("summary", _summary(o))
        if o.all_day:
            ev.add("dtstart", o.start_at.astimezone(tz).date())
            if o.end_at is not None:
                ev.add("dtend", o.end_at.astimezone(tz).date())
        else:
            ev.add("dtstart", o.start_at)
            if o.end_at is not None and o.end_at > o.start_at:
                ev.add("dtend", o.end_at)
        if o.location:
            ev.add("location", o.location)
        details = [d for d in (o.meta.instructor, o.meta.note, o.meta.url) if d]
        if details:
            ev.add("description", "\n".join(details))
        if o.status == "cancelled":
            ev.add("status", "CANCELLED")
        if o.kind in ("deadline", "task"):
            ev.add("transp", "TRANSPARENT")
        cal.add_component(ev)
    return cal.to_ical()
