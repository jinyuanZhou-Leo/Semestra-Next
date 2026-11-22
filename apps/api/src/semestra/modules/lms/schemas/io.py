"""Inputs and outputs of the capabilities (M09 §5)."""

from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, Field, SecretStr

from semestra.core.capability import HTTP_ONLY
from semestra.modules.academics.schemas import Id
from semestra.modules.lms.rules import SubmissionStatus
from semestra.modules.lms.schemas.dto import (
    Assignment,
    Attachment,
    ConnectionSummary,
    FileMeta,
    GradeItem,
    Html,
    LmsCourse,
    LmsFeature,
    Module,
    ModuleItem,
    NavTab,
    PageSummary,
    Quiz,
    RubricCriterion,
    RubricScore,
    SubmissionComment,
    SubmissionDetail,
    WebUrl,
)

ExternalId = Annotated[str, Field(min_length=1, max_length=200)]


def _ref_id(kind: str) -> BeforeValidator:
    """Takes an item's ref (`assignment:12`, M09 §8) as well as its bare external id."""
    return BeforeValidator(lambda v: v.removeprefix(f"{kind}:") if isinstance(v, str) else v)


AssignmentId = Annotated[ExternalId, _ref_id("assignment")]
FileId = Annotated[ExternalId, _ref_id("file")]

# --- providers ------------------------------------------------------------------------------


class ProviderInfo(BaseModel):
    kind: str
    display_name: str
    features: list[LmsFeature]
    config_schema: dict[str, Any] = Field(description="JSON schema of `config`")
    credentials_schema: dict[str, Any] = Field(description="JSON schema of `credentials`")
    sign_in: bool = Field(
        default=False,
        description="Connections can be made by signing in on the platform's page (this server)",
    )


class ProviderList(BaseModel):
    items: list[ProviderInfo]


class SignInStartInput(BaseModel):
    provider: Annotated[str, Field(max_length=32)] = Field(description="Provider kind: canvas")
    config: dict[str, Any] = Field(description="Provider settings, e.g. {base_url}")


class SignInStart(BaseModel):
    authorize_url: str = Field(description="Open in the user's browser to sign in")


SignInPasted = Annotated[SecretStr, Field(min_length=1, max_length=4000)]


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
        default_factory=dict,
        description="Provider credentials, e.g. {access_token}; stored encrypted",
    )
    sign_in: SignInPasted | None = Field(
        default=None,
        description="Instead of credentials: the address the platform's sign-in page ended on "
        "(lms.connection.sign_in.start)",
    )


class ConnectionUpdateInput(BaseModel):
    id: Id = Field(description="Connection id")
    display_name: DisplayName | None = Field(default=None, description="New display name")
    config: dict[str, Any] | None = Field(default=None, description="New provider settings")
    credentials: dict[str, SecretStr] | None = Field(
        default=None, description="New credentials (checked before saving)"
    )
    sign_in: SignInPasted | None = Field(
        default=None, description="Instead of credentials: a new sign-in on the platform's page"
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


class LinkListInput(ProgramRef):
    term_id: Id | None = Field(default=None, description="Only the courses of this term")


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
    refresh: bool = Field(
        default=False,
        description="Skip the 5-minute cache and ask again",
        json_schema_extra=HTTP_ONLY,
    )


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
    synced_at: datetime | None = Field(description="Last background sync of the course")
    sync_errors: dict[str, str] = Field(
        description="Error code of each sync stage whose last run failed (course, assignments, "
        "announcements, ...)"
    )
    features: list[LmsFeature] = Field(description="What its platform supports")
    created_at: datetime


class CourseRef(BaseModel):
    course_id: Id = Field(description="Course id")


class MaterialCounts(BaseModel):
    """The course files that follow the linked course's materials, by what unlinking does to
    them."""

    local: int = Field(description="With a local copy: they become the user's own files")
    online: int = Field(description="Read online (and links): they leave the course's files")


class MaterialsScope(BaseModel):
    course_id: Id | None = Field(
        default=None, description="One course; left out: every linked course"
    )


class HeldMaterials(BaseModel):
    """Course files still there from materials whose sync was turned off: they no longer follow
    the platform."""

    courses: int = Field(description="Linked courses with such files")
    local: int = Field(description="With a local copy")
    online: int = Field(description="Read online (and links)")


class CourseLinkState(BaseModel):
    course_id: str
    link: CourseLink | None
    materials: MaterialCounts | None = Field(
        default=None, description="Of the linked course; null when not linked"
    )
    program_connection_id: str | None = Field(
        description="Connection bound to the course's Program; null = bind one first"
    )


class CourseLinkList(BaseModel):
    items: list[CourseLink]


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
    sync_enabled: bool | None = Field(
        default=None, description="Show in the calendar, check updates"
    )


# --- reads ----------------------------------------------------------------------------------


class CourseReadInput(BaseModel):
    course_id: Id = Field(description="Course id (must be linked)")
    refresh: bool = Field(
        default=False,
        description="Skip the 5-minute cache and ask again",
        json_schema_extra=HTTP_ONLY,
    )


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
    "web_url", "title", "html", "markdown", "author", "posted_at", "updated_at", "unread",
    "attachments",
]  # fmt: skip


class AnnouncementsInput(BaseModel):
    course_id: Id = Field(description="Course id (must be linked)")
    since: datetime | None = Field(default=None, description="Only posted after this time")
    fields: list[AnnouncementField] | None = Field(
        default=None, description=f"{_FIELDS}; default title, author, posted_at, unread. {_BODY}"
    )


class AppTarget(BaseModel):
    """What a platform item is in the app: a course file (a synced file or page), or what an
    imported assignment became."""

    kind: Literal["file", "assessment", "task"]
    id: str
    course_id: str
    folder_id: str | None = Field(default=None, description="The file's folder (kind file)")


class LinkTarget(BaseModel):
    """A link in the HTML (`data-lms-kind` / `data-lms-ref`) to something the app has."""

    kind: str
    ref: str
    target: AppTarget


class AnnouncementAttachment(Attachment):
    file: AppTarget | None = Field(
        default=None, description="The course file it is, when the course's files have it"
    )


class CourseAnnouncement(BaseModel):
    external_id: str
    course_id: str = Field(description="The app's course it was posted in")
    web_url: WebUrl = Field(default=None, description="Opens it on the platform")
    title: str
    html: Html = None
    text: str = Field(description="`html` as plain text on one line: list previews and search")
    author: str | None = None
    posted_at: datetime | None = None
    updated_at: datetime | None = None
    unread: bool = Field(description="Not opened in the app yet")
    attachments: list[AnnouncementAttachment] = []
    targets: list[LinkTarget] = Field(
        default=[], description="Where the platform links in `html` open in the app"
    )


# waiting: the next sync reads it; ended: its term ended, only a manual sync reads it;
# paused: the course's sync is off. In this order when the courses differ.
NotRead = Literal["waiting", "ended", "paused"]


class AnnouncementList(BaseModel):
    items: list[CourseAnnouncement] = Field(description="Newest first")
    not_read: NotRead | None = Field(
        description="Why the sync has not read the course's announcements yet; null: it has"
    )


class TermAnnouncementsInput(BaseModel):
    term_id: Id = Field(description="Term id")


class TermAnnouncementList(BaseModel):
    items: list[CourseAnnouncement] = Field(description="Newest first")
    linked_course_ids: list[str] = Field(description="The term's courses linked to an LMS")
    not_read: NotRead | None = Field(
        description="Why the sync has not read some of their announcements yet; null: it has"
    )


class UnreadInput(BaseModel):
    program_id: Id = Field(description="Program id")
    term_id: Id | None = Field(default=None, description="Only the courses of this term")


class CourseUnread(BaseModel):
    course_id: str
    unread: int


class UnreadCounts(BaseModel):
    items: list[CourseUnread] = Field(description="Courses with unread announcements")


class ImportTarget(BaseModel):
    kind: Literal["assessment", "task"]
    id: str


class AssignmentOut(Assignment):
    ref: str = Field(default="", description="For lms.content.read: its text, score and feedback")
    imported_as: ImportTarget | None = Field(
        description="What it was imported as (an assessment, which has its to-do, or a to-do); "
        "null while not imported"
    )


AssignmentField = Literal[
    "web_url", "name", "html", "markdown", "due_at", "unlock_at", "lock_at", "points", "group_id",
    "group_name", "group_weight", "submission_types", "submission", "published", "updated_at",
    "locked", "lock_explanation", "allowed_attempts", "rubric", "imported_as",
]  # fmt: skip


class AssignmentsInput(CourseReadInput):
    status: Literal["upcoming", "missing", "graded"] | None = Field(
        default=None,
        description="Only those due later and not handed in (upcoming), past due and not handed "
        "in (missing), or graded",
    )
    due_after: datetime | None = Field(
        default=None, description="Only those due after this (no offset: the Program's time)"
    )
    due_before: datetime | None = Field(
        default=None, description="Only those due before this (no offset: the Program's time)"
    )
    include_total: bool = Field(
        default=False, description="Also the course total as the LMS shows it (`totals`)"
    )
    fields: list[AssignmentField] | None = Field(
        default=None,
        description=f"{_FIELDS}; default name, due_at, points, group_name, submission, "
        f"imported_as. {_BODY}",
    )


class AssignmentList(BaseModel):
    items: list[AssignmentOut]
    new_ids: list[str] = Field(
        description="`external_id` of the new assignments: not imported and due later"
    )
    totals: list[GradeItem] = Field(
        default_factory=list,
        description="The course total as the LMS shows it, with `include_total`",
    )
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


# A page's ref is its url slug, made from its title (up to 255 characters, more once escaped).
PageRef = Annotated[str, Field(min_length=1, max_length=600)]


class PageGetInput(CourseReadInput):
    ref: PageRef = Field(
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


FILE_ID = "The file's ref (`file:<id>`) or external id"


class FileInput(CourseReadInput):
    file_id: FileId = Field(description=FILE_ID)


class FeedbackOut(BaseModel):
    """The teacher's feedback on an assessment, as the last sync kept it (M09 §4.4)."""

    assessment_id: str
    provider: str = Field(description="The provider it was read from")
    assignment_id: str = Field(description="The assignment's external id")
    web_url: str | None = None
    points: float | None = Field(default=None, description="The assignment's points")
    score: float | None = None
    grade: str | None = None
    attempt: int | None = None
    graded_at: datetime | None = None
    comments: list[SubmissionComment] = []
    rubric: list[RubricCriterion] = Field(
        default=[], description="The assignment's rubric; `rubric_scores` name its criteria"
    )
    rubric_scores: list[RubricScore] = []


class FeedbackList(BaseModel):
    items: list[FeedbackOut] = Field(
        description="Assessments of the course with comments or rubric scores"
    )


class AssignmentReadInput(BaseModel):
    course_id: Id = Field(description="Course id")
    assignment_id: AssignmentId = Field(
        description="External assignment id (`external_id` of lms.assignment.list), or "
        "`quiz:<quiz id>` for a quiz: its assignment, or the quiz itself when it has none"
    )
    refresh: bool = Field(default=False, description="Skip the 5-minute cache and ask again")


# What the sync keeps of an imported assignment and of the user's submission, next to the
# feedback (`LmsKeptAssignment.details` and `.work`): the rest has columns of its own.
KEPT_ASSIGNMENT = frozenset(Assignment.model_fields) - {"submission", "rubric", "web_url", "points"}
KEPT_SUBMISSION = frozenset(SubmissionDetail.model_fields) - {
    "score", "grade", "attempt", "graded_at", "comments", "rubric_scores",
}  # fmt: skip


class QuizFacts(BaseModel):
    question_count: int | None = None
    time_limit: int | None = Field(default=None, description="Minutes; None for no limit")


class InGradebook(BaseModel):
    id: str
    weight: float = Field(description="Percent of the course grade")


class InTasks(BaseModel):
    id: str
    completed: bool


class AssignmentFacts(Assignment):
    """The assignment as `AssignmentDetail` gives it (its own name in the API: the AI module has
    an `Assignment` too)."""


class AssignmentDetail(BaseModel):
    """One assignment, whole (M09 §5): as the platform has it now, or, when the platform
    can't be asked, as the last sync kept it (`kept_at`)."""

    provider: str = Field(description="The provider it was read from")
    assignment: AssignmentFacts = Field(description="Without `submission`: it is `submission` here")
    submission: SubmissionDetail | None = Field(
        description="What the user handed in, with the teacher's feedback; null when unknown"
    )
    quiz: QuizFacts | None = Field(default=None, description="Of an assignment that is a quiz")
    practice: bool = Field(
        default=False,
        description="A quiz without an assignment (a practice quiz): no submission, not importable",
    )
    kept: bool = Field(
        default=False, description="This is what the sync kept, not the platform's answer"
    )
    kept_at: datetime | None = Field(
        default=None, description="When the sync read what it kept (unknown for old rows)"
    )
    problem: str | None = Field(
        default=None, description="Why the platform's answer is missing (an error code)"
    )
    assessment: InGradebook | None = Field(description="The gradebook row it was imported as")
    task: InTasks | None = Field(description="Its to-do")
    targets: list[LinkTarget] = Field(
        default=[], description="What the description's links to course files are in the app"
    )


class AssignmentTarget(BaseModel):
    course_id: str
    assignment_id: str = Field(description="The assignment's external id")
    assessment_id: str | None = None
    task_id: str | None = Field(
        default=None, description="Set for an assignment imported as a to-do only"
    )
    feedback: bool = Field(
        default=False,
        description="The teacher left comments or rubric scores on the assessment",
    )
    status: SubmissionStatus | None = Field(
        default=None,
        description="Where the user's submission stands as of the last sync; None until the "
        "sync has read it",
    )
    missing: bool = False
    late: bool = False
    submitted_at: datetime | None = None
    online: bool = Field(
        default=True, description="Handed in on the platform (not on paper or not at all)"
    )


class AssignmentTargets(BaseModel):
    items: list[AssignmentTarget] = Field(
        description="The Program's assessments and to-dos that are an assignment of the platform"
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


class FileSaveInput(BaseModel):
    course_id: Id = Field(description="Course id (must be linked)")
    file_id: FileId = Field(description=FILE_ID)
    folder_id: Id | None = Field(default=None, description="Course folder, default root")


class SavedFile(BaseModel):
    file_item_id: str
    name: str
    # False: the sync had brought the file in, and a job is storing it in place now.
    stored: bool = True


# --- imports --------------------------------------------------------------------------------


class ImportStarted(BaseModel):
    session_id: str
    program_id: str
    count: int = Field(description="Items in the import")


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
    external_ids: list[AssignmentId] = Field(
        min_length=1,
        max_length=200,
        description="Assignments (`ref` or `external_id` of lms.assignment.list)",
    )


class AssignmentImportInput(AssignmentsImportInput):
    into: Literal["auto", "gradebook"] = Field(
        default="auto",
        description="auto: new assignments worth points become assessments, the others to-dos. "
        "gradebook: assignments already imported as to-dos move into the gradebook",
    )


class AssessmentRef(BaseModel):
    assessment_id: Id = Field(description="Assessment id (grading.assessment.find)")


class AssignmentBindInput(AssessmentRef):
    assignment_id: AssignmentId = Field(
        description="An assignment of the assessment's course not imported yet (`ref` or "
        "`external_id` of lms.assignment.list)"
    )


class AssignmentBinding(BaseModel):
    assessment_id: str
    course_id: str
    assignment_id: str | None = Field(
        description="External id of the assignment it is bound to; null once unbound"
    )
