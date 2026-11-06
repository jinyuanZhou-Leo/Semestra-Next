"""Canvas tab plugin (M16): frontend only, it reads everything through the core `lms.*`
capabilities (M09). This package only declares its account setting."""

from typing import Literal

from pydantic import BaseModel, Field

from semestra.modules.settings import register_settings


class CanvasTabSettings(BaseModel):
    display: Literal["simplified", "original"] = Field(
        default="simplified",
        description="How Canvas pages, announcements, assignments and the syllabus are shown",
    )


register_settings(
    namespace="plugin.canvas-tab",
    schema=CanvasTabSettings,
    levels=("account",),
    plugin_id="canvas-tab",
)
