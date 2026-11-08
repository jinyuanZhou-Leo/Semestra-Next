from datetime import date, datetime, time
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints
from pydantic.json_schema import SkipJsonSchema

from semestra.modules.schedule.calendar import Occurrence, OccurrenceKind

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
FeedSource = Literal["schedule", "tasks", "lms"]


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
    imported: bool = Field(description="Written by an import (a repeated import may remove it)")


class Meeting(BaseModel):
    id: str
    section_id: str
    weekday: int = Field(description="1 = Monday .. 7 = Sunday")
    start_time: time = Field(description="Wall-clock time in the Program's time zone")
    end_time: time
    location: str | None
    title: str | None = Field(description="Optional name of this time, e.g. 'Lab'")
    enabled: bool = Field(description="Shown in the calendar")
    source_kind: str | None
    source_ref: str | None
    exceptions: list[MeetingException] = Field(description="Cancelled or moved dates")
    created_at: datetime
    updated_at: datetime


class Section(BaseModel):
    """A class section with its weekly times; all of them run in the section's weeks."""

    id: str
    course_id: str
    term_id: str
    type_code: str
    section_code: str = Field(description="e.g. 'LEC0101'; empty when the source has none")
    instructor: str | None
    recurrence: Recurrence
    anchor_week: int = Field(description="Biweekly: the term week it starts alternating from")
    start_week: int
    end_week: int | None = Field(description="Last term week; null = until the end of term")
    skip_breaks: bool
    meetings: list[Meeting] = Field(description="Weekly times, by weekday and start time")
    created_at: datetime
    updated_at: datetime


class SectionList(BaseModel):
    items: list[Section] = Field(description="By term, type and section code")


class SectionListInput(BaseModel):
    course_id: Id = Field(description="Course id")
    term_id: Id | None = Field(default=None, description="Only this term's sections")


class TermSectionListInput(BaseModel):
    term_id: Id = Field(description="Term id")


SectionCode = Annotated[str, StringConstraints(strip_whitespace=True, max_length=32)]


class SectionWeeks(BaseModel):
    recurrence: Recurrence = Field(default="weekly", description="Every week or every other week")
    anchor_week: WeekNumber | None = Field(
        default=None, description="Biweekly: first week it happens; defaults to start_week"
    )
    start_week: WeekNumber = Field(default=1, description="First term week")
    end_week: WeekNumber | None = Field(
        default=None, description="Last term week; null = until the end of term"
    )
    skip_breaks: bool = Field(default=True, description="No class in break weeks and on breaks")


class SectionFields(BaseModel):
    term_id: Id = Field(description="Term of the course the section runs in")
    type_code: TypeCode = Field(description="Event type code of the Program, e.g. 'LEC'")
    section_code: SectionCode = Field(default="", description="Section, e.g. 'LEC0101'")
    instructor: ShortText | None = Field(default=None, description="Instructor")


class MeetingTime(BaseModel):
    weekday: Weekday = Field(description="1 = Monday .. 7 = Sunday")
    start_time: time = Field(description="Start, wall-clock time in the Program's time zone")
    end_time: time = Field(description="End, after the start")
    location: ShortText | None = Field(default=None, description="Room or building")


class NewMeeting(MeetingTime):
    title: ShortText | None = Field(default=None, description="Optional name of this time")
    enabled: bool = Field(default=True, description="False hides it from the calendar")
    source_kind: Annotated[str, Field(max_length=32)] | None = Field(
        default=None, description="Importer that created it, e.g. 'ics'"
    )
    source_ref: Annotated[str, Field(max_length=500)] | None = Field(
        default=None, description="Id of the time in the import source, for de-duplication"
    )


class NewSection(SectionFields):
    weeks: SectionWeeks | None = Field(
        default=None,
        description="Weeks of all its times; null keeps an existing section's, and a new one "
        "runs every week of the term",
    )
    meetings: list[NewMeeting] = Field(
        min_length=1, max_length=20, description="Its weekly times, e.g. Monday and Wednesday"
    )


class SectionCreateManyInput(BaseModel):
    """A section whose code the course already has in that term gets the times (and the sent
    fields) when its weeks are the sent ones or none are sent; times sent with other weeks
    become a section of their own without the code (it becomes their title), unless they and
    the call's other times of that code in the same weeks are all of that section's times. A
    time with the same source_kind+source_ref as one of the course's updates it."""

    course_id: Id = Field(description="Course id")
    sections: list[NewSection] = Field(min_length=1, max_length=50, description="Sections")


class SectionCreateManyResult(BaseModel):
    items: list[Section] = Field(description="The sections written, with all their times")
    created_ids: list[str] = Field(description="Meetings added")
    updated_ids: list[str] = Field(description="Meetings that existed and were updated")


class SectionUpdateInput(BaseModel):
    """Only the fields that are sent change; the weeks apply to every time of the section."""

    section_id: Id = Field(description="Section id")
    term_id: Id | None = Field(default=None, description="Another term of the course")
    type_code: TypeCode | None = Field(default=None, description="Event type code")
    section_code: SectionCode | None = Field(default=None, description="Section code")
    instructor: ShortText | None = Field(default=None, description="Instructor, or null")
    recurrence: Recurrence | None = Field(default=None, description="weekly or biweekly")
    anchor_week: WeekNumber | None = Field(
        default=None, description="Biweekly anchor week; null = the first week"
    )
    start_week: WeekNumber | None = Field(default=None, description="First term week")
    end_week: WeekNumber | None = Field(default=None, description="Last term week, or null")
    skip_breaks: bool | None = Field(default=None, description="Skip breaks")


class SectionRef(BaseModel):
    section_id: Id = Field(description="Section id")


class SectionTime(MeetingTime):
    meeting_id: Id | None = Field(
        default=None, description="The meeting this time edits; null adds a new one"
    )


class SectionSaveInput(SectionFields):
    """The app's section editor: the section with all its times in one change. Times with a
    meeting_id update it, the others are added, and the section's meetings left out go. A code
    another section already has fails, or with `merge` joins that section."""

    course_id: Id = Field(description="Course id")
    section_id: Id | None = Field(default=None, description="The section edited; null adds one")
    weeks: SectionWeeks = Field(default_factory=SectionWeeks, description="Weeks of all times")
    times: list[SectionTime] = Field(min_length=1, max_length=20, description="Its weekly times")
    merge: bool = Field(
        default=False,
        description="When another section of the course has the code in the term: move the times "
        "into it (they take its weeks) and delete this section, instead of failing with "
        "schedule.section_exists",
    )


class MeetingCreateInput(MeetingTime):
    section_id: Id = Field(description="Section the time belongs to")
    title: ShortText | None = Field(default=None, description="Optional name of this time")
    enabled: bool = Field(default=True, description="False hides it from the calendar")


class MeetingUpdateInput(BaseModel):
    """Only the fields that are sent change; the weeks are the section's."""

    meeting_id: Id = Field(description="Meeting id")
    weekday: Weekday | None = Field(default=None, description="1 = Monday .. 7 = Sunday")
    start_time: time | None = Field(default=None, description="Start time")
    end_time: time | None = Field(default=None, description="End time")
    location: ShortText | None = Field(default=None, description="Location, or null")
    title: ShortText | None = Field(default=None, description="Title, or null")
    enabled: bool | None = Field(default=None, description="Shown in the calendar")


class MeetingRef(BaseModel):
    meeting_id: Id = Field(description="Meeting id")


class MeetingList(BaseModel):
    items: list[Meeting]


class MeetingSetEnabledInput(BaseModel):
    course_id: Id = Field(description="Course id")
    meeting_ids: list[Id] = Field(min_length=1, max_length=200, description="Meetings to change")
    enabled: bool = Field(description="True to show them, false to hide them")
    other_meeting_ids: list[Id] = Field(
        default_factory=list,
        max_length=200,
        description="Meetings set to the opposite state in the same change, e.g. the other "
        "sections when keeping only one",
    )


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
    # Only the import commit sets it (not in the schema the assistant, MCP or clients see; ignored
    # from them too): an imported change never replaces the user's own one.
    imported: SkipJsonSchema[bool] = Field(default=False, description="Written by an import")


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


class EventFields(BaseModel):
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


class EventCreateInput(EventFields):
    program_id: Id = Field(description="Program id")


class EventCreateManyInput(BaseModel):
    program_id: Id = Field(description="Program id")
    events: list[EventFields] = Field(
        min_length=1, max_length=100, description="Events; same source_kind+source_ref updates"
    )


class EventCreateManyResult(BaseModel):
    items: list[OneOffEvent]
    created_ids: list[str]
    updated_ids: list[str]


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
    end: date = Field(description="Day after the last day (exclusive); at most 400 days later")
    sources: list[SourceName] | None = Field(
        default=None,
        description="Sources to include, e.g. ['schedule.meetings', 'tasks.due']; all by default",
    )
    term_id: Id | None = Field(default=None, description="Only this term")
    course_ids: list[Id] | None = Field(default=None, description="Only these courses")
    kinds: list[OccurrenceKind] | None = Field(
        default=None,
        description="Only these kinds: class, event, task; all by default",
    )


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
    upcoming: list[Occurrence] = Field(description="Tasks due in the next 7 days")
    tasks: list[Occurrence] = Field(description="Tasks due today and overdue ones")


# --- feeds ----------------------------------------------------------------------------------


class Feed(BaseModel):
    id: str
    program_id: str
    prefix: str = Field(description="First characters of the token")
    url: str | None = Field(
        description="Subscription URL; anyone with it can read the calendar. None for a link "
        "that cannot be shown again (made by an older version): reset gives a new one"
    )
    sources: list[FeedSource]
    created_at: datetime
    last_fetched_at: datetime | None
    revoked_at: datetime | None


class FeedState(BaseModel):
    feed: Feed | None = Field(description="The Program's link; None while it is off")


class FeedCreateInput(BaseModel):
    program_id: Id = Field(description="Program id")
    sources: list[FeedSource] = Field(
        default_factory=lambda: ["schedule", "tasks"],
        min_length=1,
        description="What the feed contains",
    )


class FeedUpdateInput(BaseModel):
    feed_id: Id = Field(description="Feed id")
    sources: list[FeedSource] = Field(min_length=1, description="What the feed contains")


class FeedRef(BaseModel):
    feed_id: Id = Field(description="Feed id")
