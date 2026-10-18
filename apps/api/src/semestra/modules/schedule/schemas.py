from datetime import date, datetime, time
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints

from semestra.modules.schedule.calendar import Occurrence

Id = Annotated[str, Field(min_length=1, max_length=64)]
ShortText = Annotated[str, Field(max_length=200)]
Note = Annotated[str, Field(max_length=2000)]
TypeCode = Annotated[
    str, StringConstraints(strip_whitespace=True, to_upper=True, pattern=r"^[A-Za-z0-9]{1,8}$")
]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
ColorValue = Annotated[str, Field(pattern=r"^(subject-(1[0-2]|[1-9])|#[0-9a-fA-F]{6})$")]
IconName = Annotated[str, Field(pattern=r"^[a-z0-9-]{1,48}$")]
Weekday = Annotated[int, Field(ge=1, le=7)]
WeekNumber = Annotated[int, Field(ge=1, le=60)]
Recurrence = Literal["weekly", "biweekly"]
SourceName = Annotated[str, Field(min_length=1, max_length=64)]
FeedSource = Literal["schedule", "assessments", "tasks", "lms"]


class Deleted(BaseModel):
    deleted: Literal[True] = True


# --- event types ----------------------------------------------------------------------------


class EventType(BaseModel):
    id: str
    program_id: str
    code: str = Field(description="Upper-case abbreviation, e.g. 'LEC'")
    name: str = Field(description="Display name; built-in types are translated by the app")
    color: str | None
    icon: str | None
    builtin: bool
    position: int


class EventTypeList(BaseModel):
    items: list[EventType] = Field(description="In display order")


class ProgramRef(BaseModel):
    program_id: Id = Field(description="Program id")


class EventTypeCreateInput(BaseModel):
    program_id: Id = Field(description="Program id")
    code: TypeCode = Field(description="Abbreviation, letters and digits, e.g. 'LAB'")
    name: Name = Field(description="Display name, e.g. 'Laboratory'")
    color: ColorValue | None = Field(default=None, description="'subject-<1..12>' or '#rrggbb'")
    icon: IconName | None = Field(
        default=None, description="lucide icon name, e.g. 'flask-conical'"
    )


class EventTypeUpdateInput(BaseModel):
    event_type_id: Id = Field(description="Event type id")
    name: Name | None = Field(default=None, description="Display name (not for built-in types)")
    color: ColorValue | None = Field(default=None, description="Color, or null for none")
    icon: IconName | None = Field(default=None, description="Icon name, or null for none")


class EventTypeRef(BaseModel):
    event_type_id: Id = Field(description="Event type id")


class EventTypeOrderInput(BaseModel):
    program_id: Id = Field(description="Program id")
    event_type_ids: list[Id] = Field(max_length=100, description="Types in display order")


# --- meetings -------------------------------------------------------------------------------


class MeetingException(BaseModel):
    id: str
    meeting_id: str
    original_date: date
    kind: Literal["cancelled", "moved"]
    new_date: date | None
    new_start_time: time | None
    new_end_time: time | None
    new_location: str | None
    note: str | None


class Meeting(BaseModel):
    id: str
    course_id: str
    term_id: str
    section_code: str
    type_code: str
    title: str | None
    instructor: str | None
    location: str | None
    weekday: int = Field(description="1 = Monday .. 7 = Sunday")
    start_time: time = Field(description="Wall-clock time in the Program's time zone")
    end_time: time
    recurrence: Recurrence
    anchor_week: int = Field(description="Biweekly: the term week it starts alternating from")
    start_week: int
    end_week: int | None = Field(description="Last term week; null = until the end of term")
    skip_breaks: bool
    enabled: bool
    source_kind: str | None
    source_ref: str | None
    exceptions: list[MeetingException] = Field(description="Cancelled or moved dates")
    created_at: datetime
    updated_at: datetime


class MeetingList(BaseModel):
    items: list[Meeting] = Field(description="By term, weekday and start time")


class MeetingListInput(BaseModel):
    course_id: Id = Field(description="Course id")
    term_id: Id | None = Field(default=None, description="Only this term's meetings")


class MeetingFields(BaseModel):
    term_id: Id = Field(description="Term of the course the meeting runs in")
    section_code: Annotated[str, Field(max_length=32)] = Field(
        default="", description="Section, e.g. 'LEC0101'"
    )
    type_code: TypeCode = Field(description="Event type code of the Program, e.g. 'LEC'")
    title: ShortText | None = Field(default=None, description="Optional title")
    instructor: ShortText | None = Field(default=None, description="Instructor")
    location: ShortText | None = Field(default=None, description="Room or building")
    weekday: Weekday = Field(description="1 = Monday .. 7 = Sunday")
    start_time: time = Field(description="Start, wall-clock time in the Program's time zone")
    end_time: time = Field(description="End, after the start")
    recurrence: Recurrence = Field(default="weekly", description="Every week or every other week")
    anchor_week: WeekNumber | None = Field(
        default=None, description="Biweekly: first week it happens; defaults to start_week"
    )
    start_week: WeekNumber = Field(default=1, description="First term week")
    end_week: WeekNumber | None = Field(
        default=None, description="Last term week; null = until the end of term"
    )
    skip_breaks: bool = Field(default=True, description="No class in break weeks and on breaks")
    enabled: bool = Field(default=True, description="Disabled sections are not shown")
    source_kind: Annotated[str, Field(max_length=32)] | None = Field(
        default=None, description="Importer that created it, e.g. 'ics'"
    )
    source_ref: Annotated[str, Field(max_length=500)] | None = Field(
        default=None, description="Id of the item in the import source, for de-duplication"
    )


class MeetingCreateInput(MeetingFields):
    course_id: Id = Field(description="Course id")


class MeetingCreateManyInput(BaseModel):
    course_id: Id = Field(description="Course id")
    meetings: list[MeetingFields] = Field(
        min_length=1, max_length=100, description="Meetings; same source_kind+source_ref updates"
    )


class MeetingCreateManyResult(BaseModel):
    items: list[Meeting]
    created_ids: list[str]
    updated_ids: list[str]


class MeetingUpdateInput(BaseModel):
    """Only the fields that are sent change."""

    meeting_id: Id = Field(description="Meeting id")
    term_id: Id | None = Field(default=None, description="Another term of the course")
    section_code: Annotated[str, Field(max_length=32)] | None = Field(
        default=None, description="Section"
    )
    type_code: TypeCode | None = Field(default=None, description="Event type code")
    title: ShortText | None = Field(default=None, description="Title, or null")
    instructor: ShortText | None = Field(default=None, description="Instructor, or null")
    location: ShortText | None = Field(default=None, description="Location, or null")
    weekday: Weekday | None = Field(default=None, description="1 = Monday .. 7 = Sunday")
    start_time: time | None = Field(default=None, description="Start time")
    end_time: time | None = Field(default=None, description="End time")
    recurrence: Recurrence | None = Field(default=None, description="weekly or biweekly")
    anchor_week: WeekNumber | None = Field(
        default=None, description="Biweekly anchor week; null = the first week"
    )
    start_week: WeekNumber | None = Field(default=None, description="First term week")
    end_week: WeekNumber | None = Field(default=None, description="Last term week, or null")
    skip_breaks: bool | None = Field(default=None, description="Skip breaks")
    enabled: bool | None = Field(default=None, description="Shown in the calendar")


class MeetingRef(BaseModel):
    meeting_id: Id = Field(description="Meeting id")


class MeetingSetEnabledInput(BaseModel):
    course_id: Id = Field(description="Course id")
    meeting_ids: list[Id] = Field(min_length=1, max_length=200, description="Meetings to change")
    enabled: bool = Field(description="True to show them, false to hide them")


class ExceptionUpsertInput(BaseModel):
    meeting_id: Id = Field(description="Meeting id")
    original_date: date = Field(description="The regular date of the class to change")
    kind: Literal["cancelled", "moved"] = Field(description="Cancel it, or move it")
    new_date: date | None = Field(default=None, description="Moved: new date (default: same day)")
    new_start_time: time | None = Field(default=None, description="Moved: new start time")
    new_end_time: time | None = Field(default=None, description="Moved: new end time")
    new_location: ShortText | None = Field(
        default=None, description='Moved: new location; null keeps the meeting\'s, "" means none'
    )
    note: Note | None = Field(default=None, description="Note shown with the class")


class ExceptionRef(BaseModel):
    meeting_id: Id = Field(description="Meeting id")
    original_date: date = Field(description="Regular date of the changed class")


class ConflictPair(BaseModel):
    meeting_id: str
    other_meeting_id: str
    weekday: int
    dates: list[date] = Field(description="Dates on which both happen")


class ConflictList(BaseModel):
    items: list[ConflictPair]


class TermRef(BaseModel):
    term_id: Id = Field(description="Term id")


# --- one-off events -------------------------------------------------------------------------


class OneOffEvent(BaseModel):
    id: str
    program_id: str
    term_id: str | None
    course_id: str | None
    type_code: str | None
    title: str
    start_at: datetime
    end_at: datetime
    all_day: bool
    location: str | None
    note: str | None
    source_kind: str | None
    source_ref: str | None
    created_at: datetime
    updated_at: datetime


class OneOffEventList(BaseModel):
    items: list[OneOffEvent] = Field(description="By start time")


class EventListInput(BaseModel):
    program_id: Id = Field(description="Program id")
    course_id: Id | None = Field(default=None, description="Only this course's events")
    term_id: Id | None = Field(default=None, description="Only this term's events")


class EventCreateInput(BaseModel):
    program_id: Id = Field(description="Program id")
    title: Name = Field(description="E.g. 'Midterm'")
    start_at: datetime = Field(
        description="Start; without an offset it is read in the Program's time zone"
    )
    end_at: datetime = Field(description="End (not before the start)")
    all_day: bool = Field(default=False, description="Whole days; times are ignored")
    course_id: Id | None = Field(default=None, description="Course it belongs to")
    term_id: Id | None = Field(default=None, description="Term it belongs to")
    type_code: TypeCode | None = Field(default=None, description="Event type code, e.g. 'TUT'")
    location: ShortText | None = Field(default=None, description="Location")
    note: Note | None = Field(default=None, description="Note")
    source_kind: Annotated[str, Field(max_length=32)] | None = Field(
        default=None, description="Importer that created it"
    )
    source_ref: Annotated[str, Field(max_length=500)] | None = Field(
        default=None, description="Id in the import source"
    )


class EventUpdateInput(BaseModel):
    event_id: Id = Field(description="Event id")
    title: Name | None = Field(default=None, description="Title")
    start_at: datetime | None = Field(default=None, description="Start")
    end_at: datetime | None = Field(default=None, description="End")
    all_day: bool | None = Field(default=None, description="Whole days")
    course_id: Id | None = Field(default=None, description="Course, or null")
    term_id: Id | None = Field(default=None, description="Term, or null")
    type_code: TypeCode | None = Field(default=None, description="Event type code, or null")
    location: ShortText | None = Field(default=None, description="Location, or null")
    note: Note | None = Field(default=None, description="Note, or null")


class EventRef(BaseModel):
    event_id: Id = Field(description="Event id")


# --- calendar -------------------------------------------------------------------------------


class OccurrencesInput(BaseModel):
    program_id: Id = Field(description="Program id")
    start: date = Field(description="First day, in the Program's time zone")
    end: date = Field(description="Day after the last day (exclusive); at most 120 days later")
    sources: list[SourceName] | None = Field(
        default=None,
        description="Sources to include, e.g. ['schedule.meetings', 'grading.assessments']; "
        "all by default",
    )
    term_id: Id | None = Field(default=None, description="Only this term")
    course_ids: list[Id] | None = Field(default=None, description="Only these courses")


class CalendarWeek(BaseModel):
    term_id: str
    start_date: date
    end_date: date
    number: int | None = Field(description="Term week number; null for an uncounted break week")
    break_name: str | None = Field(description="Break of a break week")


class CalendarBreak(BaseModel):
    term_id: str
    name: str
    start_date: date
    end_date: date


class Occurrences(BaseModel):
    timezone: str = Field(description="The Program's time zone, for reading the local times")
    start: date
    end: date
    items: list[Occurrence] = Field(description="Sorted by start")
    weeks: list[CalendarWeek] = Field(description="Term weeks touching the range")
    breaks: list[CalendarBreak] = Field(description="Breaks touching the range")


class TodayWeek(BaseModel):
    term_id: str
    term_name: str
    number: int | None
    break_name: str | None


class Today(BaseModel):
    day: date = Field(description="Today in the Program's time zone")
    timezone: str
    week: TodayWeek | None = Field(description="The current term's week, if in a term")
    items: list[Occurrence] = Field(description="Today's classes and events")
    upcoming: list[Occurrence] = Field(description="Deadlines and due tasks in the next 7 days")
    tasks: list[Occurrence] = Field(description="Tasks due today and overdue ones")


# --- feeds ----------------------------------------------------------------------------------


class Feed(BaseModel):
    id: str
    program_id: str
    name: str
    prefix: str = Field(description="First characters of the token, to tell links apart")
    sources: list[FeedSource]
    created_at: datetime
    last_fetched_at: datetime | None
    revoked_at: datetime | None


class FeedList(BaseModel):
    items: list[Feed]


class FeedCreateInput(BaseModel):
    program_id: Id = Field(description="Program id")
    name: Name = Field(description="Label for the link, e.g. 'iPhone'")
    sources: list[FeedSource] = Field(
        default_factory=lambda: ["schedule", "assessments", "tasks", "lms"],
        min_length=1,
        description="What the feed contains",
    )


class FeedCreated(BaseModel):
    feed: Feed
    url: str = Field(description="Subscription URL; shown once, anyone with it can read the feed")


class FeedRef(BaseModel):
    feed_id: Id = Field(description="Feed id")
