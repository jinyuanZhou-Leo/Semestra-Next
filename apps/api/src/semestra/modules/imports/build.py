"""From parsed or extracted source data to import items (M08 §4). Pure functions: everything they
need from the database (existing courses, assessments, event types, term dates) is passed in."""

import re
import unicodedata
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, time
from typing import Any

from semestra.modules.imports import dates
from semestra.modules.imports.ics import IcsResult, normalize_code
from semestra.modules.imports.schemas import Evidence, NewItem

# Built-in category keys (M03) and the words a syllabus or an LMS uses for them, English and
# Chinese. English plurals need no entry of their own (`_words` makes them singular).
CATEGORY_SYNONYMS: dict[str, tuple[str, ...]] = {
    "quiz": ("quiz", "test", "pop quiz", "knowledge check", "小测", "测验", "随堂测", "小考"),
    "exam": ("exam", "midterm", "mid term", "final", "examination", "term test", "final exam",
             "final assessment", "考试", "期中", "期末"),
    "assignment": ("assignment", "homework", "hw", "problem set", "pset", "exercise", "worksheet",
                   "essay", "paper", "reflection", "response", "reading response", "journal",
                   "作业", "论文", "习题", "练习"),
    "project": ("project", "term project", "group project", "final project", "capstone",
                "portfolio", "项目", "大作业", "课程设计"),
    "lab": ("lab", "laboratory", "practical", "practicum", "lab report", "实验", "实验报告"),
    "presentation": ("presentation", "talk", "pitch", "poster", "demo", "seminar", "oral",
                     "展示", "汇报", "演讲", "答辩", "海报"),
    "participation": ("participation", "attendance", "engagement", "discussion", "forum",
                      "clicker", "iclicker", "top hat", "tophat", "in class", "出勤", "参与",
                      "课堂表现", "考勤", "签到", "讨论"),
}  # fmt: skip
# Group names that say nothing of what is in them: Canvas's own default groups among them, where
# a course often puts everything. Their assignments decide first.
VAGUE_GROUPS = re.compile(
    r"^(assignment|imported assignment|coursework|course work|other|graded|grade|group \d*"
    r"|assignment group \d*|作业组 ?\d*|其他)$"
)
TYPE_ALIASES = {
    "lecture": "LEC", "lec": "LEC", "seminar": "LEC", "sem": "LEC", "讲座": "LEC", "讲课": "LEC",
    "tutorial": "TUT", "tut": "TUT", "discussion": "TUT", "dis": "TUT", "recitation": "TUT",
    "rec": "TUT", "辅导": "TUT", "习题课": "TUT",
    "lab": "PRA", "laboratory": "PRA", "practical": "PRA", "pra": "PRA", "studio": "PRA",
    "实验": "PRA",
}  # fmt: skip


def norm_title(text: str) -> str:
    return re.sub(r"[\s\W_]+", "", unicodedata.normalize("NFKC", text)).casefold()


def _singular(word: str) -> str:
    if not word.isascii() or len(word) <= 3 or word.endswith(("ss", "us", "is")):
        return word
    if word.endswith("zzes"):
        return word[:-3]  # quizzes
    if word.endswith("ies"):
        return word[:-3] + "y"
    return word.removesuffix("s")


def _words(text: str) -> str:
    """Lowercase words with one space between them, English plurals made singular: the form
    category names and synonyms are compared in."""
    words = re.split(r"[\W_]+", unicodedata.normalize("NFKC", text).casefold())
    return " ".join(_singular(w) for w in words if w)


def _contains(words: str, phrase: str) -> bool:
    """Whether a phrase occurs in the words as whole words (CJK: anywhere)."""
    if not phrase:
        return False
    if not phrase.isascii():
        return phrase.replace(" ", "") in words.replace(" ", "")
    return f" {phrase} " in f" {words} "


_SYNONYMS = sorted(
    ((_words(word), key) for key, words in CATEGORY_SYNONYMS.items() for word in words),
    key=lambda pair: -len(pair[0]),
)


def category_key(name: str) -> str | None:
    """The built-in category a name means, if any ("Midterm exams" → exam). The longest word
    found wins, so "Term test" is an exam, not a quiz."""
    words = _words(name)
    return next((key for word, key in _SYNONYMS if _contains(words, word)), None)


def match_category(
    name: str,
    categories: Sequence[tuple[str, str]],
    *,
    previous: str | None = None,
    contents: Sequence[tuple[str, bool]] = (),
) -> str | None:
    """The key of the course category a group of assessments named `name` goes into, or None to
    create one. `categories` are the course's `(key, name)`; `previous` is the category its
    earlier assessments are in now; `contents` the group's assessments as `(title, is_quiz)`.
    In order: where the group went before, the same name, a category named inside the name, a
    built-in by synonym, what most of its assessments are; else nothing."""
    keys = {key for key, _ in categories}
    if previous in keys:
        return previous
    words = _words(name)
    vague = bool(VAGUE_GROUPS.match(words))
    if vague and (voted := _vote(contents, keys)):
        return voted
    for key, label in categories:
        if words in (_words(label), _words(key)):
            return key
    inside = [(w, key) for key, label in categories if len(w := _words(label)) >= 3]
    for label, key in sorted(inside, key=lambda pair: -len(pair[0])):
        if _contains(words, label):
            return key
    builtin = category_key(name)
    if builtin in keys:
        return builtin
    return None if vague else _vote(contents, keys)


def _vote(contents: Sequence[tuple[str, bool]], keys: set[str]) -> str | None:
    """The category more than half of the assessments mean (an LMS quiz is a quiz)."""
    counts: dict[str, int] = {}
    for title, quiz in contents:
        key = "quiz" if quiz else category_key(title)
        if key in keys:
            counts[key] = counts.get(key, 0) + 1
    best = max(counts, key=lambda k: counts[k], default=None)
    return best if best is not None and counts[best] * 2 > len(contents) else None


def type_code(raw: str | None, available: Sequence[str]) -> str:
    """An event type code the Program has: the code itself, an alias, else LEC."""
    codes = {c.upper() for c in available}
    value = (raw or "").strip()
    upper = re.sub(r"\d+$", "", value.upper())
    if upper in codes:
        return upper
    alias = TYPE_ALIASES.get(value.casefold()) or TYPE_ALIASES.get(upper.casefold())
    if alias and alias in codes:
        return alias
    return "LEC" if "LEC" in codes or not codes else sorted(codes)[0]


def year_long(code: str | None, duration: str | None) -> bool:
    """`two_terms` from the syllabus, or a UofT-style `Y` course code (MAT137Y1)."""
    if duration == "two_terms":
        return True
    return bool(code and re.fullmatch(r"[A-Z]{2,4}\d{3,4}Y\d?[A-Z]?", normalize_code(code)))


@dataclass(frozen=True)
class ExistingCourse:
    id: str
    code: str | None
    title: str
    fields: dict[str, Any]


@dataclass
class BuildContext:
    """What the builders need to know about the target and the Program."""

    target_kind: str
    target_course_id: str | None
    term: dates.TermDates | None
    courses: Sequence[ExistingCourse]
    type_codes: Sequence[str]
    # Normalised titles of the assessments the target course already has.
    existing_assessments: dict[str, set[str]] = field(default_factory=lambda: {})
    # Each course's categories as `(key, name)` by id; "" is what a new course starts with.
    categories: dict[str, list[tuple[str, str]]] = field(default_factory=lambda: {})
    source_kind: str = "syllabus"


class Builder:
    """Collects new items; course items get keys (`c0`, `c1`, …) the others refer to."""

    def __init__(self, ctx: BuildContext) -> None:
        self.ctx = ctx
        self.items: list[NewItem] = []
        self._course_refs: dict[str, str] = {}
        self._count = 0

    def _key(self, prefix: str) -> str:
        self._count += 1
        return f"{prefix}{self._count}"

    def add(
        self,
        type_: str,
        data: dict[str, Any],
        *,
        key: str | None = None,
        evidence: dict[str, Evidence] | None = None,
        confidence: dict[str, str] | None = None,
        decision: str = "accept",
    ) -> str:
        key = key or self._key(type_[0])
        self.items.append(
            NewItem.model_validate(
                {
                    "key": key,
                    "type": type_,
                    "data": data,
                    "evidence": evidence or {},
                    "confidence": confidence or {},
                    "decision": decision,
                }
            )
        )
        return key

    def match(self, code: str | None) -> ExistingCourse | None:
        wanted = normalize_code(code)
        if not wanted:
            return None
        return next((c for c in self.ctx.courses if normalize_code(c.code) == wanted), None)

    def foreign(self, code: str | None, title: str | None) -> bool:
        """Whether a course of the source is some other course than the target course (a
        timetable or calendar file that has the whole week). Its items are rejected by default."""
        if self.ctx.target_kind != "course":
            return False
        target = next((c for c in self.ctx.courses if c.id == self.ctx.target_course_id), None)
        if target is None:
            return False
        if normalize_code(code) and normalize_code(target.code):
            return normalize_code(code) != normalize_code(target.code)
        if title:
            return norm_title(title) != norm_title(target.title)
        return False

    def course(
        self,
        data: dict[str, Any],
        *,
        evidence: dict[str, Evidence] | None = None,
        confidence: dict[str, str] | None = None,
        patch_existing: bool,
    ) -> str:
        """The `course_ref` for a course of the source: the target course, an existing course
        with the same code (a patch item when `patch_existing`, else a rejected duplicate
        course item), or a new course item."""
        code = data.get("code")
        group = normalize_code(code) or norm_title(str(data.get("title") or ""))
        # A course needs a title; when the source has none, its code stands in. Never for a patch:
        # that would rename the existing course to its code.
        named = data if data.get("title") else {**data, "title": code or ""}
        if group in self._course_refs:
            return self._course_refs[group]
        existing: ExistingCourse | None
        if self.ctx.target_kind == "course" and self.ctx.target_course_id:
            existing = next(
                (c for c in self.ctx.courses if c.id == self.ctx.target_course_id), None
            )
        else:
            existing = self.match(code)
        if existing is not None:
            ref = f"course:{existing.id}"
            if existing.id == self.ctx.target_course_id and not patch_existing:
                pass  # the target course itself: nothing to say about it
            elif patch_existing:
                changes = {
                    name: {
                        "old": existing.fields.get(name),
                        "new": _merged(name, existing.fields.get(name), value),
                        "apply": True,
                    }
                    for name, value in data.items()
                    if name in _PATCHABLE and _differs(existing.fields.get(name), value)
                }
                if changes:
                    self.add(
                        "course_patch",
                        {"course_id": existing.id, "changes": changes},
                        evidence={k: v for k, v in (evidence or {}).items() if k in changes},
                        confidence={k: v for k, v in (confidence or {}).items() if k in changes},
                    )
            else:
                self.add(
                    "course",
                    {**named, "existing_course_id": existing.id},
                    evidence=evidence,
                    confidence=confidence,
                    decision="reject",
                )
        else:
            key = self.add(
                "course", named, key=self._key("c"), evidence=evidence, confidence=confidence
            )
            ref = f"item:{key}"
        self._course_refs[group] = ref
        return ref


_PATCHABLE = ("code", "title", "credits", "instructors", "description", "website_url")


def _differs(old: Any, new: Any) -> bool:
    if new in (None, "", []):
        return False
    if isinstance(old, str) and isinstance(new, str):
        return " ".join(old.split()).casefold() != " ".join(new.split()).casefold()
    if isinstance(old, list) and isinstance(new, list):
        names = {str(i.get("name", "")).casefold() for i in old if isinstance(i, dict)}  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType, reportUnknownArgumentType]
        return any(
            str(i.get("name", "")).casefold() not in names for i in new if isinstance(i, dict)
        )  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType, reportUnknownArgumentType]
    return old != new


def _merged(name: str, old: Any, new: Any) -> Any:
    """Instructors are added to the course's list, not swapped for the syllabus's (a TA the user
    added stays)."""
    if name != "instructors" or not isinstance(old, list):
        return new
    names = {str(i.get("name", "")).casefold() for i in old if isinstance(i, dict)}  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType, reportUnknownArgumentType]
    return [*old, *(i for i in new if str(i.get("name", "")).casefold() not in names)]  # pyright: ignore[reportUnknownVariableType]


def _iso(value: date | time | None) -> str | None:
    return value.isoformat() if value is not None else None


def term_ref_for(
    day: date | None, ctx: BuildContext, terms: Mapping[str, dates.TermDates]
) -> str | None:
    """`term:<id>` of the existing term a date falls in when the target has no term of its own
    (course target); None = the target term."""
    if ctx.target_kind in ("term", "term_wizard") or day is None:
        return None
    for term_id, span in terms.items():
        if span.contains(day):
            return f"term:{term_id}"
    return None


def ics_terms(
    ctx: BuildContext, program_terms: Mapping[str, dates.TermDates]
) -> dict[str, dates.TermDates]:
    """The terms an ICS import places classes in, by id: the target term (the wizard's dates
    before the term exists, under the key "") or, into a course, every term of the Program."""
    if ctx.target_kind in ("term", "term_wizard"):
        return {"": ctx.term} if ctx.term is not None else {}
    return dict(program_terms)


def from_ics(
    result: IcsResult, ctx: BuildContext, terms: Mapping[str, dates.TermDates]
) -> list[NewItem]:
    """ICS courses and events (M08 §4.1): a course whose code the Program already has keeps
    the existing course (its duplicate course item is rejected) and only gets the meetings.
    A meeting becomes one item per term it is held in (a full-year class goes to fall and
    winter), each with the term's own rhythm and cancelled days (`dates.rhythm`); days in no
    term are left out. `terms` comes from `ics_terms`."""
    builder = Builder(ctx)
    for course in result.courses:
        # Into one course: the file's other courses are shown, switched off.
        decision = "reject" if builder.foreign(course.code, course.title) else "accept"
        ref = builder.course(
            {"code": course.code, "title": course.title[:200], "planned_terms": 1},
            patch_existing=False,
        )
        for m in course.meetings:
            for term_id, span in terms.items():
                held = [d for d in m.dates if span.contains(d)]
                if not held:
                    continue
                r = dates.rhythm(held, m.weekday, span)
                into = term_id if term_id and ctx.target_kind == "course" else None
                builder.add(
                    "meeting",
                    {
                        "course_ref": ref,
                        "term_ref": f"term:{into}" if into else None,
                        "section_code": m.section_code,
                        "type_code": type_code(m.type_code, ctx.type_codes),
                        "weekday": m.weekday,
                        "start_time": _iso(m.start_time),
                        "end_time": _iso(m.end_time),
                        "recurrence": r.recurrence,
                        "first_date": _iso(r.first),
                        "last_date": _iso(r.last),
                        "location": (m.location or None) and m.location[:200],
                        "instructor": m.instructor,
                        # One class in two terms is two meetings, each referenced by its term
                        # (an id, not dates the user may still move). A term or wizard import
                        # has one term, so the class's own reference is enough.
                        "source_ref": (f"{m.source_ref}@{term_id}" if term_id else m.source_ref)[
                            :500
                        ],
                        "exceptions": [_iso(d) for d in r.cancelled],
                    },
                    decision=decision,
                )
        for e in course.events:
            builder.add("event", _ics_event(e, ref, ctx, terms), decision=decision)
    if ctx.target_kind != "course":  # events of no course don't belong to one course
        for e in result.events:
            builder.add("event", _ics_event(e, None, ctx, terms))
    return builder.items


def _ics_event(
    e: Any, ref: str | None, ctx: BuildContext, terms: Mapping[str, dates.TermDates]
) -> dict[str, Any]:
    return {
        "course_ref": ref,
        "term_ref": term_ref_for(e.day, ctx, terms),
        "title": e.title[:200],
        "date": _iso(e.day),
        "end_date": _iso(e.end_day),
        "start_time": _iso(e.start_time),
        "end_time": _iso(e.end_time),
        "all_day": e.all_day,
        "type_code": type_code(e.type_code, ctx.type_codes) if e.type_code else None,
        "location": (e.location or None) and e.location[:200],
        "source_ref": e.source_ref[:500],
    }
