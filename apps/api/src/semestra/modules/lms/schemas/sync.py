"""Inputs and outputs of the sync capabilities (M09 §4.8)."""

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


class SyncConflict(BaseModel):
    field: str = Field(description="title, due_at, weight or score")
    mine: Any = Field(description="The value in Semestra")
    platform: Any = Field(description="The value on the platform")


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
    """A field the sync changed on an imported item."""

    id: str
    course_id: str
    course: str
    title: str
    field: str
    old: Any
    new: Any
    at: datetime
    reverted: bool


class SyncCourseError(BaseModel):
    course_id: str
    course: str
    stage: str
    code: str


class SyncStatus(BaseModel):
    program_id: str
    provider: str | None = Field(description="The bound connection's provider, if any")
    connection_name: str | None
    connection_error: str | None = Field(description="Why the connection does not work")
    every: SyncInterval = Field(description="How often courses sync in the background")
    courses: int = Field(description="How many courses sync")
    synced_at: datetime | None = Field(description="When the least recently synced one synced")
    syncing: bool
    pending: list[SyncItem] = Field(description="What waits for the user, newest first")
    ignored: list[SyncItem]
    recent: list[SyncChange] = Field(description="What the sync changed lately, newest first")
    errors: list[SyncCourseError]


class SyncResolveInput(BaseModel):
    item_id: Id = Field(description="A pending item's id (conflict or removed)")
    choice: Literal["platform", "mine", "delete", "keep"] = Field(
        description="conflict: platform or mine; removed: delete or keep"
    )


class SyncDismissInput(BaseModel):
    program_id: Id = Field(description="Program id")
    item_ids: list[Id] = Field(min_length=1, max_length=200, description="New items")
    dismissed: bool = Field(default=True, description="False offers them again")


class SyncChangeRef(BaseModel):
    change_id: Id = Field(description="A recent change's id")
