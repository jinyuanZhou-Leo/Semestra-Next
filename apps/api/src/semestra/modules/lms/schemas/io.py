"""Inputs and outputs of the capabilities (M09 §5)."""

from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, SecretStr

from semestra.modules.academics.schemas import Id
from semestra.modules.lms.schemas.dto import (
    Announcement,
    Assignment,
    ConnectionSummary,
    FileMeta,
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
    connection_id: Id = Field(
        description="Connection to bind (`connection.id` of lms.program.binding.get); the user "
        "adds connections in the settings"
    )


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
    fetched_at: datetime | None = Field(
        default=None, description="When the course was last read from the platform (cached)"
    )
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


class TermAnnouncementsInput(BaseModel):
    term_id: Id = Field(description="Term id")
    refresh: bool = Field(default=False, description="Skip the 5-minute cache and ask again")


class TermAnnouncement(Announcement):
    course_id: str = Field(description="The app's course it was posted in")


class TermAnnouncementList(BaseModel):
    items: list[TermAnnouncement] = Field(description="Newest first")
    linked_course_ids: list[str] = Field(description="The term's courses linked to an LMS")
    truncated: bool


class ImportTarget(BaseModel):
    kind: Literal["assessment", "task", "event"]
    id: str


class AssignmentOut(Assignment):
    imported_as: list[ImportTarget] = Field(description="Where it was imported to, if anywhere")


AssignmentField = Literal[
    "web_url", "name", "html", "markdown", "due_at", "unlock_at", "lock_at", "points", "group_id",
    "group_name", "group_weight", "submission_types", "submission", "published", "updated_at",
    "locked", "lock_explanation", "allowed_attempts", "rubric", "imported_as",
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
    module_id: ExternalId = Field(description="External module id, from lms.module.list")


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
    "time_limit",
    "allowed_attempts",
    "locked",
    "lock_explanation",
    "assignment_id",
]


class QuizzesInput(CourseReadInput):
    fields: list[QuizField] | None = Field(
        default=None, description=f"{_FIELDS}; default all but web_url and html. {_BODY}"
    )


class QuizList(BaseModel):
    items: list[Quiz]
    truncated: bool


FILE_ID = (
    "External file id: `target.ref` of a file in lms.module_item.list, or `external_id` of "
    "a file from lms.folder.get / lms.file.search"
)


class FileInput(CourseReadInput):
    file_id: ExternalId = Field(description=FILE_ID)


class SubmissionInput(CourseReadInput):
    assignment_id: ExternalId = Field(
        description="External assignment id (`external_id` of lms.assignment.list)"
    )


class FolderInput(CourseReadInput):
    folder_id: ExternalId | None = Field(
        default=None, description="External folder id; the course's root folder when left out"
    )


class FileSearchInput(CourseReadInput):
    term: Annotated[str, Field(min_length=2, max_length=100)] = Field(
        description="Part of the file name"
    )


class FileList(BaseModel):
    items: list[FileMeta]
    truncated: bool


class FilePreview(BaseModel):
    name: str
    mime_type: str
    kind: str = Field(description="pdf, docx, pptx, xlsx, csv, html, text or markdown")
    pages: list[str] = Field(description="Markdown per page (slide, sheet, logical page)")
    truncated: bool = Field(description="Only the first pages are included")


class AnnouncementReadInput(BaseModel):
    course_id: Id = Field(description="Course id (must be linked)")
    announcement_id: ExternalId = Field(description="External announcement id")


class AnnouncementRead(BaseModel):
    announcement_id: str
    unread: bool


class FileSaveInput(BaseModel):
    course_id: Id = Field(description="Course id (must be linked)")
    file_id: ExternalId = Field(description=FILE_ID)
    folder_id: Id | None = Field(default=None, description="Course folder, default root")


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
        min_length=1,
        max_length=50,
        description="External courses to import (`external_id` of lms.course.list)",
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
        min_length=1,
        max_length=200,
        description="Assignments to import (`external_id` of lms.assignment.list)",
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
    changes: dict[str, FieldUpdate] = Field(
        description="title, due_at, points, weight and/or score (the grade on the platform)"
    )


class UpdatesOutput(BaseModel):
    course_id: str
    count: int
    items: list[AssignmentUpdate]
