"""Inputs and outputs of the capabilities (M09 §5)."""

from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, SecretStr

from semestra.modules.academics.schemas import Id
from semestra.modules.lms.schemas.dto import (
    Announcement,
    Assignment,
    ConnectionSummary,
    GradeItem,
    LmsCourse,
    LmsFeature,
    Module,
    ModuleItem,
    NavTab,
    PageSummary,
    Quiz,
)

ExternalId = Annotated[str, Field(min_length=1, max_length=200)]

# --- providers ------------------------------------------------------------------------------


class ProviderInfo(BaseModel):
    kind: str
    display_name: str
    features: list[LmsFeature]
    config_schema: dict[str, Any] = Field(description="JSON schema of `config`")
    credentials_schema: dict[str, Any] = Field(description="JSON schema of `credentials`")


class ProviderList(BaseModel):
    items: list[ProviderInfo]


# --- connections ----------------------------------------------------------------------------

ConnectionStatus = Literal["connected", "error"]


class Connection(BaseModel):
    id: str
    provider: str
    display_name: str
    config: dict[str, Any] = Field(description="Non-secret settings, e.g. {base_url}")
    credentials_hint: dict[str, str] = Field(description="Masked credentials, never the values")
    has_credentials: bool = Field(description="False after a data import: enter them again")
    account_name: str | None
    status: ConnectionStatus
    last_checked_at: datetime | None
    last_error_code: str | None
    program_ids: list[str] = Field(description="Programs bound to this connection")
    link_count: int = Field(description="Courses linked through this connection")
    created_at: datetime
    updated_at: datetime


class ConnectionList(BaseModel):
    items: list[Connection]


DisplayName = Annotated[str, Field(min_length=1, max_length=80)]


class ConnectionCreateInput(BaseModel):
    provider: Annotated[str, Field(max_length=32)] = Field(description="Provider kind: canvas")
    display_name: DisplayName | None = Field(
        default=None, description="Name shown in the app; defaults to the instance name"
    )
    config: dict[str, Any] = Field(description="Provider settings, e.g. {base_url}")
    credentials: dict[str, SecretStr] = Field(
        description="Provider credentials, e.g. {access_token}; stored encrypted"
    )


class ConnectionRef(BaseModel):
    id: Id = Field(description="Connection id")


class ConnectionUpdateInput(BaseModel):
    id: Id = Field(description="Connection id")
    display_name: DisplayName | None = Field(default=None, description="New display name")
    config: dict[str, Any] | None = Field(default=None, description="New provider settings")
    credentials: dict[str, SecretStr] | None = Field(
        default=None, description="New credentials (checked before saving)"
    )


class ConnectionDeleteInput(BaseModel):
    id: Id = Field(description="Connection id")
    detach_all: bool = Field(
        default=False,
        description="Also unbind its Programs and unlink their courses (imports are kept)",
    )


class ConnectionDeleted(BaseModel):
    id: str
    unbound_programs: int
    unlinked_courses: int


class ConnectionValidateInput(BaseModel):
    connection_id: Id | None = Field(
        default=None,
        description="Check a saved connection; omitted fields use its stored values",
    )
    provider: Annotated[str, Field(max_length=32)] | None = Field(
        default=None, description="Provider kind (new connection)"
    )
    config: dict[str, Any] | None = Field(default=None, description="Provider settings")
    credentials: dict[str, SecretStr] | None = Field(default=None, description="Credentials")


class ConnectionCheck(BaseModel):
    ok: bool
    error_code: str | None
    error_params: dict[str, Any] = Field(default_factory=dict)
    summary: ConnectionSummary | None
    connection: Connection | None = Field(description="The saved connection, when one was checked")


# --- Program binding ------------------------------------------------------------------------


class ProgramRef(BaseModel):
    program_id: Id = Field(description="Program id")


class ProgramBinding(BaseModel):
    program_id: str
    connection_id: str | None
    connection: Connection | None
    link_count: int = Field(description="Courses of the Program linked through it")


class BindingSetInput(BaseModel):
    program_id: Id = Field(description="Program id")
    connection_id: Id = Field(description="Connection to bind")


# --- external courses and links -------------------------------------------------------------


class ExternalCourse(LmsCourse):
    linked_course_id: str | None = Field(description="Course of this Program linked to it")
    linked_course_name: str | None


class ExternalCourseListInput(BaseModel):
    program_id: Id = Field(description="Program id")
    include_past: bool = Field(default=False, description="Also courses of past terms")
    refresh: bool = Field(default=False, description="Skip the 5-minute cache and ask again")


class ExternalCourseList(BaseModel):
    connection_id: str
    provider: str
    items: list[ExternalCourse]
    truncated: bool


class CourseLink(BaseModel):
    id: str
    course_id: str
    program_id: str
    connection_id: str
    provider: str
    external_course_id: str
    external_code: str | None
    external_name: str | None
    external_term: str | None
    web_url: str | None
    sync_enabled: bool
    last_synced_at: datetime | None
    last_error_code: str | None
    created_at: datetime


class CourseRef(BaseModel):
    course_id: Id = Field(description="Course id")


class CourseLinkState(BaseModel):
    course_id: str
    link: CourseLink | None
    program_connection_id: str | None = Field(
        description="Connection bound to the course's Program; null = bind one first"
    )


class LinkSetInput(BaseModel):
    course_id: Id = Field(description="Course id")
    external_course_id: ExternalId = Field(description="External course id (lms.course.list)")
    sync_enabled: bool = Field(default=True, description="Show in the calendar, check updates")
    replace: bool = Field(
        default=False,
        description="Replace the course's link to another external course; only when the user "
        "asked to change it",
    )


class LinkUpdateInput(BaseModel):
    course_id: Id = Field(description="Course id")
    sync_enabled: bool = Field(description="Show in the calendar, check updates")


# --- reads ----------------------------------------------------------------------------------


class CourseReadInput(BaseModel):
    course_id: Id = Field(description="Course id (must be linked)")
    refresh: bool = Field(default=False, description="Skip the 5-minute cache and ask again")


class CourseOverview(BaseModel):
    link: CourseLink
    provider: str
    provider_name: str
    features: list[LmsFeature]
    course: LmsCourse
    navigation: list[NavTab]
    default_view: str | None
    truncated: bool


_FIELDS = "Agent/MCP only: return just these fields of each item (and its external_id)"
_BODY = "`markdown` (or `html`) is the body, as Markdown"

AnnouncementField = Literal[
    "web_url", "title", "html", "markdown", "author", "posted_at", "updated_at", "unread"
]


class AnnouncementsInput(CourseReadInput):
    since: datetime | None = Field(default=None, description="Only posted after this time")
    fields: list[AnnouncementField] | None = Field(
        default=None, description=f"{_FIELDS}; default title, author, posted_at, unread. {_BODY}"
    )


class AnnouncementList(BaseModel):
    items: list[Announcement]
    truncated: bool


class ImportTarget(BaseModel):
    kind: Literal["assessment", "task", "event"]
    id: str


class AssignmentOut(Assignment):
    imported_as: list[ImportTarget] = Field(description="Where it was imported to, if anywhere")


AssignmentField = Literal[
    "web_url", "name", "html", "markdown", "due_at", "unlock_at", "lock_at", "points", "group_id",
    "group_name", "group_weight", "submission_types", "submission", "published", "updated_at",
    "imported_as",
]  # fmt: skip


class AssignmentsInput(CourseReadInput):
    fields: list[AssignmentField] | None = Field(
        default=None,
        description=f"{_FIELDS}; default name, due_at, points, group_name, submission, "
        f"imported_as. {_BODY}",
    )


class AssignmentList(BaseModel):
    items: list[AssignmentOut]
    truncated: bool


class GradeList(BaseModel):
    items: list[GradeItem]
    truncated: bool


class ModuleList(BaseModel):
    items: list[Module]
    truncated: bool


class ModuleItemsInput(CourseReadInput):
    module_id: ExternalId = Field(description="External module id")


class ModuleItemList(BaseModel):
    items: list[ModuleItem]
    truncated: bool


class PageList(BaseModel):
    items: list[PageSummary]
    truncated: bool


class PageGetInput(CourseReadInput):
    ref: ExternalId = Field(
        description="Page ref from lms.page.list, or `@front` for the course's front page"
    )


QuizField = Literal[
    "web_url",
    "title",
    "html",
    "markdown",
    "due_at",
    "unlock_at",
    "lock_at",
    "points",
    "question_count",
]


class QuizzesInput(CourseReadInput):
    fields: list[QuizField] | None = Field(
        default=None, description=f"{_FIELDS}; default all but web_url and html. {_BODY}"
    )


class QuizList(BaseModel):
    items: list[Quiz]
    truncated: bool


class FileInput(CourseReadInput):
    file_id: ExternalId = Field(description="External file id")


class FileSaveInput(BaseModel):
    course_id: Id = Field(description="Course id (must be linked)")
    file_id: ExternalId = Field(description="External file id")
    folder_id: Id | None = Field(default=None, description="Course folder (M07), default root")


class SavedFile(BaseModel):
    file_item_id: str
    name: str


# --- imports --------------------------------------------------------------------------------


class ImportStarted(BaseModel):
    session_id: str
    program_id: str
    count: int = Field(description="Items put up for review")


class CoursesImportInput(BaseModel):
    program_id: Id = Field(description="Program id (must have a bound connection)")
    external_course_ids: list[ExternalId] = Field(
        min_length=1, max_length=50, description="External courses to import"
    )
    term_id: Id | None = Field(
        default=None, description="Term the courses go into; agents create the term first"
    )
    term_wizard: bool = Field(
        default=False,
        description="Only for the app's new-term wizard (the term is created afterwards); "
        "agents cannot use it",
    )
    start_date: date | None = Field(
        default=None, description="App wizard only: first day of the term"
    )
    end_date: date | None = Field(default=None, description="App wizard only: last day of the term")


class AssignmentsImportInput(BaseModel):
    course_id: Id = Field(description="Course id (must be linked)")
    external_ids: list[ExternalId] = Field(
        min_length=1, max_length=200, description="Assignments to import"
    )
    as_kind: Literal["assessment", "task"] = Field(
        default="assessment", description="Default type; switchable per item in the review"
    )


class FieldUpdate(BaseModel):
    old: Any = None
    new: Any = None


class AssignmentUpdate(BaseModel):
    external_id: str
    name: str
    target: ImportTarget
    changes: dict[str, FieldUpdate] = Field(description="title, due_at and/or points")


class UpdatesOutput(BaseModel):
    course_id: str
    count: int
    items: list[AssignmentUpdate]
