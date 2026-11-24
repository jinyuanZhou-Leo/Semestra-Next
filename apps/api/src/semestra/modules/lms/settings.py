"""Account settings of the module (M11 namespace `lms`)."""

from datetime import timedelta
from typing import Any, Literal, get_args

from pydantic import BaseModel, Field

from semestra.core.config import Settings
from semestra.core.context import Ctx
from semestra.modules.settings import service as settings_service

SyncInterval = Literal["15m", "30m", "1h", "6h", "1d"]
INTERVALS: dict[str, timedelta] = {
    "15m": timedelta(minutes=15),
    "30m": timedelta(minutes=30),
    "1h": timedelta(hours=1),
    "6h": timedelta(hours=6),
    "1d": timedelta(days=1),
}
assert tuple(INTERVALS) == get_args(SyncInterval)


class LmsSettings(BaseModel):
    """`follow_<field>`: a change on the platform to that field of an imported assignment is
    applied without asking when the user has not changed it here; off, the sync asks first."""

    sync_every: SyncInterval = "6h"
    follow_title: bool = True
    follow_due_at: bool = True
    follow_weight: bool = True
    follow_score: bool = True
    complete_submitted: bool = Field(
        default=True,
        description="Finish an imported assignment's to-do when the platform shows it handed in",
    )
    allow_writes: bool = Field(
        default=False,
        description="Let Semestra change things on the platform (marking announcements read)",
    )
    display: Literal["simplified", "original"] = Field(
        default="simplified",
        description="How platform HTML (announcements, pages, assignment descriptions) is shown",
    )


def offered(settings: Settings, schema: dict[str, Any]) -> dict[str, Any]:
    """The settings form offers only the intervals this server allows (`lms_sync_min_interval`:
    a self-hosted server may sync every 15 minutes, the hosted one hourly at most)."""
    floor = INTERVALS[settings.lms_sync_min_interval]
    field = schema["properties"]["sync_every"]
    field["enum"] = [k for k in field["enum"] if INTERVALS[k] >= floor]
    if field.get("default") not in field["enum"]:
        field["default"] = field["enum"][0]
    return schema


async def account(ctx: Ctx) -> LmsSettings:
    resolved = await settings_service.get_values(ctx, "lms", "account", None)
    return LmsSettings.model_validate(resolved.values)


def followed(cfg: LmsSettings) -> frozenset[str]:
    """The fields the sync applies without asking when the user has not changed them."""
    return frozenset(
        name for name in ("title", "due_at", "weight", "score") if getattr(cfg, f"follow_{name}")
    )


def floor(ctx: Ctx) -> timedelta:
    """The server's shortest sync interval: no course syncs on its own more often."""
    return INTERVALS[ctx.settings.lms_sync_min_interval]


def interval(ctx: Ctx, cfg: LmsSettings) -> timedelta:
    """How often the user's courses are synced: their choice, never below the server's floor."""
    return max(INTERVALS[cfg.sync_every], floor(ctx))


async def writes_allowed(ctx: Ctx) -> bool:
    return (await account(ctx)).allow_writes


async def completes_submitted(ctx: Ctx) -> bool:
    return (await account(ctx)).complete_submitted


MaterialStore = Literal["online", "local"]


class MaterialSettings(BaseModel):
    """How a course's materials come in (M11 namespace `lms.materials`, account and course):
    the account's choice holds for every course unless a course sets its own."""

    sync: bool = Field(
        default=True,
        description="The sync brings the course's files, pages and links into its files",
    )
    store: MaterialStore = Field(
        default="online",
        description="online: read from the platform when opened (no storage); local: a local "
        "copy is kept, still updated by the platform, and saved as the user's own file when the "
        "platform deletes it or the course is unlinked",
    )
    announcement_attachments: bool = Field(
        default=True,
        description="Files attached to announcements come in too (M09 §4.6 table 4d row 7)",
    )
    calendar_links: bool = Field(
        default=True,
        description="Course files and pages linked from calendar event descriptions come in too",
    )
    entry_folders: bool = Field(
        default=True,
        description="Items found only through assignments, announcements or calendar events are "
        "first placed in folders named after them; off, at the top of the course's files",
    )


async def materials(ctx: Ctx, course_id: str) -> MaterialSettings:
    resolved = await settings_service.get_values(ctx, "lms.materials", "course", course_id)
    return MaterialSettings.model_validate(resolved.values)
