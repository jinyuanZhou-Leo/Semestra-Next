"""The type of what the rules leave in "general" (M09 §4.2), asked of the model (M06).

`materials.classify` decides from what an item says about itself and where it sits; when that
finds nothing, the model reads the same clues and picks one of the type folders. It only picks a
folder, so its answer is applied without a review (owner's decision). Nothing is sent that the
rules do not already read: titles, the kind of file, a link's host, the module and subheader,
the platform folder, the titles of the pages that list it.
"""

import json
from collections.abc import Mapping
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, Field

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules import ai
from semestra.modules.lms.materials import Clues, MaterialType

# What a type holds, for the model (the folders' names are the user's language's, not these).
TYPES: dict[MaterialType, str] = {
    "lectures": "lecture slides, lecture notes, chapter notes",
    "tutorials": "tutorial and lab handouts, lab manuals, recitation material",
    "problems": "problem sets, homework, exercises, practice questions, their solutions",
    "exams": "past exams, midterms, finals, term tests, their solutions",
    "recordings": "lecture recordings and other videos",
    "readings": "textbook chapters, articles, papers, reference material",
    "general": "anything else (course logistics, schedules, data files, forms, templates)",
}

TypeName = Literal[
    "lectures", "tutorials", "problems", "exams", "recordings", "readings", "general"
]  # fmt: skip

SYSTEM = (
    "You sort a university course's materials into folders. Each item below is a file, page "
    "or link from the course's site, with what is known about it: its title, its kind, where "
    "the instructor put it. Give every item exactly one folder type:\n"
    + "\n".join(f"- {name}: {what}" for name, what in TYPES.items())
    + "\nChoose `general` when nothing points to one type. "
    + ai.UNTRUSTED_NOTICE
)


class Placement(BaseModel):
    id: str = Field(description="The item's id, as given.")
    type: TypeName


class Placements(BaseModel):
    items: list[Placement]


def _evidence(clues: Clues) -> dict[str, object]:
    known: dict[str, object] = {"title": clues.title}
    if clues.mime:
        known["file type"] = clues.mime
    if clues.url:
        known["link host"] = urlsplit(clues.url).hostname or ""
    if clues.subheader:
        known["under the heading"] = clues.subheader
    if clues.module:
        known["module"] = clues.module
    if clues.folder_path:
        known["folder"] = clues.folder_path
    if clues.listed_by:
        known["listed on"] = list(clues.listed_by)
    return known


async def classify_leftovers(
    ctx: Ctx, items: Mapping[str, Clues]
) -> dict[str, MaterialType] | None:
    """The type of each item, by its key. None when no model can answer now (none set up, the
    provider failed, a rate limit): the items stay in "general" and are asked about again on a
    later run. An item the answer leaves out is "general"."""
    if not items or not await ai.available(ctx, "title"):
        return None
    keys = list(items)
    listing = json.dumps(
        [{"id": str(n), **_evidence(items[key])} for n, key in enumerate(keys)],
        ensure_ascii=False,
        indent=1,
    )
    messages = [
        ai.Message.system(SYSTEM),
        ai.Message.user(ai.wrap_untrusted(listing, "course materials")),
    ]
    try:
        answer = await ai.structured(ctx, "title", messages, Placements, source_module="lms")
    except AppError as exc:
        if exc.code.startswith("ai."):
            return None
        raise
    found: dict[str, MaterialType] = dict.fromkeys(keys, "general")
    for placement in answer.items:
        if placement.id.isdigit() and int(placement.id) < len(keys):
            found[keys[int(placement.id)]] = placement.type
    return found
