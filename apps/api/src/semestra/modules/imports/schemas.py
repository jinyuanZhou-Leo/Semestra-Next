"""Inputs, outputs and the per-type item data of imports (M08 §2, §5).

Item data are drafts: they may be incomplete (a date that could not be resolved), so the models
here are looser than the target capabilities' inputs. What a target refuses comes back as the
item's `result.error_code` on commit.
"""

from datetime import date, datetime, time
from typing import Annotated, Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic_core import PydanticCustomError

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
MAX_WAIT_SECONDS = 25

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


HELD = "Set by the app while the user switches the item's kind; leave it out"
SOURCE_REF = "Where the item came from (a UID, URL or page); repeats with the same value are merged"
COURSE_REF = (
    "`item:<key>` for a course item of this import, or `course:<id>` for an existing course"
)
TERM_REF = "`term:<id>`; leave it out for the import's term"


class CourseData(BaseModel):
    code: Annotated[str, Field(max_length=32)] | None = Field(
        default=None, description="Course code as the school writes it, e.g. CSC108H1"
    )
    title: Title = Field(description="Course name")
    alias: Annotated[str, Field(max_length=40)] | None = Field(
        default=None, description="Short name the user calls it"
    )
    credits: Credits | None = Field(default=None, description="Credits or units")
    instructors: list[Instructor] = Field(
        default_factory=list, max_length=20, description="Instructors"
    )
    description: Annotated[str, Field(max_length=5000)] | None = Field(
        default=None, description="Course description"
    )
    website_url: Annotated[str, Field(max_length=500)] | None = Field(
        default=None, description="Course website"
    )
    planned_terms: Annotated[int, Field(ge=1, le=6)] = Field(
        default=1, description="How many terms the course runs (2 for a full-year course)"
    )
    term_ids: list[Id] = Field(
        default_factory=list,
        max_length=6,
        description="Existing terms to link it to; empty means the import's term",
    )
    # ICS imports point their meetings at it instead.
    existing_course_id: Id | None = Field(
        default=None, description="An existing course with the same code, if any"
    )


class FieldChange(BaseModel):
    old: Any = Field(default=None, description="Current value")
    new: Any = Field(default=None, description="Proposed value")
    apply: bool = Field(default=True, description="Whether the change is applied on commit")


PatchField = Literal[
    "code", "title", "credits", "instructors", "description", "website_url", "planned_terms"
]


class CoursePatchData(BaseModel):
    course_id: Id = Field(description="The existing course")
    changes: dict[PatchField, FieldChange] = Field(description="Changed fields by name")


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
    course_ref: CourseRef = Field(description=COURSE_REF)
    term_ref: TermRef | None = Field(default=None, description=TERM_REF)
    section_code: Annotated[str, Field(max_length=32)] = Field(
        default="", description="Section, e.g. LEC0101"
    )
    type_code: Annotated[str, Field(min_length=1, max_length=8)] = Field(
        default="LEC", description="Class type code, e.g. LEC, TUT, PRA"
    )
    weekday: Annotated[int, Field(ge=1, le=7)] = Field(description="1 = Monday ... 7 = Sunday")
    start_time: time = Field(description="Local start time")
    end_time: time = Field(description="Local end time")
    recurrence: Literal["weekly", "biweekly"] = Field(default="weekly", description="Repeat")
    # Weeks are resolved from the dates on commit, when the term is known.
    start_week: Annotated[int, Field(ge=1, le=60)] | None = Field(
        default=None, description="First term week; or give first_date"
    )
    end_week: Annotated[int, Field(ge=1, le=60)] | None = Field(
        default=None, description="Last term week; or give last_date"
    )
    first_date: date | None = Field(default=None, description="Date of the first class")
    last_date: date | None = Field(default=None, description="Date of the last class")
    weeks_text: Text200 | None = Field(
        default=None, description="The weeks as the source wrote them, when they are irregular"
    )
    location: Text200 | None = Field(default=None, description="Room or place")
    instructor: Text200 | None = Field(default=None, description="Who teaches this section")
    source_ref: Annotated[str, Field(max_length=500)] | None = Field(
        default=None, description=SOURCE_REF
    )
    # Written as cancellations of the meeting on commit.
    exceptions: list[date] = Field(
        default_factory=list,
        max_length=200,
        description="Dates the class is cancelled; the term's break weeks are skipped anyway",
    )


class EventData(BaseModel):
    course_ref: CourseRef | None = Field(default=None, description=COURSE_REF)
    term_ref: TermRef | None = Field(default=None, description=TERM_REF)
    title: Title = Field(description="Event name")
    date: Day | None = Field(default=None, description="Local date")
    start_time: time | None = Field(default=None, description="Local start time")
    end_time: time | None = Field(default=None, description="Local end time")
    end_date: Day | None = Field(default=None, description="Last day, for events over several days")
    all_day: bool = Field(default=False, description="Whether it has no times")
    type_code: Annotated[str, Field(max_length=8)] | None = Field(
        default=None, description="Event type code of the Program, e.g. EXAM"
    )
    kind: Literal["exam", "deadline", "no_class", "other"] = Field(
        default="other", description="What the event is"
    )
    date_text: Text200 | None = Field(
        default=None, description="The date as the source wrote it, when it could not be resolved"
    )
    location: Text200 | None = Field(default=None, description="Room or place")
    source_ref: Annotated[str, Field(max_length=500)] | None = Field(
        default=None, description=SOURCE_REF
    )


class CategoryData(BaseModel):
    course_ref: CourseRef = Field(description=COURSE_REF)
    name: Title = Field(description="Category name, e.g. Quizzes")
    key: Annotated[str, Field(pattern=r"^[a-z0-9][a-z0-9_-]{0,31}$")] | None = Field(
        default=None, description="Short key assessments refer to as `key:<key>`"
    )
    # Only used to check the assessments.
    weight_total: Annotated[float, Field(ge=0, le=100)] | None = Field(
        default=None, description="Weight of the whole category in percent, per the syllabus"
    )


class AssessmentData(BaseModel):
    course_ref: CourseRef = Field(description=COURSE_REF)
    title: Title = Field(description="Assessment name")
    category_ref: CategoryRef | None = Field(
        default=None, description="`item:<key>` for a category item, or `key:<key>`"
    )
    weight: Annotated[float, Field(ge=0, le=100)] = Field(
        default=0, description="Weight in percent of the course grade"
    )
    due_date: date | None = Field(default=None, description="Local due date")
    due_time: time | None = Field(default=None, description="Local due time")
    due_text: Text200 | None = Field(
        default=None, description="The due date as the source wrote it, when it is unresolved"
    )
    note: Annotated[str, Field(max_length=2000)] | None = Field(default=None, description="Note")
    source_ref: Annotated[str, Field(max_length=200)] | None = Field(
        default=None, description=SOURCE_REF
    )
    # Fields of the other kind (M09).
    held: dict[str, Any] | None = Field(default=None, description=HELD)


class TaskData(BaseModel):
    course_ref: CourseRef | None = Field(default=None, description=COURSE_REF)
    title: Title = Field(description="Task title")
    due_date: date | None = Field(default=None, description="Local due date")
    due_time: time | None = Field(default=None, description="Local due time")
    due_text: Text200 | None = Field(
        default=None, description="The due date as the source wrote it, when it is unresolved"
    )
    priority: Literal["none", "low", "medium", "high"] = Field(
        default="none", description="Priority"
    )
    notes: Annotated[str, Field(max_length=2000)] | None = Field(default=None, description="Notes")
    source_ref: Annotated[str, Field(max_length=500)] | None = Field(
        default=None, description=SOURCE_REF
    )
    # Fields of the other kind (M09).
    held: dict[str, Any] | None = Field(default=None, description=HELD)


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


class SkippedException(BaseModel):
    date: str
    code: str = Field(description="Why it was not written, e.g. schedule.not_a_class_day")


class ItemResult(BaseModel):
    created_id: str | None = None
    updated_id: str | None = None
    # The target already had it (same source or same key); nothing was written.
    reused: bool = False
    error_code: str | None = None
    error_params: dict[str, Any] = Field(default_factory=dict)
    skipped_exceptions: list[SkippedException] = Field(
        default_factory=lambda: [],
        description="Cancelled dates of a meeting that were not written (a break week, a date "
        "outside the meeting's weeks); mention them when reporting the import",
    )


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
    kind: TargetKind = Field(
        description=(
            "Where the import goes: `term` or `course`; `term_wizard` is only for the app's "
            "new-term wizard"
        )
    )
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
    next_cursor: str | None = Field(
        default=None, description="More items: pass it as `cursor` to imports.session.get"
    )


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
    source_kind: SourceKind = Field(
        description="ics, syllabus, timetable_image, text, or agent for items you add yourself "
        "with imports.item.add_many"
    )
    target: SessionTarget = Field(description="A term or a course; agents cannot use the wizard")
    upload_ids: list[Id] = Field(
        default_factory=list,
        max_length=20,
        description="Files uploaded in the app; agents use attachment_ids or file_item_ids",
    )
    file_item_ids: list[Id] = Field(
        default_factory=list, max_length=20, description="Course files, from files.item.list"
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
    session_id: Id = Field(
        description="Import id, from imports.session.create or imports.session.list"
    )


ItemField = Literal[
    "session_id", "type", "data", "evidence", "confidence", "decision", "issues", "depends_on",
    "result", "position",
]  # fmt: skip


class SessionGetInput(BaseModel):
    session_id: Id = Field(
        description="Import id, from imports.session.create or imports.session.list"
    )
    item_ids: list[Id] | None = Field(
        default=None,
        max_length=500,
        description="Only these items (`items[].id` of imports.session.get)",
    )
    types: list[ItemType] | None = Field(default=None, description="Only items of these types")
    fields: list[ItemField] | None = Field(
        default=None,
        description=(
            "Agent/MCP only: return just these fields of each item (and its id); by default "
            "type, data, decision, issues and result"
        ),
    )
    cursor: str | None = Field(default=None, description="`next_cursor` of the previous page")
    limit: Annotated[int, Field(ge=1, le=500)] | None = Field(
        default=None, description="Items per page (agent/MCP default 25; HTTP: all)"
    )
    wait_seconds: Annotated[int, Field(ge=0, le=MAX_WAIT_SECONDS)] = Field(
        default=0,
        description="While the import is still extracting, wait up to this long for it to "
        "finish before answering",
    )


class SessionListInput(BaseModel):
    program_id: Id = Field(description="Program id")
    cursor: str | None = Field(default=None, description="`next_cursor` of the previous page")
    limit: Annotated[int, Field(ge=1, le=100)] = Field(default=50, description="Page size")


class ItemUpdateInput(BaseModel):
    session_id: Id = Field(
        description="Import id, from imports.session.create or imports.session.list"
    )
    item_id: Id = Field(description="Item id (`items[].id` of imports.session.get)")
    data: dict[str, Any] | None = Field(
        default=None, description="Fields to change; merged into the item's data"
    )
    decision: Decision | None = Field(default=None, description="accept, reject or pending")
    type: Literal["assessment", "task"] | None = Field(
        default=None, description="Turn an assessment item into a task or back"
    )


class BulkDecideInput(BaseModel):
    session_id: Id = Field(
        description="Import id, from imports.session.create or imports.session.list"
    )
    decision: Literal["accept", "reject"] = Field(description="Decision to apply")
    types: list[ItemType] | None = Field(default=None, description="Only items of these types")
    issue_codes: list[str] | None = Field(
        default=None, description="Only items with one of these issues"
    )
    item_ids: list[Id] | None = Field(
        default=None, description="Only these items (`items[].id` of imports.session.get)"
    )

    @model_validator(mode="after")
    def _some_filter(self) -> Self:
        # Without a filter every item of the import would change at once.
        if self.types is None and self.issue_codes is None and self.item_ids is None:
            raise PydanticCustomError("filter_required", "Give types, issue_codes or item_ids")
        return self


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


# --- `imports.item.add_many`: one schema per item type, unknown fields refused ------------------


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


class AssessmentPatchFields(AssessmentPatchData, _Strict):
    pass


class TaskPatchFields(TaskPatchData, _Strict):
    pass


# What `imports.item.update` checks a changed item against: the same strict models as add_many.
STRICT_MODELS: dict[str, type[BaseModel]] = {
    "course": CourseFields,
    "course_patch": CoursePatchFields,
    "assessment_patch": AssessmentPatchFields,
    "task_patch": TaskPatchFields,
    "meeting": MeetingFields,
    "event": EventFields,
    "category": CategoryFields,
    "assessment": AssessmentFields,
    "task": TaskFields,
}


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
    session_id: Id = Field(
        description="Import id, from imports.session.create or imports.session.list"
    )
    items: list[AddedItem] = Field(
        min_length=1, max_length=500, description="Items to append, each with its type's fields"
    )
    ready: bool = Field(default=True, description="Mark the session ready for review")


class WizardCourse(BaseModel):
    item_id: Id = Field(description="Course item of the session")
    course_id: Id = Field(description="Course the wizard created from it")


class CommitInput(BaseModel):
    session_id: Id = Field(
        description="Import id, from imports.session.create or imports.session.list"
    )
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
