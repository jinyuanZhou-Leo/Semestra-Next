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
    different: list[SyncDifference] = Field(
        description="Fields the user set apart from the platform, by course and title"
    )
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
