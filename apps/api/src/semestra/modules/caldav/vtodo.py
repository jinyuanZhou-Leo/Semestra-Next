"""Tasks as iCalendar VTODOs and back (RFC 5545). Pure: no database access.

A client's own text is kept (`CaldavItem.ical`) and sent back with only the properties Semestra
owns rewritten, so what Semestra cannot store (extra alerts, X-APPLE-*) survives a round trip.
Semestra owns the title, notes, due date and time, priority and completion, plus the one alert at
the due time; everything else is left as the client wrote it. Tasks do not repeat: a repeat rule
is dropped, so completing the task ends it on every device.
"""

from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from icalendar import Alarm, Calendar, Todo

PRODID = "-//Semestra//Semestra//EN"
# Properties written from the task; the rest of a client's VTODO is kept.
OWNED = (
    "SUMMARY",
    "DESCRIPTION",
    "DUE",
    "DTSTART",
    "PRIORITY",
    "STATUS",
    "COMPLETED",
    "PERCENT-COMPLETE",
    "DTSTAMP",
    "LAST-MODIFIED",
)
# Repeat rules. Semestra has no repeating tasks; keeping a rule would let the device advance the
# due date on completion while Semestra sees an open task forever.
REPEAT = ("RRULE", "RDATE", "EXDATE")
TITLE_MAX = 300
NOTES_MAX = 20_000

# iCalendar priority: 1-4 high, 5 medium, 6-9 low, 0 or missing none (RFC 5545 §3.8.1.9).
# Apple Reminders writes 1, 5 and 9.
_OUT = {"urgent": 1, "high": 1, "medium": 5, "low": 9, "none": 0}


class InvalidTodo(ValueError):
    """The body is not one VTODO this server can store."""


@dataclass(frozen=True)
class TaskState:
    """What a task looks like to the conversion: the fields of `TasksItem` that a VTODO has."""

    title: str
    notes: str
    due_date: date | None
    due_time: time | None
    priority: str
    completed_at: datetime | None
    updated_at: datetime
    created_at: datetime


@dataclass(frozen=True)
class TodoFields:
    uid: str
    title: str
    notes: str
    due_date: date | None
    due_time: time | None
    # One of high/medium/low/none: the client cannot tell high from urgent (`priority_in`).
    priority: str
    completed: bool


def priority_class(value: int) -> str:
    if 1 <= value <= 4:
        return "high"
    if value == 5:
        return "medium"
    if 6 <= value <= 9:
        return "low"
    return "none"


def priority_in(incoming: str, current: str) -> str:
    """Keeps `urgent` while the client still shows it as high (it has no fourth level)."""
    return current if priority_class(_OUT.get(current, 0)) == incoming else incoming


def _due_moment(due_date: date, due_time: time, zone: ZoneInfo) -> datetime:
    return datetime.combine(due_date, due_time, zone).astimezone(UTC)


def _is_due_alarm(alarm: Any, due: datetime | None) -> bool:
    """The alert at the due time, which Semestra writes itself (absolute, or 0 before the due)."""
    trigger = alarm.get("TRIGGER")
    if trigger is None:
        return False
    value = trigger.dt
    if isinstance(value, timedelta):
        return value == timedelta(0)
    return due is not None and isinstance(value, datetime) and value == due


def parse(body: bytes, zone: ZoneInfo) -> tuple[TodoFields, str]:
    """The task fields of one VTODO and the calendar text to keep. Times are converted to the
    Program's time zone; a floating time is taken to be in it."""
    try:
        calendar = Calendar.from_ical(body)
    except Exception as e:
        raise InvalidTodo(str(e)) from e
    if not isinstance(calendar, Calendar):
        raise InvalidTodo("not a calendar")
    todos = [c for c in calendar.subcomponents if isinstance(c, Todo)]
    others = [c for c in calendar.subcomponents if c.name not in ("VTODO", "VTIMEZONE")]
    if len(todos) != 1 or others:
        raise InvalidTodo("expected exactly one VTODO")
    todo = todos[0]
    uid = str(todo.get("UID") or "").strip()
    if not uid:
        raise InvalidTodo("missing UID")
    due_date, due_time = _due_in(todo, zone)
    status = str(todo.get("STATUS") or "").upper()
    completed = status == "COMPLETED" or "COMPLETED" in todo
    if status in ("NEEDS-ACTION", "IN-PROCESS"):
        completed = False
    title = " ".join(str(todo.get("SUMMARY") or "").split())[:TITLE_MAX]
    notes = str(todo.get("DESCRIPTION") or "")[:NOTES_MAX]
    try:
        priority = priority_class(int(todo.get("PRIORITY") or 0))
    except TypeError, ValueError:
        priority = "none"
    fields = TodoFields(
        uid=uid,
        title=title,
        notes=notes,
        due_date=due_date,
        due_time=due_time,
        priority=priority,
        completed=completed,
    )
    due = _due_moment(due_date, due_time, zone) if due_date and due_time else None
    todo.subcomponents = [
        c for c in todo.subcomponents if not (isinstance(c, Alarm) and _is_due_alarm(c, due))
    ]
    for name in (*OWNED, *REPEAT):
        todo.pop(name, None)
    return fields, calendar.to_ical().decode()


def _due_in(todo: Todo, zone: ZoneInfo) -> tuple[date | None, time | None]:
    if "DUE" not in todo:
        return None, None
    value = todo.decoded("DUE")
    if isinstance(value, datetime):
        local = value.astimezone(zone) if value.tzinfo else value
        return local.date(), local.time().replace(second=0, microsecond=0, tzinfo=None)
    if isinstance(value, date):
        return value, None
    return None, None


def render(task: TaskState, uid: str, kept: str | None, zone: ZoneInfo) -> bytes:
    """The VTODO of a task: the client's kept text with Semestra's properties written over it,
    or a new one. Stamped with the task's last change, so the same task gives the same bytes."""
    calendar: Calendar | None = None
    if kept:
        try:
            calendar = Calendar.from_ical(kept)
        except Exception:
            calendar = None
    todo = None
    if isinstance(calendar, Calendar):
        todo = next((c for c in calendar.subcomponents if isinstance(c, Todo)), None)
    if calendar is None or todo is None:
        calendar = Calendar()
        calendar.add("PRODID", PRODID)
        calendar.add("VERSION", "2.0")
        todo = Todo()
        todo.add("UID", uid)
        todo.add("CREATED", task.created_at.astimezone(UTC))
        calendar.add_component(todo)
    todo.add("DTSTAMP", task.updated_at.astimezone(UTC))
    todo.add("LAST-MODIFIED", task.updated_at.astimezone(UTC))
    todo.add("SUMMARY", task.title)
    if task.notes:
        todo.add("DESCRIPTION", task.notes)
    if task.due_date is not None:
        if task.due_time is not None:
            due = _due_moment(task.due_date, task.due_time, zone)
            todo.add("DUE", due)
            alarm = Alarm()
            alarm.add("ACTION", "DISPLAY")
            alarm.add("DESCRIPTION", task.title)
            alarm.add("TRIGGER", due, parameters={"VALUE": "DATE-TIME"})
            todo.subcomponents.insert(0, alarm)
        else:
            todo.add("DUE", task.due_date)
    priority = _OUT.get(task.priority, 0)
    if priority:
        todo.add("PRIORITY", priority)
    if task.completed_at is not None:
        todo.add("STATUS", "COMPLETED")
        todo.add("COMPLETED", task.completed_at.astimezone(UTC))
        todo.add("PERCENT-COMPLETE", 100)
    else:
        todo.add("STATUS", "NEEDS-ACTION")
    return calendar.to_ical()
