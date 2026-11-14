"""Canvas tab plugin (M16): frontend only, it reads everything through the core `lms.*`
capabilities (M09). This package declares its account setting and the course page that shows
a Canvas course's announcements (for notifications)."""

from typing import Literal
from urllib.parse import urlencode

from pydantic import BaseModel, Field

from semestra.modules.lms.pages import CoursePage, register_course_page
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


def _announcements(external_id: str | None) -> str:
    query = {"tab": "announcements"} | ({"ref": external_id} if external_id else {})
    return f"canvas?{urlencode(query)}"


register_course_page("canvas", CoursePage(plugin_id="canvas-tab", announcements=_announcements))
