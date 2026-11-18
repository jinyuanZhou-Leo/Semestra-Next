"""Which type of course material a file is, and so which folder of the course it goes in
(M07 §8): the rules, and the model for what they leave.

Every file, page and link of a course has a type, and a type is a folder at the top of the
course's files ("Lectures", "Past exams"...). The type comes from what the item says about itself
first (its title, its kind of file, the address of a link), then from where it was put: the
subheader above it in a module, the module's name, its folder on the platform, the pages that
list it. The first of these that names one type decides. One that names two ("Tutorial 3
solutions") leaves the choice between them to the next clue that names one of them (a module
"Tutorials"), and to the model when none does. "Final" alone names nothing: the final exam, or the
final version of the notes. Nothing found: the general "Course materials". A syllabus stays at the
top level.

What the rules leave in "general", the model reads the same clues for (plus the start of the
text, when the file has been read) and picks one of the type folders, never a folder of its own.
Used by the "Organize" of the course files (`organize.py`) and by M09's sync of course materials.
"""

import json
import re
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Literal, cast
from urllib.parse import urlsplit

from pydantic import BaseModel, Field
from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.modules import ai
from semestra.modules.files import service
from semestra.modules.files.models import FilesFolder, FilesTypeFolder
from semestra.modules.files.schemas import TypeName

MaterialType = Literal[
    "info", "exams", "recordings", "problems", "tutorials", "lectures", "readings", "general"
]
# Types with a folder of their own; "info" (the syllabus, the course outline) stays at the top.
FOLDER_TYPES: tuple[MaterialType, ...] = (
    "lectures", "tutorials", "problems", "exams", "recordings", "readings", "general",
)  # fmt: skip

# The folders' names, in the language of the account when they are made (they are the user's
# folders afterwards, to rename as they like).
FOLDER_NAMES: dict[str, dict[MaterialType, str]] = {
    "en": {
        "lectures": "Lectures",
        "tutorials": "Tutorials and labs",
        "problems": "Problem sets and solutions",
        "exams": "Past exams",
        "recordings": "Recordings",
        "readings": "Readings",
        "general": "Course materials",
    },
    "zh-CN": {
        "lectures": "讲义",
        "tutorials": "辅导与实验",
        "problems": "习题与答案",
        "exams": "往年考试",
        "recordings": "录播",
        "readings": "阅读",
        "general": "课程资料",
    },
}


def folder_name(kind: MaterialType, locale: str) -> str:
    names = FOLDER_NAMES.get(locale) or FOLDER_NAMES["zh-CN" if locale.startswith("zh") else "en"]
    return names[kind]


def _words(pattern: str, chinese: str) -> re.Pattern[str]:
    # Latin words need their edges (an "exam" is not "example"); digits may follow ("lec03").
    return re.compile(rf"(?<![a-z])(?:{pattern})(?![a-z])|{chinese}", re.IGNORECASE)


# What names each type. A word inside a longer phrase of another type is that phrase ("past
# papers" and "midterm solutions" are exams, "lecture recordings" recordings).
PATTERNS: tuple[tuple[MaterialType, re.Pattern[str]], ...] = (
    (
        "info",
        _words(r"syllabus|course\s+(?:outline|info(?:rmation)?|overview)", "教学大纲|课程大纲"),
    ),
    (
        "exams",
        _words(
            r"(?:mid-?terms?|exams?|term[\s_-]?tests?)(?:\s+\d+)?\s+(?:solutions?|answers?)|"
            r"mid-?terms?|exams?|term[\s_-]?tests?|past\s+papers?",
            "期中|期末|考试|试卷|真题",
        ),
    ),
    (
        "recordings",
        _words(
            r"(?:lecture\s+)?(?:recordings?|videos?)|recorded|lecture\s+capture|panopto|"
            r"echo\s?360|kaltura",
            "录播|录像|回放|视频",
        ),
    ),
    (
        "problems",
        _words(
            r"solutions?|answers?|problem\s*sets?|psets?|problems?|homeworks?|hw|assignments?|"
            r"exercises?|practice|worksheets?|quiz(?:zes)?",
            "习题|作业|答案|练习|题解",
        ),
    ),
    (
        "tutorials",
        _words(r"tutorials?|tut|labs?|laborator(?:y|ies)|recitations?|practicals?", "辅导|实验"),
    ),
    (
        "lectures",
        _words(r"lectures?|lec|slides?|notes|chapters?|ch(?=\s*\d)", "讲义|课件|讲座|幻灯片|笔记"),
    ),
    (
        "readings",
        _words(r"readings?|textbooks?|articles?|papers?|books?|references?", "阅读|教材|文献"),
    ),
)

# Hosts of lecture recordings and video sites.
VIDEO_HOSTS = (
    "youtube.com", "youtu.be", "vimeo.com", "panopto.com", "panopto.eu", "kaltura.com",
    "echo360.org", "echo360.com", "echo360.ca", "mymedia.", "zoom.us/rec", "bilibili.com",
)  # fmt: skip


@dataclass(frozen=True)
class Clues:
    """What is known about an item, from itself out: its own title (and file type, address),
    then the subheader above it in its module, the module's name, its folder on the platform,
    and the titles of the pages that list it."""

    title: str
    mime: str | None = None
    url: str | None = None
    subheader: str | None = None
    module: str | None = None
    folder_path: str | None = None
    listed_by: Sequence[str] = field(default_factory=lambda: ())
    # The start of its text, when it has been read (only the model reads it).
    excerpt: str | None = None


def match(text: str | None) -> frozenset[MaterialType]:
    """The types `text` names: none, one, or several (then it is unclear which)."""
    if not text:
        return frozenset()
    # File names separate words with dots, dashes and underscores ("Lec_03-intro.pdf").
    spaced = re.sub(r"[._\-]+", " ", text)
    found: list[tuple[MaterialType, tuple[int, int]]] = [
        (kind, hit.span()) for kind, pattern in PATTERNS for hit in pattern.finditer(spaced)
    ]
    return frozenset(
        kind
        for kind, (start, end) in found
        if not any(
            other != kind and s <= start and end <= e and e - s > end - start
            for other, (s, e) in found
        )
    )


def _is_video(clues: Clues) -> bool:
    mime = (clues.mime or "").lower()
    if mime.startswith(("video/", "audio/")):
        return True
    if clues.url:
        parts = urlsplit(clues.url)
        address = f"{(parts.hostname or '').lower()}{parts.path}"
        return any(host in address for host in VIDEO_HOSTS)
    return False


def classify(clues: Clues) -> MaterialType:
    if _is_video(clues):
        return "recordings"
    folders = [p for p in reversed((clues.folder_path or "").split("/")) if p]  # deepest first
    # The first clue that names one type decides. One that names several narrows the choice to
    # them, for the next clue that names one of them; failing that, the model decides.
    choices: frozenset[MaterialType] | None = None
    for text in (clues.title, clues.subheader, clues.module, *folders, *clues.listed_by):
        named = match(text)
        # Only the item's own title says it is the syllabus; a module called "Course
        # information" holds more than that.
        if text != clues.title:
            named -= {"info"}
        if choices is not None:
            named &= choices
        if len(named) == 1:
            return next(iter(named))
        if named:
            choices = named
    return "general"


# --- what the rules leave ---------------------------------------------------------------------

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


SYSTEM = (
    "You sort a university course's materials into folders. Each item below is a file, page "
    "or link of the course, with what is known about it: its title, its kind, where it was "
    "put, the start of its text. Give every item exactly one folder type:\n"
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
    if clues.excerpt:
        known["text begins"] = clues.excerpt
    return known


# Items per request: a long list with the start of each file's text stays well inside a small
# model's context and output.
BATCH = 100


async def classify_leftovers(
    ctx: Ctx,
    items: Mapping[str, Clues],
    *,
    on_batch: Callable[[int, int], Awaitable[None]] | None = None,
) -> dict[str, MaterialType] | None:
    """The type of each item, by its key; None when no model is set up. An item the answer leaves
    out is "general". The provider's errors (`ai.*`) are raised: the caller decides whether that
    fails the work or leaves the items where they are. `on_batch(done, total)` follows the
    requests, `BATCH` items each."""
    if not items or not await ai.available(ctx, "title"):
        return None
    keys = list(items)
    found: dict[str, MaterialType] = dict.fromkeys(keys, "general")
    batches = [keys[n : n + BATCH] for n in range(0, len(keys), BATCH)]
    for done, batch in enumerate(batches):
        if on_batch is not None:
            await on_batch(done, len(batches))
        found |= await _ask(ctx, {key: items[key] for key in batch})
    return found


async def _ask(ctx: Ctx, items: Mapping[str, Clues]) -> dict[str, MaterialType]:
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
    answer = await ai.structured(ctx, "title", messages, Placements, source_module="files")
    found: dict[str, MaterialType] = {}
    for placement in answer.items:
        if placement.id.isdigit() and int(placement.id) < len(keys):
            found[keys[int(placement.id)]] = placement.type
    return found


# --- the type folders -----------------------------------------------------------------------


async def type_folders(ctx: Ctx, course_id: str) -> dict[MaterialType, FilesTypeFolder]:
    """The course's remembered type folders (a `folder_id` of None: the user deleted it)."""
    rows = await ctx.db.scalars(
        select(FilesTypeFolder).where(
            FilesTypeFolder.user_id == ctx.user_id, FilesTypeFolder.course_id == course_id
        )
    )
    return {cast(MaterialType, r.type): r for r in rows}


def remember(
    ctx: Ctx,
    course_id: str,
    kind: MaterialType,
    folder_id: str,
    known: dict[MaterialType, FilesTypeFolder],
) -> str:
    """`folder_id` is now where `kind` goes (the user's own folder that took its place)."""
    row = known.get(kind)
    if row is None:
        row = FilesTypeFolder(user_id=ctx.user_id, course_id=course_id, type=kind)
        ctx.db.add(row)
        known[kind] = row
    row.folder_id = folder_id
    return folder_id


async def existing_folder(
    ctx: Ctx, course_id: str, kind: MaterialType, known: dict[MaterialType, FilesTypeFolder]
) -> FilesFolder | None:
    """The type's folder if the course has one: the remembered one while it is there, else a
    top-level folder with the type's name."""
    row = known.get(kind)
    if row is not None and row.folder_id is not None:
        folder = await service.find_folder(ctx, course_id, row.folder_id)
        if folder is not None:
            return folder
    return await service.root_folder_named(ctx, course_id, folder_name(kind, ctx.locale))


async def folder_for(
    ctx: Ctx,
    course_id: str,
    kind: MaterialType,
    known: dict[MaterialType, FilesTypeFolder],
    *,
    if_deleted: Literal["remake", "top_level"],
) -> str | None:
    """Where the type's items go (None: the top level; a syllabus always stays there): its
    folder (`existing_folder`), made in the account's language when the course has none, and
    remembered. When the user deleted the remembered folder, `if_deleted` decides: "remake"
    finds or makes one again like the first time (the user's "Organize": they ask for the type
    folders), "top_level" leaves the type's items at the top level (M09's sync: owner
    2026-11-17, nothing is guessed from where the user put other items)."""
    if kind == "info":
        return None
    row = known.get(kind)
    if row is not None and if_deleted == "top_level":
        if row.folder_id and await service.find_folder(ctx, course_id, row.folder_id) is not None:
            return row.folder_id
        return None
    folder = await existing_folder(ctx, course_id, kind, known)
    if folder is None:
        name = folder_name(kind, ctx.locale)
        folder_id = (await service.create_folder(ctx, course_id, name, None)).id
    else:
        folder_id = folder.id
    return remember(ctx, course_id, kind, folder_id, known)
