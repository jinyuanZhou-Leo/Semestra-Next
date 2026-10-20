"""Inputs, outputs and the per-type item data of imports (M08 §2, §5).

Item data are drafts: they may be incomplete (a date that could not be resolved), so the models
here are looser than the target capabilities' inputs. What a target refuses comes back as the
item's `result.error_code` on commit.
"""

from datetime import date, datetime, time
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from semestra.modules.academics.schemas import Credits, Id, Instructor

SourceKind = Literal["ics", "syllabus", "timetable_image", "lms", "text", "agent"]
SessionStatus = Literal["extracting", "ready", "committing", "committed", "failed", "discarded"]
ItemType = Literal[
    "course",
    "meeting",
    "event",
    "category",
    "assessment",
    "task",
    "course_patch",
    "assessment_patch",
    "task_patch",
]
Decision = Literal["accept", "reject", "pending"]
Confidence = Literal["high", "medium", "low"]
TargetKind = Literal["term_wizard", "term", "course"]

# `item:<id>` (a course item of the same session) or `course:<id>` (an existing course).
CourseRef = Annotated[str, Field(pattern=r"^(item|course):[A-Za-z0-9-]{1,64}$")]
# `term:<id>`; null means the session's target term (in the wizard: the term being created).
TermRef = Annotated[str, Field(pattern=r"^term:[A-Za-z0-9-]{1,64}$")]
# `item:<id>` (a category item) or `key:<key>` (a category of the course by key).
CategoryRef = Annotated[str, Field(pattern=r"^(item:[A-Za-z0-9-]{1,64}|key:[a-z0-9_-]{1,32})$")]
Text200 = Annotated[str, Field(max_length=200)]
Title = Annotated[str, Field(min_length=1, max_length=200)]
Day = date  # `EventData.date` shadows the type inside that class


# --- item data, one model per type ----------------------------------------------------------


class CourseData(BaseModel):
    code: Annotated[str, Field(max_length=32)] | None = None
    title: Title
    alias: Annotated[str, Field(max_length=40)] | None = None
    credits: Credits | None = None
    instructors: list[Instructor] = Field(default_factory=list, max_length=20)
    description: Annotated[str, Field(max_length=5000)] | None = None
    website_url: Annotated[str, Field(max_length=500)] | None = None
    planned_terms: Annotated[int, Field(ge=1, le=6)] = 1
    # Terms to link; empty = the session's target term.
    term_ids: list[Id] = Field(default_factory=list, max_length=6)
    # An existing course with the same code (ICS imports point their meetings at it instead).
    existing_course_id: Id | None = None


class FieldChange(BaseModel):
    old: Any = None
    new: Any = None
    apply: bool = True


PatchField = Literal[
    "code", "title", "credits", "instructors", "description", "website_url", "planned_terms"
]


class CoursePatchData(BaseModel):
    course_id: Id
    changes: dict[PatchField, FieldChange]


class AssessmentPatchData(BaseModel):
    """Changes to an existing assessment (M09 LMS updates)."""

    assessment_id: Id
    label: Annotated[str, Field(max_length=200)] = ""  # names the item in the review
    changes: dict[Literal["title", "due_date", "due_time", "weight"], FieldChange]


class TaskPatchData(BaseModel):
    """Changes to an existing task (M09 LMS updates)."""

    task_id: Id
    label: Annotated[str, Field(max_length=200)] = ""  # names the item in the review
    changes: dict[Literal["title", "due_date", "due_time"], FieldChange]


class MeetingData(BaseModel):
    course_ref: CourseRef
    term_ref: TermRef | None = None
    section_code: Annotated[str, Field(max_length=32)] = ""
    type_code: Annotated[str, Field(min_length=1, max_length=8)] = "LEC"
    weekday: Annotated[int, Field(ge=1, le=7)]
    start_time: time
    end_time: time
    recurrence: Literal["weekly", "biweekly"] = "weekly"
    # Either term weeks or the dates of the first and last class (resolved to weeks on commit,
    # when the term is known).
    start_week: Annotated[int, Field(ge=1, le=60)] | None = None
    end_week: Annotated[int, Field(ge=1, le=60)] | None = None
    first_date: date | None = None
    last_date: date | None = None
    weeks_text: Text200 | None = None
    location: Text200 | None = None
    instructor: Text200 | None = None
    source_ref: Annotated[str, Field(max_length=500)] | None = None
    # Dates the class is cancelled (holidays, irregular weeks); break weeks of the term are
    # skipped anyway. Written as cancellations of the meeting on commit.
    exceptions: list[date] = Field(default_factory=list, max_length=200)


class EventData(BaseModel):
    course_ref: CourseRef | None = None
    term_ref: TermRef | None = None
    title: Title
    date: Day | None = None
    start_time: time | None = None
    end_time: time | None = None
    end_date: Day | None = None
    all_day: bool = False
    type_code: Annotated[str, Field(max_length=8)] | None = None
    kind: Literal["exam", "deadline", "no_class", "other"] = "other"
    date_text: Text200 | None = None
    location: Text200 | None = None
    source_ref: Annotated[str, Field(max_length=500)] | None = None


class CategoryData(BaseModel):
    course_ref: CourseRef
    name: Title
    key: Annotated[str, Field(pattern=r"^[a-z0-9][a-z0-9_-]{0,31}$")] | None = None
    # Weight of the whole category in the syllabus; only used to check the assessments.
    weight_total: Annotated[float, Field(ge=0, le=100)] | None = None


class AssessmentData(BaseModel):
    course_ref: CourseRef
    title: Title
    category_ref: CategoryRef | None = None
    weight: Annotated[float, Field(ge=0, le=100)] = 0
    due_date: date | None = None
    due_time: time | None = None
    due_text: Text200 | None = None
    note: Annotated[str, Field(max_length=2000)] | None = None
    source_ref: Annotated[str, Field(max_length=200)] | None = None
    # Fields of the other kind, kept while the user has switched the item (M09).
    held: dict[str, Any] | None = None


class TaskData(BaseModel):
    course_ref: CourseRef | None = None
    title: Title
    due_date: date | None = None
    due_time: time | None = None
    due_text: Text200 | None = None
    priority: Literal["none", "low", "medium", "high"] = "none"
    notes: Annotated[str, Field(max_length=2000)] | None = None
    source_ref: Annotated[str, Field(max_length=500)] | None = None
    # Fields of the other kind, kept while the user has switched the item (M09).
    held: dict[str, Any] | None = None


DATA_MODELS: dict[str, type[BaseModel]] = {
    "course": CourseData,
    "course_patch": CoursePatchData,
    "assessment_patch": AssessmentPatchData,
    "task_patch": TaskPatchData,
    "meeting": MeetingData,
    "event": EventData,
    "category": CategoryData,
    "assessment": AssessmentData,
    "task": TaskData,
}


# --- outputs --------------------------------------------------------------------------------


class Evidence(BaseModel):
    upload_id: str | None = None
    file_item_id: str | None = Field(default=None, description="M07 file the quote is from")
    page: int | None = None
    quote: Annotated[str, Field(max_length=400)] | None = None


class Issue(BaseModel):
    code: str = Field(description="Error code, e.g. import.date_unresolved")
    params: dict[str, Any] = Field(default_factory=dict)


class ItemResult(BaseModel):
    created_id: str | None = None
    updated_id: str | None = None
    # The target already had it (same source or same key); nothing was written.
    reused: bool = False
    error_code: str | None = None
    error_params: dict[str, Any] = Field(default_factory=dict)


class ImportItem(BaseModel):
    id: str
    session_id: str
    type: ItemType
    data: dict[str, Any] = Field(description="The type's draft fields (see the M08 spec §2)")
    evidence: dict[str, Evidence]
    confidence: dict[str, Confidence]
    decision: Decision
    issues: list[Issue]
    depends_on: list[str]
    result: ItemResult | None
    position: int


class SourceRef(BaseModel):
    upload_id: str | None = None
    file_item_id: str | None = None
    filename: str | None = None
    lms_course_id: str | None = None
    status: Literal["pending", "extracting", "done", "failed"] = "pending"
    error_code: str | None = None


class SessionTarget(BaseModel):
    kind: TargetKind = Field(description="Where the import goes")
    term_id: Id | None = Field(default=None, description="Term (kind term, or course's term)")
    course_id: Id | None = Field(default=None, description="Course (kind course)")
    start_date: date | None = Field(
        default=None, description="Wizard: first day of the term being created"
    )
    end_date: date | None = Field(default=None, description="Wizard: last day of that term")


class SessionSummary(BaseModel):
    counts: dict[str, int] = Field(default_factory=dict, description="Items per type")
    accepted: dict[str, int] = Field(default_factory=dict, description="Accepted items per type")
    issues: dict[str, int] = Field(default_factory=dict, description="Open issues per code")
    created: int = 0
    updated: int = 0
    failed: int = 0


class ImportSession(BaseModel):
    id: str
    program_id: str
    source_kind: SourceKind
    target: SessionTarget
    status: SessionStatus
    job_id: str | None
    source_refs: list[SourceRef]
    source_meta: dict[str, Any]
    summary: SessionSummary
    error_code: str | None
    created_at: datetime
    updated_at: datetime
    committed_at: datetime | None


class ImportSessionDetail(ImportSession):
    items: list[ImportItem]


class ImportSessionPage(BaseModel):
    items: list[ImportSession]
    next_cursor: str | None


class Upload(BaseModel):
    id: str
    filename: str
    mime_type: str
    size_bytes: int


# --- inputs ---------------------------------------------------------------------------------


class SessionCreateInput(BaseModel):
    program_id: Id = Field(description="Program id")
    source_kind: SourceKind = Field(description="ics, syllabus, timetable_image or text")
    target: SessionTarget = Field(description="Wizard, a term or a course")
    upload_ids: list[Id] = Field(
        default_factory=list, max_length=20, description="Files from POST /imports/uploads"
    )
    file_item_ids: list[Id] = Field(
        default_factory=list, max_length=20, description="Existing course files (M07)"
    )
    attachment_ids: list[Id] = Field(
        default_factory=list,
        max_length=10,
        description=(
            "Files the user attached to the assistant conversation (the id of an <attachment> "
            "block); the importer reads the original file"
        ),
    )
    text: Annotated[str, Field(max_length=100_000)] | None = Field(
        default=None, description="Only for source_kind `text`: text the user pasted"
    )
    source_meta: dict[str, Any] = Field(
        default_factory=dict,
        description=(
            "Extra source info, e.g. {provider, connection_id}; {only: 'course_info'} keeps "
            "just the field changes of the target course"
        ),
    )


class SessionRef(BaseModel):
    session_id: Id = Field(description="Import session id")


class SessionListInput(BaseModel):
    program_id: Id = Field(description="Program id")
    cursor: str | None = Field(default=None, description="`next_cursor` of the previous page")
    limit: Annotated[int, Field(ge=1, le=100)] = Field(default=50, description="Page size")


class ItemUpdateInput(BaseModel):
    session_id: Id = Field(description="Import session id")
    item_id: Id = Field(description="Item id")
    data: dict[str, Any] | None = Field(
        default=None, description="Fields to change; merged into the item's data"
    )
    decision: Decision | None = Field(default=None, description="accept, reject or pending")
    type: Literal["assessment", "task"] | None = Field(
        default=None, description="Turn an assessment item into a task or back"
    )


class BulkDecideInput(BaseModel):
    session_id: Id = Field(description="Import session id")
    decision: Literal["accept", "reject"] = Field(description="Decision to apply")
    types: list[ItemType] | None = Field(default=None, description="Only items of these types")
    issue_codes: list[str] | None = Field(
        default=None, description="Only items with one of these issues"
    )
    item_ids: list[Id] | None = Field(default=None, description="Only these items")


class BulkDecideResult(BaseModel):
    changed: int
    session: ImportSessionDetail


class NewItem(BaseModel):
    key: Annotated[str, Field(max_length=64)] | None = Field(
        default=None,
        description="Local key; other new items refer to it as `item:<key>` in course_ref",
    )
    type: ItemType = Field(description="Item type")
    data: dict[str, Any] = Field(description="The type's fields")
    evidence: dict[str, Evidence] = Field(default_factory=dict, description="Per-field source")
    confidence: dict[str, Confidence] = Field(default_factory=dict, description="Per-field")
    decision: Decision = Field(default="accept", description="Initial decision")


# --- `imports.items.add`: one schema per item type, unknown fields refused ------------------


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CourseFields(CourseData, _Strict):
    pass


class CoursePatchFields(CoursePatchData, _Strict):
    pass


class MeetingFields(MeetingData, _Strict):
    pass


class EventFields(EventData, _Strict):
    pass


class CategoryFields(CategoryData, _Strict):
    pass


class AssessmentFields(AssessmentData, _Strict):
    pass


class TaskFields(TaskData, _Strict):
    pass


class _AddedItem(_Strict):
    key: Annotated[str, Field(pattern=r"^[A-Za-z0-9-]{1,64}$")] | None = Field(
        default=None,
        description="Local key (letters, digits, -); other new items refer to it as "
        "`item:<key>` in course_ref / category_ref",
    )
    confidence: dict[str, Confidence] = Field(
        default_factory=dict, description="Per field; mark guesses low so the user checks them"
    )
    decision: Decision = Field(default="accept", description="Initial decision")


class AddedCourse(_AddedItem):
    type: Literal["course"] = Field(description="A new course")
    data: CourseFields = Field(description="Course fields")


class AddedCoursePatch(_AddedItem):
    type: Literal["course_patch"] = Field(description="Changes to an existing course")
    data: CoursePatchFields = Field(description="Course id and the changed fields")


class AddedMeeting(_AddedItem):
    type: Literal["meeting"] = Field(description="A weekly class time of a course section")
    data: MeetingFields = Field(
        description="weekday 1 = Monday; weeks as start_week/end_week or first_date/last_date; "
        "exceptions = cancelled dates"
    )


class AddedEvent(_AddedItem):
    type: Literal["event"] = Field(description="A one-off calendar event (exam, no class, ...)")
    data: EventFields = Field(description="Event fields")


class AddedCategory(_AddedItem):
    type: Literal["category"] = Field(description="A grading category of a course")
    data: CategoryFields = Field(description="Category fields")


class AddedAssessment(_AddedItem):
    type: Literal["assessment"] = Field(description="A graded assessment of a course")
    data: AssessmentFields = Field(description="weight in percent of the course grade")


class AddedTask(_AddedItem):
    type: Literal["task"] = Field(description="A to-do item")
    data: TaskFields = Field(description="Task fields")


AddedItem = Annotated[
    AddedCourse
    | AddedCoursePatch
    | AddedMeeting
    | AddedEvent
    | AddedCategory
    | AddedAssessment
    | AddedTask,
    Field(discriminator="type"),
]


class ItemsAddInput(BaseModel):
    session_id: Id = Field(description="Import session id")
    items: list[AddedItem] = Field(
        min_length=1, max_length=500, description="Items to append, each with its type's fields"
    )
    ready: bool = Field(default=True, description="Mark the session ready for review")


class WizardCourse(BaseModel):
    item_id: Id = Field(description="Course item of the session")
    course_id: Id = Field(description="Course the wizard created from it")


class CommitInput(BaseModel):
    session_id: Id = Field(description="Import session id")
    wizard_courses: list[WizardCourse] | None = Field(
        default=None,
        description="Term wizard: the courses it created from the session's course items",
    )
    item_ids: list[Id] | None = Field(
        default=None, description="Retry only these items (failed ones); default: all accepted"
    )


class CommitResult(BaseModel):
    session: ImportSessionDetail
    created: int
    updated: int
    failed: int
