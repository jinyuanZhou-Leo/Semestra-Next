"""Where in the app a platform's course content opens (M09 §8), for links made on the server
(notifications, Sem's `app_url`)."""

from urllib.parse import quote, urlencode


def announcements_path(course_id: str, external_id: str | None) -> str:
    """The path under the course page (`/p/<program>/c/<course>/`) of its announcements, with the
    one of this external id open when it is given."""
    if external_id is None:
        return "announcements"
    return f"announcements?post={quote(f'{course_id}:{external_id}', safe='')}"


def assignment_path(program_id: str, course_id: str, assignment_id: str) -> str:
    """The app's address of an assignment's details (M09 §7.3): they open over any page, here
    over its course's. `assignment_id` is the platform's id, or `quiz:<id>` for a quiz."""
    opens = urlencode({"assignment": f"{course_id}:{assignment_id}"})
    return f"/p/{program_id}/c/{course_id}?{opens}"
