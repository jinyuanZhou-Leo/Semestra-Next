"""The `files` settings namespace (M07 §6.4, M11): whether new course files are indexed."""

from pydantic import BaseModel, Field

from semestra.core.context import Ctx
from semestra.modules.settings import register_settings
from semestra.modules.settings import service as settings_service


class FilesSettings(BaseModel):
    auto_index: bool = Field(
        default=True,
        description="Read and index new files as they are added (search, Sem, scanned pages)",
    )


register_settings(namespace="files", schema=FilesSettings, levels=("program", "course"))


async def auto_index(ctx: Ctx, course_id: str) -> bool:
    resolved = await settings_service.get_values(ctx, "files", "course", course_id)
    return bool(resolved.values["auto_index"])
