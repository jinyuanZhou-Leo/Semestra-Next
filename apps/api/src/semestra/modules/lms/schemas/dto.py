"""Provider-neutral data (M09 §2.1). Providers map their platform's payloads to these; HTML
fields hold the provider's raw HTML until the module cleans it (`html.clean`)."""

from datetime import datetime
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, BeforeValidator, Field

LmsFeature = Literal[
    "courses",
    "navigation",
    "announcements",
    "assignments",
    "grades",
    "modules",
    "pages",
    "quizzes",
    "syllabus",
    "files",
    "calendar",
]
ALL_FEATURES: frozenset[LmsFeature] = frozenset(
    (
        "courses",
        "navigation",
        "announcements",
        "assignments",
        "grades",
        "modules",
        "pages",
        "quizzes",
        "syllabus",
        "files",
        "calendar",
    )
)

NavKind = Literal[
    "home",
    "announcements",
    "assignments",
    "grades",
    "modules",
    "pages",
    "quizzes",
    "syllabus",
    "files",
    "discussions",
    "external",
    "unknown",
]


def _web_only(value: object) -> object:
    """Platform links end up in `href`s and `window.open`: anything but http(s) is dropped."""
    if not isinstance(value, str):
        return value
    value = value.strip()
    return value if urlsplit(value).scheme.lower() in ("http", "https") else None


# A link to the platform's own web page; provider data, so the scheme is checked.
WebUrl = Annotated[str | None, BeforeValidator(_web_only)]


class Dto(BaseModel):
    external_id: str
    web_url: WebUrl = Field(default=None, description="Opens the item on the platform")
    raw_kind: str | None = Field(default=None, description="The platform's own type (debugging)")


class ConnectionSummary(BaseModel):
    account_name: str | None = None
    avatar_url: str | None = None
    instance_name: str | None = None


class LmsCourse(Dto):
    code: str | None = None
    name: str
    term: str | None = Field(default=None, description="The platform's term name")
    start_at: datetime | None = None
    end_at: datetime | None = None
    default_view: str | None = None
    # The platform says the course is in a current term (Canvas: enrollment state active).
    is_current: bool = True


class NavTab(Dto):
    kind: NavKind
    label: str
    position: int = 0
    hidden: bool = False


class Announcement(Dto):
    title: str
    html: str | None = None
    author: str | None = None
    posted_at: datetime | None = None
    updated_at: datetime | None = None


class Submission(BaseModel):
    state: str | None = Field(default=None, description="e.g. submitted, graded, unsubmitted")
    submitted_at: datetime | None = None
    graded_at: datetime | None = None
    score: float | None = None
    grade: str | None = None
    late: bool = False
    missing: bool = False


class Assignment(Dto):
    name: str
    html: str | None = None
    due_at: datetime | None = None
    unlock_at: datetime | None = None
    lock_at: datetime | None = None
    points: float | None = None
    group_id: str | None = None
    group_name: str | None = None
    # Percent of the course grade of the whole group, when the course weights its groups.
    group_weight: float | None = None
    submission_types: list[str] = Field(default_factory=list)
    submission: Submission | None = None
    published: bool = True
    updated_at: datetime | None = None


class GradeItem(Dto):
    name: str
    score: float | None = None
    points_possible: float | None = None
    grade: str | None = None
    group_name: str | None = None
    graded_at: datetime | None = None
    # One row per course total (`kind='total'`) plus one per assignment.
    kind: Literal["total", "assignment"] = "assignment"


class Module(Dto):
    name: str
    position: int = 0
    state: str | None = None
    unlock_at: datetime | None = None
    item_count: int = 0


class InternalRef(BaseModel):
    """A platform link the app can open itself (M16)."""

    kind: Literal["page", "assignment", "quiz", "file", "module", "announcement", "discussion"]
    ref: str


class ModuleItem(Dto):
    title: str
    kind: Literal[
        "page",
        "assignment",
        "quiz",
        "file",
        "discussion",
        "subheader",
        "external_url",
        "external_tool",
        "unknown",
    ]
    position: int = 0
    indent: int = 0
    target: InternalRef | None = Field(default=None, description="Where the item opens in-app")
    external_url: str | None = None


class PageSummary(Dto):
    ref: str = Field(description="What `page` takes (Canvas: the page url slug)")
    title: str
    updated_at: datetime | None = None
    front_page: bool = False


class PageDetail(PageSummary):
    html: str | None = None
    locked: bool = False


class Quiz(Dto):
    title: str
    html: str | None = None
    due_at: datetime | None = None
    unlock_at: datetime | None = None
    lock_at: datetime | None = None
    points: float | None = None
    question_count: int | None = None


class RichText(BaseModel):
    html: str | None = None
    web_url: WebUrl = None


class FileMeta(Dto):
    name: str
    mime_type: str | None = None
    size_bytes: int | None = None
    updated_at: datetime | None = None
    locked: bool = False
    # Provider-internal download location; never sent to clients.
    download_url: str | None = Field(default=None, exclude=True)


class LmsCalendarEvent(Dto):
    external_course_id: str
    kind: Literal["event", "assignment"]
    title: str
    html: str | None = None
    location: str | None = None
    start_at: datetime
    end_at: datetime | None = None
    all_day: bool = False
    # For `assignment`: the assignment's id (imports are keyed by it).
    assignment_id: str | None = None
