"""What the platform answered, normalized (M09 §4.1, table 2). Shared code only knows these:

- one item: `Present`, `Gone` or `Unavailable` (`ItemAnswer`);
- a list of one area of the course: `AreaResult`.

The provider maps its platform's answers onto them (`LmsProvider.item_answer`, `.area_answer`);
the HTTP statuses and the provider's own codes for them never reach the shared code.
"""

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any, Literal


@dataclass(frozen=True)
class Present:
    """The user can see it on the platform (a locked one too)."""

    data: Any = None


@dataclass(frozen=True)
class Gone:
    """The user can no longer see it on the platform: deleted, unpublished, hidden from them."""


@dataclass(frozen=True)
class Unavailable:
    """Nothing can be told: the platform did not answer, or its answer may be about the whole
    area rather than this item. `reason` is the error code (M09 §9)."""

    reason: str
    params: dict[str, Any] = field(default_factory=lambda: {})


ItemAnswer = Present | Gone | Unavailable
ItemResult = Literal["present", "gone", "unavailable"]

AreaResult = Literal["whole", "partial", "hidden", "unavailable", "unsupported"]
"""One area's list this round: read whole; cut short (paged past the limit); closed to the user
(the course's navigation leaves it out or hides it); not known; not offered by the provider."""

AREA_HIDDEN = "lms.area_hidden"
"""The reason of an item's `Unavailable` when its area was closed this round (table 2, row 6)."""

# What an item belongs to, by its kind only (where it is listed or linked from does not count):
# a file linked from an open module still belongs to the files area. The areas are the kinds of
# the course's navigation (`dto.NavKind`).
AREA_OF: dict[str, str] = {
    "file": "files",
    "folder": "files",
    "page": "pages",
    "syllabus": "syllabus",
    "link": "modules",
    "external_url": "modules",
    "external_tool": "modules",
    "module": "modules",
    "assignment": "assignments",
    "quiz": "quizzes",
    "discussion": "discussions",
    "announcement": "announcements",
}

# Areas that are no tab of the course's navigation: a refused list of one is never the
# instructor closing it (`hidden`), only not known (table 2, row 17).
OFF_NAV: frozenset[str] = frozenset(("calendar",))

# Answers that say the connection or the platform is out for now, not anything about the item
# or area read: the stage stops (nothing is changed) and the next round reads again.
STOPPING = frozenset(
    (
        "lms.rate_limited",
        "lms.unreachable",
        "lms.invalid_credentials",
        "lms.invalid_config",
        "lms.credentials_missing",
        "lms.blocked_address",
    )
)


def result_of(answer: ItemAnswer) -> ItemResult:
    if isinstance(answer, Present):
        return "present"
    if isinstance(answer, Gone):
        return "gone"
    return "unavailable"


def nav_closed(navigation: Sequence[Any] | None, area: str) -> bool | None:
    """Whether the course's navigation leaves `area` out or hides it (table 2, rows 7-8): only
    then is a refused list of it the instructor's doing. None when there is no navigation to tell
    by (not read, or the provider has none)."""
    if not navigation:
        return None
    return not any(t.kind == area and not t.hidden for t in navigation)
