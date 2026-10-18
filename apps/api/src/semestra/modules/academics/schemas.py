from datetime import date, datetime
from typing import Annotated, Literal
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError, available_timezones

from pydantic import AfterValidator, BaseModel, Field, JsonValue, StringConstraints

PALETTE_SIZE = 12

# Trimmed before the length check, so a name of only spaces is rejected.
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
ShortText = Annotated[str, Field(max_length=200)]
Credits = Annotated[float, Field(ge=0, le=100)]
CreditGoal = Annotated[float, Field(ge=0, le=10_000)]
Id = Annotated[str, Field(min_length=1, max_length=64)]


def _check_timezone(value: str) -> str:
    if value in available_timezones():
        return value
    try:
        ZoneInfo(value)  # aliases such as "UTC" are loadable without being listed
    except ValueError, ZoneInfoNotFoundError:
        raise ValueError("unknown time zone") from None
    return value


Timezone = Annotated[str, Field(min_length=1, max_length=64), AfterValidator(_check_timezone)]


def _check_website(value: str) -> str:
    """A web address: 'example.com/x' becomes 'https://example.com/x'; other schemes fail."""
    value = value.strip()
    if "://" not in value:
        value = f"https://{value}"
    parts = urlsplit(value)
    if parts.scheme.lower() not in ("http", "https") or not parts.netloc:
        raise ValueError("website must be an http(s) address")
    return value


WebsiteUrl = Annotated[str, Field(min_length=1, max_length=500), AfterValidator(_check_website)]


class PaletteColor(BaseModel):
    palette: Annotated[int, Field(ge=1, le=PALETTE_SIZE)] = Field(
        description="Slot 1-12 of the subject palette"
    )


class HexColor(BaseModel):
    hex: Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")] = Field(
        description="Custom color as #rrggbb"
    )


ColorRef = PaletteColor | HexColor


# --- programs -------------------------------------------------------------------------------


class Program(BaseModel):
    id: str
    name: str
    institution: str | None
    timezone: str
    default_course_credits: float
    credit_requirement: float | None
    subject_colors: dict[str, ColorRef] = Field(description="Color of each subject code")
    sort_order: int
    term_count: int
    course_count: int
    created_at: datetime
    updated_at: datetime


class ProgramList(BaseModel):
    items: list[Program]


class ProgramRef(BaseModel):
    program_id: Id = Field(description="Program id")


class ProgramCreateInput(BaseModel):
    name: Name = Field(description="Program name, e.g. 'BASc Computer Engineering'")
    institution: ShortText | None = Field(default=None, description="School or university")
    timezone: Timezone = Field(description="IANA time zone of the school, e.g. 'America/Toronto'")
    default_course_credits: Credits = Field(
        default=0.5, description="Credits a new course gets when none are given"
    )
    credit_requirement: CreditGoal | None = Field(
        default=None, description="Credits needed to graduate, if known"
    )
    setup: dict[str, JsonValue] = Field(
        default_factory=dict,
        description="Choices of other modules' setup fields (e.g. a GPA scale preset), passed on "
        "to them with the academics.program.created event",
    )


class ProgramUpdateInput(BaseModel):
    """Only the fields that are sent change; `institution` and `credit_requirement` accept null."""

    program_id: Id = Field(description="Program id")
    name: Name | None = Field(default=None, description="Program name")
    institution: ShortText | None = Field(default=None, description="School, or null")
    timezone: Timezone | None = Field(default=None, description="IANA time zone")
    default_course_credits: Credits | None = Field(
        default=None, description="Credits a new course gets"
    )
    credit_requirement: CreditGoal | None = Field(
        default=None, description="Credits needed to graduate, or null"
    )
    sort_order: int | None = Field(default=None, description="Position in the Program switcher")


class SubjectColorInput(BaseModel):
    program_id: Id = Field(description="Program id")
    subject_code: Annotated[str, Field(min_length=1, max_length=32)] = Field(
        description="Subject code such as 'APS'"
    )
    color: ColorRef = Field(description="Palette slot or custom hex color")


class Deleted(BaseModel):
    deleted: Literal[True] = True


# --- terms ----------------------------------------------------------------------------------


class BreakIn(BaseModel):
    id: Id | None = Field(default=None, description="Keep the id when editing an existing break")
    name: Name = Field(description="E.g. 'Reading week'")
    start_date: date = Field(description="First day of the break")
    end_date: date = Field(description="Last day of the break")


class Break(BaseModel):
    id: str
    name: str
    start_date: date
    end_date: date


class Term(BaseModel):
    id: str
    program_id: str
    name: str
    start_date: date
    end_date: date
    breaks: list[Break]
    count_break_weeks: bool
    is_current: bool = Field(description="The term the Program is in now (see academics rules)")
    course_count: int
    created_at: datetime
    updated_at: datetime


class TermList(BaseModel):
    items: list[Term] = Field(description="Sorted by start date")


class TermRef(BaseModel):
    term_id: Id = Field(description="Term id")


class Instructor(BaseModel):
    name: Name = Field(description="Instructor name")
    email: ShortText | None = Field(default=None, description="Email address")
    role: ShortText | None = Field(default=None, description="E.g. 'Lecturer', 'TA'")


class CourseFields(BaseModel):
    """Fields shared by course creation inputs."""

    code: Annotated[str, Field(max_length=32)] | None = Field(
        default=None, description="Course code such as 'APS105H1'"
    )
    title: Name = Field(description="Course title")
    alias: Annotated[str, Field(max_length=40)] | None = Field(
        default=None, description="Short name shown in navigation"
    )
    subject_code: Annotated[str, Field(max_length=32)] | None = Field(
        default=None, description="Subject; parsed from the code when omitted"
    )
    color: ColorRef | None = Field(default=None, description="Own color; null uses the subject's")
    credits: Credits | None = Field(
        default=None, description="Credits; the Program default when omitted"
    )
    include_in_gpa: bool = Field(default=True, description="Whether the course counts for GPA")
    instructors: list[Instructor] = Field(
        default_factory=list, max_length=20, description="Instructors and TAs"
    )
    description: Annotated[str, Field(max_length=5000)] | None = Field(
        default=None, description="Course description"
    )
    website_url: WebsiteUrl | None = Field(default=None, description="Course website")
    planned_terms: Annotated[int, Field(ge=1, le=6)] = Field(
        default=1, description="Consecutive terms the course spans; 2 for a year-long course"
    )


class TermCreateInput(BaseModel):
    program_id: Id = Field(description="Program to add the term to")
    name: Name = Field(description="E.g. 'Fall 2026'")
    start_date: date = Field(description="First day of the term")
    end_date: date = Field(description="Last day of the term")
    breaks: list[BreakIn] = Field(
        default_factory=list, max_length=20, description="Reading weeks and holidays"
    )
    count_break_weeks: bool = Field(
        default=False, description="Whether break weeks get a week number"
    )
    courses: list[CourseFields] = Field(
        default_factory=list, max_length=50, description="Courses to create in the new term"
    )
    continue_course_ids: list[Id] = Field(
        default_factory=list,
        max_length=50,
        description="Year-long courses of the previous term that continue into the new term",
    )


class TermCreateResult(BaseModel):
    term: Term
    course_ids: list[str] = Field(description="Ids of the created courses, in input order")
    continued_course_ids: list[str]


class TermUpdateInput(BaseModel):
    term_id: Id = Field(description="Term id")
    name: Name | None = Field(default=None, description="Term name")
    start_date: date | None = Field(default=None, description="First day")
    end_date: date | None = Field(default=None, description="Last day")
    breaks: list[BreakIn] | None = Field(
        default=None, max_length=20, description="Replaces all breaks"
    )
    count_break_weeks: bool | None = Field(
        default=None, description="Whether break weeks get a week number"
    )


class TermDeletePreview(BaseModel):
    deleted_course_count: int = Field(description="Courses only in this term, deleted with it")
    kept_course_count: int = Field(description="Multi-term courses that stay in their other terms")
    deleted_course_ids: list[str]
    kept_course_ids: list[str]


class TermDeleteResult(BaseModel):
    deleted_course_count: int
    kept_course_count: int


class BreakRef(BaseModel):
    id: str
    name: str


class TermWeek(BaseModel):
    start_date: date = Field(description="First day of the week (user's week start)")
    end_date: date
    number: int | None = Field(description="Week number; null for an uncounted break week")
    break_info: BreakRef | None = Field(description="The break, for a break week")


class CalendarInfo(BaseModel):
    term_id: str
    timezone: str
    week_start: Literal[1, 7] = Field(description="1 = Monday, 7 = Sunday")
    weeks: list[TermWeek]
    today: date = Field(description="Today in the Program's time zone")
    today_week: int | None = Field(description="Index into `weeks` of today's week, if in term")


# --- courses --------------------------------------------------------------------------------


class Course(BaseModel):
    id: str
    program_id: str
    code: str | None
    title: str
    alias: str | None
    subject_code: str
    color: ColorRef | None = Field(description="The course's own color, if set")
    resolved_color: str = Field(
        description="Color to display: 'subject-<1..12>' (palette token) or '#rrggbb'"
    )
    credits: float
    include_in_gpa: bool
    instructors: list[Instructor]
    description: str | None
    website_url: str | None
    planned_terms: int
    sort_order: int
    term_ids: list[str] = Field(description="Linked terms in chronological order")
    end_term_id: str = Field(description="The latest linked term; grades count there")
    created_at: datetime
    updated_at: datetime


CourseField = Literal[
    "code",
    "title",
    "alias",
    "subject_code",
    "color",
    "resolved_color",
    "credits",
    "include_in_gpa",
    "instructors",
    "description",
    "website_url",
    "planned_terms",
    "sort_order",
    "term_ids",
    "end_term_id",
    "created_at",
    "updated_at",
]


class CourseListInput(BaseModel):
    program_id: Id = Field(description="Program id")
    term_id: Id | None = Field(
        default=None, description="Only courses in this term, in the term's display order"
    )
    subject_code: str | None = Field(default=None, description="Only this subject")
    search: Annotated[str, Field(max_length=100)] | None = Field(
        default=None, description="Fuzzy match on code, title and alias (case and spaces ignored)"
    )
    fields: list[CourseField] | None = Field(
        default=None,
        description="Agent/MCP only: return just these fields of each course (and its id)",
    )
    cursor: str | None = Field(default=None, description="`next_cursor` of the previous page")
    limit: Annotated[int, Field(ge=1, le=500)] = Field(default=200, description="Page size")


class CoursePage(BaseModel):
    items: list[Course]
    next_cursor: str | None


class CourseRef(BaseModel):
    course_id: Id = Field(description="Course id")


class CourseFindInput(BaseModel):
    query: Annotated[str, Field(min_length=1, max_length=100)] = Field(
        description="How the user named the course: a code ('aps 105'), title words or nickname"
    )
    program_id: Id | None = Field(
        default=None, description="Program to search; defaults to the current one, else all"
    )
    limit: Annotated[int, Field(ge=1, le=20)] = Field(default=5, description="Max candidates")


class CourseCandidate(BaseModel):
    course_id: str
    program_id: str
    code: str | None
    title: str
    alias: str | None
    term_ids: list[str]
    score: float = Field(description="Match quality from 0 to 1")


class CourseCandidates(BaseModel):
    items: list[CourseCandidate] = Field(description="Best match first")


class CourseCreateInput(CourseFields):
    program_id: Id = Field(description="Program id")
    term_ids: list[Id] = Field(
        max_length=6, description="Terms the course runs in; consecutive terms for a year-long one"
    )


class CourseCreateItem(CourseFields):
    term_ids: list[Id] = Field(max_length=6, description="Terms the course runs in")


class CourseCreateManyInput(BaseModel):
    program_id: Id = Field(description="Program id")
    courses: list[CourseCreateItem] = Field(
        min_length=1, max_length=100, description="Courses to create"
    )


class CourseList(BaseModel):
    items: list[Course]


class CourseUpdateInput(BaseModel):
    """Only the fields that are sent change; nullable fields accept null."""

    course_id: Id = Field(description="Course id")
    code: Annotated[str, Field(max_length=32)] | None = Field(default=None, description="Code")
    title: Name | None = Field(default=None, description="Title")
    alias: Annotated[str, Field(max_length=40)] | None = Field(default=None, description="Alias")
    subject_code: Annotated[str, Field(max_length=32)] | None = Field(
        default=None, description="Subject code"
    )
    color: ColorRef | None = Field(default=None, description="Own color, or null for the subject's")
    credits: Credits | None = Field(default=None, description="Credits")
    include_in_gpa: bool | None = Field(default=None, description="Counts for GPA")
    instructors: list[Instructor] | None = Field(
        default=None, max_length=20, description="Replaces all instructors"
    )
    description: Annotated[str, Field(max_length=5000)] | None = Field(
        default=None, description="Description"
    )
    website_url: WebsiteUrl | None = Field(default=None, description="Website")
    planned_terms: Annotated[int, Field(ge=1, le=6)] | None = Field(
        default=None, description="Consecutive terms the course spans"
    )
    sort_order: int | None = Field(default=None, description="Default position within a term")


class CourseSetTermsInput(BaseModel):
    course_id: Id = Field(description="Course id")
    term_ids: list[Id] = Field(
        max_length=6, description="All terms of the course; must be consecutive"
    )


class CourseOrderInput(BaseModel):
    term_id: Id = Field(description="Term id")
    course_ids: list[Id] = Field(max_length=200, description="Courses of the term in display order")


class CourseOrder(BaseModel):
    term_id: str
    course_ids: list[str]
