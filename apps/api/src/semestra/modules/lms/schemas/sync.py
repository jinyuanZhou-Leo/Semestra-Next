"""Inputs and outputs of the sync capabilities (M09 §4.1)."""

from datetime import datetime
from typing import Any, Literal, Self

from pydantic import BaseModel, Field, model_validator

from semestra.modules.academics.schemas import Id
from semestra.modules.lms.models import MaterialChange
from semestra.modules.lms.settings import SyncInterval

# The stages a Refresh may ask for alone (the course stage always runs first).
RefreshStage = Literal["assignments", "announcements"]


class SyncRequestInput(BaseModel):
    program_id: Id = Field(description="Program id")
    course_id: Id | None = Field(default=None, description="Only this course of the Program")
    force: bool = Field(
        default=False,
        description="Sync even the courses synced in the last half hour (the user asked)",
    )
    stages: list[RefreshStage] | None = Field(
        default=None,
        description="Only these stages of the course (`course_id` required): the Refresh of "
        "what the app keeps of it (its assignments, its announcements)",
    )

    @model_validator(mode="after")
    def _stages_of_one_course(self) -> Self:
        if self.stages is not None and self.course_id is None:
            raise ValueError("stages need course_id")
        return self


class SyncQueued(BaseModel):
    queued: int = Field(description="How many courses were queued")


SyncField = Literal["title", "due_at", "weight", "score", "dropped"]


class SyncConflict(BaseModel):
    field: SyncField
    mine: Any = Field(description="The value in Semestra")
    platform: Any = Field(description="The value on the platform")
    edited: bool = Field(
        description="Changed in Semestra too; otherwise asked only because the user turned off "
        "following this field (settings `lms.follow_*`)"
    )


SyncItemKind = Literal["new", "conflict", "removed"]


class SyncItem(BaseModel):
    """Something the sync asks the user about, or a new item the user ignored."""

    id: str
    course_id: str
    course: str = Field(description="The course's code or title")
    kind: SyncItemKind = Field(
        description="new: not imported yet; conflict: the user and the platform both changed "
        "it; removed: imported, gone from the platform"
    )
    external_id: str
    title: str
    due_at: datetime | None = None
    conflicts: list[SyncConflict] = []


class SyncChange(BaseModel):
    """A recent update of an imported item: a field the sync changed (`kind` field: `old` and
    `new` are its values) or new feedback on it (`kind` feedback: `new` is
    `{comments: <how many new>, rubric: <assessed for the first time>}`, never put back)."""

    id: str
    kind: Literal["field", "feedback"]
    course_id: str
    course: str
    title: str
    field: str
    old: Any
    new: Any
    target_kind: Literal["assessment", "task"]
    target_id: str
    external_id: str = Field(description="The assignment's id on the platform")
    at: datetime
    reverted: bool
    toggleable: bool = Field(
        description="Can be put back, or applied again once put back: the newest change of its "
        "field, the field not changed since"
    )


class SyncDifference(BaseModel):
    """A field of an imported item the user set apart from the platform, not asked about: it
    stays the user's until the platform changes it or the user takes the platform's value."""

    id: str = Field(description="The item's id")
    course_id: str
    course: str
    title: str = Field(description="The item's title on the platform")
    field: SyncField
    mine: Any = Field(description="The value in Semestra")
    platform: Any = Field(description="The value on the platform when last synced")
    out_of_range: bool = Field(
        default=False,
        description="The platform's value is out of what the item takes, so it can't be taken",
    )
    target_kind: Literal["assessment", "task"]
    target_id: str


class SyncMaterialChange(BaseModel):
    """What the platform did lately to a course material (the files stage)."""

    id: str = Field(description="The material's id")
    course_id: str
    course: str
    title: str = Field(description="Its name on the platform")
    change: MaterialChange = Field(
        description="added: new in the course's files; duplicate: new, with the name and size "
        "of a file the user had put in the course already; updated: its contents changed; gone: "
        "deleted on the platform, so removed here (it was read online); handed_over: deleted on "
        "the platform, kept as the user's own file (it had a local copy)"
    )
    at: datetime
    item_id: str | None = Field(description="The course file it is now, if any")
    folder_id: str | None
    folder: str | None = Field(description="The name of the folder it is in")


class SyncRemovedMaterial(BaseModel):
    """A material the user deleted from the course's files: not brought back until restored."""

    id: str = Field(description="The material's id")
    course_id: str
    course: str
    title: str
    at: datetime = Field(description="When the user deleted it")


class SyncUnreadable(BaseModel):
    """What the platform did not give, kept as last read until it reads back (M09 表 5c, rows
    5-9): parts of a course not read for one reason, an area the teacher closed, an item in
    Semestra whose own read did not get it."""

    kind: Literal["parts", "area", "material", "assignment"]
    id: str | None = Field(
        default=None,
        description="The material's id (`material`) or the imported assignment's sync item id "
        "(`assignment`); none for a course's row",
    )
    course_id: str
    course: str
    parts: list[str] = Field(
        default_factory=list,
        description="`parts`: the parts not read (course, assignments, submissions, quizzes, "
        "total, announcements, calendar, files, pages, modules); `course` among them: the whole "
        "course",
    )
    area: str | None = Field(
        default=None,
        description="`area`: the closed area; an item: the area it belongs to",
    )
    title: str | None = Field(default=None, description="An item's name on the platform")
    count: int = Field(
        default=0,
        description="`area`: announcements kept, or assignments not imported (0: none counted)",
    )
    code: str | None = Field(default=None, description="Why it was not read (an error code)")
    params: dict[str, Any] = Field(default_factory=dict, description="The code's params")
    since: datetime | None = Field(
        default=None,
        description="`parts`: when they last read back; `area`: what is kept is as of then; an "
        "item: unreadable since then. None: never read",
    )
    item_id: str | None = Field(
        default=None, description="A material's course file, or an imported assignment's object"
    )
    external_id: str | None = Field(default=None, description="An assignment's id on the platform")
    removable: bool = Field(
        default=False,
        description="A followed material read from the platform (no copy saved in Semestra) the "
        "platform refuses or hides: it can be removed (lms.sync.material.remove)",
    )


class SyncProblemItem(BaseModel):
    kind: str = Field(
        description="assignment, announcement, calendar_event, file, page, link or course"
    )
    external_id: str
    title: str | None


class SyncProblem(BaseModel):
    """A problem of Semestra's own in a course's last sync (M09 表 5c, rows 2-4): it comes
    back every round until fixed; `request_id` finds it in the server's log."""

    course_id: str
    course: str
    stage: str
    ended: bool = Field(description="The course was not synced at all this round")
    code: str
    request_id: str
    items: list[SyncProblemItem] = Field(description="Items not synced")
    reads: list[str] = Field(description="Parts of the course not read")


class SyncRound(BaseModel):
    """The courses of a sync the user asked for ("Sync now"), while it runs."""

    done: int = Field(description="Courses synced so far")
    total: int = Field(description="Courses in this sync")


class SyncStatus(BaseModel):
    program_id: str
    provider: str | None = Field(description="The bound connection's provider, if any")
    connection_name: str | None
    connection_error: str | None = Field(description="Why the connection does not work")
    every: SyncInterval = Field(description="How often courses sync in the background")
    courses: int = Field(description="How many courses sync")
    synced_at: datetime | None = Field(description="When the least recently synced one synced")
    syncing: bool
    round: SyncRound | None = Field(
        default=None, description="Progress of a sync the user asked for, while it runs"
    )
    pending: list[SyncItem] = Field(description="What waits for the user, newest first")
    ignored: list[SyncItem]
    recent: list[SyncChange] = Field(description="What the sync changed lately, newest first")
    different: list[SyncDifference] = Field(
        description="Fields the user set apart from the platform, by course and title"
    )
    materials: list[SyncMaterialChange] = Field(
        description="What the platform did lately to the course materials, newest first"
    )
    removed_materials: list[SyncRemovedMaterial] = Field(
        description="Materials the user deleted, newest first (at most 50), where the course's"
        " materials sync"
    )
    removed_count: int = Field(description="How many materials the user deleted, all told")
    unreadable: list[SyncUnreadable] = Field(
        description="What the platform did not give, kept as last read, by course"
    )
    problems: list[SyncProblem] = Field(
        description="Problems of Semestra's own in the courses' last sync, by course"
    )
    calendar_waiting: int = Field(
        description="Courses whose calendar the sync has not read yet (M09 §4.8)"
    )
    calendar_unreadable: int = Field(
        description="Courses whose calendar the sync tried and never could read"
    )


class SyncResolveInput(BaseModel):
    item_id: Id = Field(description="An item gone from the platform")
    choice: Literal["delete", "keep"] = Field(
        description="delete it here, or keep it as made by hand"
    )


class SyncDismissInput(BaseModel):
    program_id: Id = Field(description="Program id")
    assignment_ids: list[Id] = Field(
        min_length=1,
        max_length=200,
        description="New assignments, by their id in the mirror (`SyncNew.assignment_id`)",
    )
    dismissed: bool = Field(default=True, description="False offers them again")


class SyncFieldResolveInput(BaseModel):
    item_id: Id = Field(description="An imported item's id")
    field: SyncField = Field(description="A field asked about, or listed in `different`")
    choice: Literal["platform", "mine"] = Field(
        description="platform takes the platform's value; mine keeps the user's (asked-about "
        "fields only)"
    )


class SyncChangeRef(BaseModel):
    change_id: Id = Field(description="A recent change's id")


class MaterialRef(BaseModel):
    material_id: Id = Field(description="A material's id (lms.sync.status)")
