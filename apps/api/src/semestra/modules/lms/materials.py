"""Where a course's materials go in its files (M09 §4.2): pure rules, no platform or database.

Every file, page and link of a course gets a type, and a type is a folder of the course's files
("Lectures", "Past exams"...). The type comes from what the item says about itself first (its
title, its kind of file, the address of a link), then from where the instructor put it: the
subheader above it in its module, the module's name, its folder on the platform, the pages that
list it. Nothing found: the general "Course materials". A syllabus stays at the top level.
"""

import re
from collections.abc import Sequence
from dataclasses import dataclass, field
from html.parser import HTMLParser
from typing import Literal
from urllib.parse import urlsplit

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


# In order: the first that matches wins ("Midterm solutions" are exams, "Tutorial 3 problems"
# problem sets, "Lecture recordings" recordings).
PATTERNS: tuple[tuple[MaterialType, re.Pattern[str]], ...] = (
    (
        "info",
        _words(r"syllabus|course\s+(?:outline|info(?:rmation)?|overview)", "教学大纲|课程大纲"),
    ),
    (
        "exams",
        _words(
            r"mid-?terms?|finals?(?!\s*(?:project|report|presentation|paper))|exams?|"
            r"term[\s_-]?tests?|past\s+papers?",
            "期中|期末|考试|试卷|真题",
        ),
    ),
    (
        "recordings",
        _words(
            r"recordings?|recorded|videos?|lecture\s+capture|panopto|echo\s?360|kaltura",
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


def match(text: str | None) -> MaterialType | None:
    if not text:
        return None
    # File names separate words with dots, dashes and underscores ("Lec_03-intro.pdf").
    spaced = re.sub(r"[._\-]+", " ", text)
    for kind, pattern in PATTERNS:
        if pattern.search(spaced):
            return kind
    return None


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
    for text in (clues.title, clues.subheader, clues.module, *folders, *clues.listed_by):
        if (kind := match(text)) is not None:
            # Only the item's own title says it is the syllabus; a module called "Course
            # information" holds more than that.
            if kind == "info" and text != clues.title:
                continue
            return kind
    return "general"


# --- pages ----------------------------------------------------------------------------------

# A page whose own text (links left out) is shorter than this lists other things: it is not
# kept as a document, only read for what it lists.
LIST_TEXT_MAX = 160


class _PageText(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.links: list[str] = []
        self.own: list[str] = []
        self._in_link = 0
        self._skip = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "a":
            self._in_link += 1
            href = dict(attrs).get("href")
            if href:
                self.links.append(href)
        elif tag in ("script", "style"):
            self._skip += 1

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._in_link:
            self._in_link -= 1
        elif tag in ("script", "style") and self._skip:
            self._skip -= 1

    def handle_data(self, data: str) -> None:
        if not self._in_link and not self._skip:
            self.own.append(data)


@dataclass(frozen=True)
class PageShape:
    links: list[str]
    # Little text of its own besides its links (a table of contents), or nothing at all: not
    # kept as a document.
    is_list: bool


def page_shape(html: str | None) -> PageShape:
    parser = _PageText()
    parser.feed(html or "")
    parser.close()
    own = re.sub(r"\s+", " ", "".join(parser.own)).strip()
    is_list = not own or (bool(parser.links) and len(own) < LIST_TEXT_MAX)
    return PageShape(links=parser.links, is_list=is_list)
