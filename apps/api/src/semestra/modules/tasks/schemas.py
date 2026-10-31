from datetime import date, datetime, time
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints

Id = Annotated[str, Field(min_length=1, max_length=64)]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]
Priority = Literal["none", "low", "medium", "high", "urgent"]
SourceKind = Literal["assessment", "lms", "syllabus", "agent", "manual"]
View = Literal["today", "scheduled", "all", "completed", "inbox", "flagged"]
Sort = Literal["manual", "due", "priority", "created", "title"]


class ProgramRef(BaseModel):
    program_id: Id = Field(description="Program id")


class TaskRef(BaseModel):
    task_id: Id = Field(description="Task id")


class TaskDeleted(BaseModel):
    ok: bool = True


# --- lists ----------------------------------------------------------------------------------


class TaskList(BaseModel):
    id: str
    program_id: str
    term_id: str | None = Field(description="Null for a list shared by every term of the Program")
    name: str
    color: str | None
    icon: str | None
    position: int
    created_at: datetime
    updated_at: datetime


class TaskListOut(BaseModel):
    items: list[TaskList]


class TaskListCreateInput(BaseModel):
    program_id: Id = Field(description="Program id")
    name: Name = Field(description="List name, unique within its term (or Program-wide)")
    term_id: Id | None = Field(
        default=None, description="Term the list belongs to; omit for a Program-wide list"
    )
    color: Annotated[str, Field(max_length=40)] | None = Field(default=None, description="Color")
    icon: Annotated[str, Field(max_length=40)] | None = Field(default=None, description="Icon")


class TaskListUpdateInput(BaseModel):
    list_id: Id = Field(description="List id")
    name: Name | None = Field(default=None, description="New name")
    color: Annotated[str, Field(max_length=40)] | None = Field(default=None, description="Color")
    icon: Annotated[str, Field(max_length=40)] | None = Field(default=None, description="Icon")


class TaskListDeleteInput(BaseModel):
    list_id: Id = Field(description="List id")
    delete_tasks: bool = Field(
        default=False,
        description="Delete the list's tasks too; by default they move to the inbox",
    )


class TaskListDeleteResult(BaseModel):
    deleted_task_count: int
    moved_task_count: int


class TaskListOrderInput(BaseModel):
    program_id: Id = Field(description="Program id")
    list_ids: list[Id] = Field(
        max_length=200, description="List ids in the new display order (lists not named go last)"
    )


# --- tasks ----------------------------------------------------------------------------------


class Task(BaseModel):
    id: str
    program_id: str
    term_id: str | None
    course_id: str | None
    list_id: str | None = Field(description="Null for the Program's inbox")
    title: str
    notes: str
    due_date: date | None
    due_time: time | None = Field(description="Wall-clock time in the Program's time zone")
    priority: Priority
    flagged: bool
    completed_at: datetime | None
    overdue: bool = Field(description="Unfinished and past its due moment (Program time zone)")
    position: float
    source_kind: SourceKind | None
    source_ref: str | None
    created_at: datetime
    updated_at: datetime


TaskField = Literal[
    "program_id",
    "term_id",
    "course_id",
    "list_id",
    "title",
    "notes",
    "due_date",
    "due_time",
    "priority",
    "flagged",
    "completed_at",
    "overdue",
    "position",
    "source_kind",
    "source_ref",
    "created_at",
    "updated_at",
]


class TaskFields(BaseModel):
    title: Title = Field(description="What to do")
    notes: Annotated[str, Field(max_length=20_000)] = Field(default="", description="Notes")
    due_date: date | None = Field(default=None, description="Due date (Program time zone)")
    due_time: time | None = Field(
        default=None, description="Due time of day; needs a due date. Seconds are dropped."
    )
    priority: Priority | None = Field(
        default=None, description="Priority; omit for the Program's default"
    )
    flagged: bool = Field(default=False, description="Flag the task")
    term_id: Id | None = Field(
        default=None, description="Term; inferred from the course and due date when omitted"
    )
    course_id: Id | None = Field(default=None, description="Course the task is for")
    list_id: Id | None = Field(default=None, description="List; omit for the inbox")
    source_kind: SourceKind = Field(
        default="manual",
        description="Where the task came from. The assistant may only use agent (its default), "
        "syllabus or manual; assessment and lms tasks are made by the app itself",
    )
    source_ref: Annotated[str, Field(max_length=200)] | None = Field(
        default=None, description="Id of the source item; makes batch imports idempotent"
    )


class TaskCreateInput(TaskFields):
    program_id: Id = Field(description="Program id")


class TaskCreateManyInput(BaseModel):
    program_id: Id = Field(description="Program id")
    items: list[TaskFields] = Field(min_length=1, max_length=200, description="Tasks to create")


class TaskSkipped(BaseModel):
    index: int
    task_id: str = Field(description="The existing task with the same source")


class TaskCreateManyResult(BaseModel):
    created: list[Task]
    skipped: list[TaskSkipped]


class TaskUpdateInput(BaseModel):
    """Only the fields that are sent change; nullable fields accept null."""

    task_id: Id = Field(description="Task id")
    title: Title | None = Field(default=None, description="Title")
    notes: Annotated[str, Field(max_length=20_000)] | None = Field(
        default=None, description="Notes"
    )
    due_date: date | None = Field(default=None, description="Due date; null clears date and time")
    due_time: time | None = Field(default=None, description="Due time; null clears it")
    priority: Priority | None = Field(default=None, description="Priority")
    flagged: bool | None = Field(default=None, description="Flag")
    term_id: Id | None = Field(default=None, description="Term; null clears it")
    course_id: Id | None = Field(default=None, description="Course; null clears it")
    list_id: Id | None = Field(default=None, description="List; null moves to the inbox")


class TaskCompleteInput(BaseModel):
    task_id: Id = Field(description="Task id")
    completed: bool = Field(default=True, description="False reopens the task")


class TaskMoveInput(BaseModel):
    task_id: Id = Field(description="Task id")
    list_id: Id | None = Field(
        default=None, description="Target list (null = inbox); if not sent the list is unchanged"
    )
    before_task_id: Id | None = Field(
        default=None,
        description="Place the task before this one (same target list; from tasks.item.query); "
        "else last",
    )


class TaskQueryInput(BaseModel):
    program_id: Id = Field(description="Program id")
    view: View = Field(
        default="all",
        description="today = due today or overdue; scheduled = has a due date; all; completed; "
        "inbox = no list; flagged",
    )
    list_id: Id | None = Field(default=None, description="Only this list")
    term_id: Id | None = Field(
        default=None, description="Only this term's tasks and those that belong to no term"
    )
    course_id: Id | None = Field(default=None, description="Only this course")
    search: Annotated[str, Field(max_length=100)] | None = Field(
        default=None, description="Fuzzy match on title and notes"
    )
    due_from: date | None = Field(default=None, description="Due on or after this date")
    due_to: date | None = Field(default=None, description="Due on or before this date")
    completed: Literal["exclude", "include", "only"] = Field(
        default="exclude",
        description="Completed tasks the view would show: leave out, add, or return only them "
        "(ignored by the completed view)",
    )
    sort: Sort = Field(default="manual", description="Order of the result")
    fields: list[TaskField] | None = Field(
        default=None,
        description="Agent/MCP only: return just these fields of each task (and its id)",
    )
    cursor: str | None = Field(default=None, description="`next_cursor` of the previous page")
    limit: Annotated[int, Field(ge=1, le=500)] = Field(default=200, description="Page size")


class TaskPage(BaseModel):
    items: list[Task]
    next_cursor: str | None
    total: int = Field(description="How many tasks match, over all pages")


class TaskClearInput(BaseModel):
    program_id: Id = Field(description="Program id")
    list_id: Id | None = Field(default=None, description="Only completed tasks of this list")
    term_id: Id | None = Field(default=None, description="Only completed tasks of this term")
    course_id: Id | None = Field(default=None, description="Only completed tasks of this course")


class TaskClearResult(BaseModel):
    deleted: int


class TaskFindInput(BaseModel):
    query: Annotated[str, Field(min_length=1, max_length=100)] = Field(
        description="Words from the task's title, e.g. 'lab report'"
    )
    program_id: Id | None = Field(default=None, description="Program; defaults to the scope's")
    include_completed: bool = Field(default=False, description="Also search completed tasks")
    limit: Annotated[int, Field(ge=1, le=20)] = Field(default=5, description="Most candidates")


class TaskCandidate(BaseModel):
    task_id: str
    title: str
    course_id: str | None
    due_date: date | None
    completed: bool
    source_kind: SourceKind | None = Field(
        description="assessment: title, due date and course follow the assessment"
    )
    score: float


class TaskCandidates(BaseModel):
    items: list[TaskCandidate]


class TaskCountsInput(BaseModel):
    program_id: Id = Field(description="Program id")
    term_id: Id | None = Field(
        default=None, description="Only this term's tasks and those that belong to no term"
    )
    course_id: Id | None = Field(default=None, description="Only this course's tasks")


class TaskCounts(BaseModel):
    today: int = Field(description="Unfinished tasks due today or overdue")
    overdue: int
    scheduled: int
    all: int
    inbox: int
    flagged: int
    completed: int
    lists: dict[str, int] = Field(description="Unfinished tasks per list id")
    courses: dict[str, int] = Field(description="Unfinished tasks per course id")
