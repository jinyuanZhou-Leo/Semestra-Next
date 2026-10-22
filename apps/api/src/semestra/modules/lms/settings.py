"""Account settings of the module (M11 namespace `lms`)."""

from pydantic import BaseModel, Field

from semestra.core.context import Ctx
from semestra.modules.settings import service as settings_service


class LmsSettings(BaseModel):
    allow_writes: bool = Field(
        default=False,
        description="Let Semestra change things on the platform (marking announcements read)",
    )


async def writes_allowed(ctx: Ctx) -> bool:
    resolved = await settings_service.get_values(ctx, "lms", "account", None)
    return LmsSettings.model_validate(resolved.values).allow_writes
