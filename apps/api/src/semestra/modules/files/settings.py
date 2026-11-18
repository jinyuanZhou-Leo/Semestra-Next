"""The `files` settings namespace (M07 §6.4, M11): whether new course files are indexed, and
whether the scanned pages of files synced from a source (M09's course materials) are read by the
user's AI provider."""

from pydantic import BaseModel, Field

from semestra.core.context import Ctx
from semestra.modules.settings import register_settings
from semestra.modules.settings import service as settings_service


class FilesSettings(BaseModel):
    auto_index: bool = Field(
        default=True,
        description="Read and index new files as they are added (search, Sem, scanned pages)",
    )
    synced_scans: bool = Field(
        default=False,
        description="Read the scanned pages of materials synced from the LMS with the AI "
        "provider (off: they are read when the user processes the file again)",
    )


# `synced_scans` is set with the LMS materials settings (the account's and each course's);
# `auto_index` at the Program and course.
register_settings(namespace="files", schema=FilesSettings, levels=("account", "program", "course"))


async def auto_index(ctx: Ctx, course_id: str) -> bool:
    resolved = await settings_service.get_values(ctx, "files", "course", course_id)
    return bool(resolved.values["auto_index"])


async def synced_scans(ctx: Ctx, course_id: str) -> bool:
    resolved = await settings_service.get_values(ctx, "files", "course", course_id)
    return bool(resolved.values["synced_scans"])
