"""Where in the app a provider's course content opens (M09 §8). A provider's own plugin (the
Canvas tab for Canvas) registers its course page here; shared code (notifications) asks this
registry instead of knowing any plugin, and falls back to the course page when the plugin is not
installed or the provider has none."""

from collections.abc import Callable
from dataclasses import dataclass
from urllib.parse import urlencode

from semestra.core.context import Ctx
from semestra.modules.lms import service
from semestra.modules.plugins import service as plugins


@dataclass(frozen=True)
class CoursePage:
    plugin_id: str
    # The path under the course page (`/p/<program>/c/<course>/`) showing the course's
    # announcements, or the one with this external id.
    announcements: Callable[[str | None], str]


_pages: dict[str, CoursePage] = {}


def register_course_page(provider: str, page: CoursePage) -> None:
    _pages[provider] = page


async def announcements_path(ctx: Ctx, course_id: str, external_id: str | None) -> str | None:
    """The path under the course page that shows its announcements (one of them when
    `external_id` is given); None when no installed plugin shows them."""
    link = await service.link_row(ctx, course_id)
    if link is None:
        return None
    connection = await service.get_connection_row(ctx, link.connection_id)
    page = _pages.get(connection.provider)
    if page is None or not await plugins.is_installed(ctx, page.plugin_id):
        return None
    return page.announcements(external_id)


def assignment_path(program_id: str, course_id: str, assignment_id: str) -> str:
    """The app's address of an assignment's details (M09 §7.3): they open over any page, here
    over its course's. `assignment_id` is the platform's id, or `quiz:<id>` for a quiz."""
    opens = urlencode({"assignment": f"{course_id}:{assignment_id}"})
    return f"/p/{program_id}/c/{course_id}?{opens}"
