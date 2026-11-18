"""Where a course's loose files would go (M07 §8), for its "Organize" (`organize.py`).

A loose file is one of the user's own at the top level of the course's files. The model reads
what is known of each (its name, its kind, the start of its text) and the course's folders, and
puts it in one of those folders when one fits, else proposes a new folder for files that belong
together, else leaves it. A new folder for a single file is not proposed: a folder is for a group.
Without a model set up, loose files stay where they are.
"""

import json
from collections import Counter
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from urllib.parse import urlsplit

from pydantic import BaseModel, Field

from semestra.core.context import Ctx
from semestra.modules import ai


@dataclass(frozen=True)
class Clues:
    """What is known about a loose file."""

    title: str
    mime: str | None = None
    url: str | None = None
    # The start of its text, when it has been read.
    excerpt: str | None = None


@dataclass(frozen=True)
class Place:
    """Where a file would go: an existing folder (by its index in the list given), or a new
    top-level folder of this name."""

    folder: int | None = None
    new: str | None = None


SYSTEM = (
    "You tidy the files of a university course. You get the course's folders (each with its "
    "full path) and the files at its top level, with what is known about each: its name, its "
    "kind, the start of its text. For each file, choose the folder it belongs in, by the "
    "folder's index. Only when no folder fits and several files belong together, give the same "
    "short new folder name to each of them (in the language of the file names). Otherwise "
    "leave the file out. Never invent a folder for a single file. " + ai.UNTRUSTED_NOTICE
)


class Placement(BaseModel):
    id: str = Field(description="The file's id, as given.")
    folder: int | None = Field(default=None, description="Index of the folder it belongs in")
    new_folder: str | None = Field(
        default=None, description="A new folder's name, only for files that belong together"
    )


class Placements(BaseModel):
    items: list[Placement]


def _evidence(clues: Clues) -> dict[str, object]:
    known: dict[str, object] = {"name": clues.title}
    if clues.mime:
        known["file type"] = clues.mime
    if clues.url:
        known["link host"] = urlsplit(clues.url).hostname or ""
    if clues.excerpt:
        known["text begins"] = clues.excerpt
    return known


# Files per request: a long list with the start of each file's text stays well inside a small
# model's context and output.
BATCH = 100
MAX_NEW_NAME = 60


async def place_loose(
    ctx: Ctx,
    folders: Sequence[str],
    items: Mapping[str, Clues],
    *,
    on_batch: Callable[[int, int], Awaitable[None]] | None = None,
) -> dict[str, Place] | None:
    """Where each loose file would go, by its key (a file left out stays where it is); None
    when no model is set up. The provider's errors (`ai.*`) are raised."""
    if not items or not await ai.available(ctx, "title"):
        return None
    keys = list(items)
    found: dict[str, Place] = {}
    batches = [keys[n : n + BATCH] for n in range(0, len(keys), BATCH)]
    for done, batch in enumerate(batches):
        if on_batch is not None:
            await on_batch(done, len(batches))
        found |= await _ask(ctx, folders, {key: items[key] for key in batch})
    # A new folder only for a group.
    groups = Counter(p.new.casefold() for p in found.values() if p.new)
    return {k: p for k, p in found.items() if p.new is None or groups[p.new.casefold()] > 1}


async def _ask(ctx: Ctx, folders: Sequence[str], items: Mapping[str, Clues]) -> dict[str, Place]:
    keys = list(items)
    listing = json.dumps(
        {
            "folders": [{"index": n, "path": path} for n, path in enumerate(folders)],
            "files": [{"id": str(n), **_evidence(items[key])} for n, key in enumerate(keys)],
        },
        ensure_ascii=False,
        indent=1,
    )
    messages = [
        ai.Message.system(SYSTEM),
        ai.Message.user(ai.wrap_untrusted(listing, "course files")),
    ]
    answer = await ai.structured(ctx, "title", messages, Placements, source_module="files")
    found: dict[str, Place] = {}
    for placement in answer.items:
        if not placement.id.isdigit() or int(placement.id) >= len(keys):
            continue
        key = keys[int(placement.id)]
        if placement.folder is not None and 0 <= placement.folder < len(folders):
            found[key] = Place(folder=placement.folder)
        elif (
            (name := (placement.new_folder or "").strip()[:MAX_NEW_NAME])
            and "/" not in name
            and "\\" not in name
        ):
            found[key] = Place(new=name)
    return found
