"""How Canvas's answers map onto the shared results (M09 §4.1, table 2). The HTTP layer
(`provider._map_status`) already turned each status into a code: 404 into `lms.not_found`; a 401
without `WWW-Authenticate` and a 403 that is not throttling into `lms.forbidden`. What those two
mean depends on whether the area was closed this round, which the caller tells from the course's
navigation."""

from typing import Literal

from semestra.core.errors import AppError
from semestra.modules.lms.answers import AREA_HIDDEN, Gone, Unavailable

# Canvas's refusals of a list: a hidden tab answers 404 (`tab_enabled?`), hidden files 401.
REFUSALS = frozenset(("lms.not_found", "lms.forbidden"))


def item_answer(error: AppError, *, area_hidden: bool) -> Gone | Unavailable:
    """One item read (table 2, rows 4-6 and 11-14). 404: deleted, or unpublished for students.
    Refused: unpublished or hidden from the user, unless its area is closed this round: then it
    cannot be told whether the item or the whole area is refused (row 6, to check against the
    recorded answers)."""
    if error.code == "lms.not_found":
        return Gone()
    if error.code == "lms.forbidden":
        return Unavailable(AREA_HIDDEN) if area_hidden else Gone()
    return Unavailable(error.code, dict(error.params))


def area_answer(error: AppError, *, nav_closed: bool | None) -> Literal["hidden", "unavailable"]:
    """A refused list of an area (table 2, rows 7-8): the instructor closed it when the course's
    navigation leaves it out or hides it this round (`nav_closed`); else, or when the navigation
    could not be read (None), not known."""
    return "hidden" if error.code in REFUSALS and nav_closed is True else "unavailable"
