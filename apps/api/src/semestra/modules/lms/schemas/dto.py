"""Provider-neutral data (M09 §2.1). Providers map their platform's payloads to these; HTML
fields hold the provider's raw HTML until the module cleans it (`html.clean`)."""

from datetime import datetime
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, BeforeValidator, Field

from semestra.core.agent_output import ForAgents
from semestra.modules.lms.markdown import to_markdown

# Cleaned HTML; agents and MCP clients get it as Markdown, under `markdown`.
Html = Annotated[str | None, ForAgents(to_markdown, "markdown")]

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
    "submissions",
    "folders",
    "mark_read",
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
        "submissions",
        "folders",
        "mark_read",
    )
)
# Features that change something on the platform: used only when the user allows writes.
WRITE_FEATURES: frozenset[LmsFeature] = frozenset(("mark_read",))

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
    external_course_id: str = Field(default="", description="The course it was posted in")
    title: str
    html: Html = None
    author: str | None = None
    posted_at: datetime | None = None
    updated_at: datetime | None = None
    unread: bool = False


class Submission(BaseModel):
    state: str | None = Field(default=None, description="e.g. submitted, graded, unsubmitted")
    submitted_at: datetime | None = None
    graded_at: datetime | None = None
    score: float | None = None
    grade: str | None = None
    late: bool = False
    missing: bool = False
    attempt: int | None = Field(default=None, description="Attempts made (quizzes, resubmissions)")


class RubricRating(BaseModel):
    id: str | None = None
    description: str = ""
    points: float | None = None


class RubricCriterion(BaseModel):
    id: str
    description: str = ""
    long_description: str | None = None
    points: float | None = None
    ratings: list[RubricRating] = Field(default_factory=list)


# Lock explanations are short platform text (HTML stripped by the module).
LockText = Annotated[str | None, Field(description="Why it is locked, as the platform says")]


class Assignment(Dto):
    name: str
    html: Html = None
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
    locked: bool = False
    lock_explanation: LockText = None
    allowed_attempts: int | None = Field(default=None, description="None or -1: unlimited")
    rubric: list[RubricCriterion] = Field(default_factory=list)


class SubmissionComment(BaseModel):
    author: str | None = None
    comment: str = ""
    created_at: datetime | None = None


class RubricScore(BaseModel):
    criterion_id: str
    points: float | None = None
    rating_id: str | None = None
    comments: str | None = None


class SubmissionDetail(Dto):
    """The user's own submission of one assignment, with the teacher's feedback."""

    assignment_id: str
    state: str | None = None
    submitted_at: datetime | None = None
    graded_at: datetime | None = None
    score: float | None = None
    grade: str | None = None
    attempt: int | None = None
    late: bool = False
    missing: bool = False
    comments: list[SubmissionComment] = Field(default_factory=list)
    rubric_scores: list[RubricScore] = Field(default_factory=list)


class GradeItem(Dto):
    name: str
    score: float | None = None
    points_possible: float | None = None
    grade: str | None = None
    group_name: str | None = None
    graded_at: datetime | None = None
    # One row per course total (`kind='total'`) plus one per assignment.
    kind: Literal["total", "assignment"] = "assignment"


class InternalRef(BaseModel):
    """A platform link the app can open itself (M16)."""

    kind: Literal["page", "assignment", "quiz", "file", "module", "announcement", "discussion"]
    ref: str


class Completion(BaseModel):
    """A module item's requirement (Canvas: must_view, must_submit, min_score, ...)."""

    type: str
    min_score: float | None = None
    completed: bool = False


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
    completion: Completion | None = Field(
        default=None, description="What finishing the item takes, and whether the user did"
    )
    locked: bool = False
    lock_explanation: LockText = None
    due_at: datetime | None = None
    points: float | None = None


class Module(Dto):
    name: str
    position: int = 0
    state: str | None = Field(
        default=None, description="The user's progress: locked, unlocked, started or completed"
    )
    unlock_at: datetime | None = None
    item_count: int = 0
    completed_at: datetime | None = None
    prerequisite_module_ids: list[str] = Field(default_factory=list)
    require_sequential_progress: bool = False
    items: list[ModuleItem] | None = Field(
        default=None,
        description="The module's items when the platform sent them along (None: ask for them)",
    )


# The `page_ref` that asks for the course's front page, whatever its slug.
FRONT_PAGE_REF = "@front"


class PageSummary(Dto):
    ref: str = Field(description="What `page` takes (Canvas: the page url slug)")
    title: str
    updated_at: datetime | None = None
    front_page: bool = False


class PageDetail(PageSummary):
    html: Html = None
    locked: bool = False
    lock_explanation: LockText = None


class Quiz(Dto):
    title: str
    html: Html = None
    due_at: datetime | None = None
    unlock_at: datetime | None = None
    lock_at: datetime | None = None
    points: float | None = None
    question_count: int | None = None
    time_limit: int | None = Field(default=None, description="Minutes; None for no limit")
    allowed_attempts: int | None = Field(default=None, description="None or -1: unlimited")
    locked: bool = False
    lock_explanation: LockText = None
    # The quiz's assignment: its submission (score, attempts) comes with the assignments.
    assignment_id: str | None = None


class RichText(BaseModel):
    html: Html = None
    web_url: WebUrl = None


class FileMeta(Dto):
    name: str
    mime_type: str | None = None
    size_bytes: int | None = None
    updated_at: datetime | None = None
    locked: bool = False
    # Provider-internal download location; never sent to clients.
    download_url: str | None = Field(default=None, exclude=True)


class Folder(Dto):
    name: str
    path: str = Field(description="Full path below the course's root folder")
    parent_id: str | None = None
    files_count: int = 0
    folders_count: int = 0
    locked: bool = False


class FolderListing(BaseModel):
    folder: Folder
    trail: list[Folder] = Field(description="From the root folder down to `folder`")
    folders: list[Folder]
    files: list[FileMeta]
    truncated: bool = False


class LmsCalendarEvent(Dto):
    external_course_id: str
    kind: Literal["event", "assignment"]
    title: str
    html: Html = None
    location: str | None = None
    start_at: datetime
    end_at: datetime | None = None
    all_day: bool = False
    # For `assignment`: the assignment's id (imports are keyed by it).
    assignment_id: str | None = None
