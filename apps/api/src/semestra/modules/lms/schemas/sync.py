"""Inputs and outputs of the sync capabilities (M09 §4.1)."""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from semestra.modules.academics.schemas import Id
from semestra.modules.lms.settings import SyncInterval


class SyncRequestInput(BaseModel):
    program_id: Id = Field(description="Program id")
    course_id: Id | None = Field(default=None, description="Only this course of the Program")
    force: bool = Field(
        default=False,
        description="Sync even the courses synced in the last half hour (the user asked)",
    )


class SyncQueued(BaseModel):
    queued: int = Field(description="How many courses were queued")


SyncField = Literal["title", "due_at", "weight", "score"]


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
    target_kind: Literal["assessment", "task"]
    target_id: str


class SyncMaterialChange(BaseModel):
    """What the platform did lately to a course material (the files stage)."""

    id: str = Field(description="The material's id")
    course_id: str
    course: str
    title: str = Field(description="Its name on the platform")
    change: Literal["added", "duplicate", "updated", "gone", "handed_over"] = Field(
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


class SyncCourseError(BaseModel):
    course_id: str
    course: str
    stage: str
    code: str


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
    errors: list[SyncCourseError]


class SyncResolveInput(BaseModel):
    item_id: Id = Field(description="An item gone from the platform")
    choice: Literal["delete", "keep"] = Field(
        description="delete it here, or keep it as made by hand"
    )


class SyncDismissInput(BaseModel):
    program_id: Id = Field(description="Program id")
    item_ids: list[Id] = Field(min_length=1, max_length=200, description="New items")
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
    material_id: Id = Field(description="A removed material's id (lms.sync.status)")
