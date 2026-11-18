"""Canvas tab plugin (M16): frontend only, it reads everything through the core `lms.*`
capabilities (M09). This package declares the course page that shows a Canvas course's
announcements (for notifications); how platform HTML is shown is the `lms` setting `display`."""

from urllib.parse import urlencode

from semestra.modules.lms.pages import CoursePage, register_course_page


def _announcements(external_id: str | None) -> str:
    query = {"tab": "announcements"} | ({"ref": external_id} if external_id else {})
    return f"canvas?{urlencode(query)}"


register_course_page("canvas", CoursePage(plugin_id="canvas-tab", announcements=_announcements))
