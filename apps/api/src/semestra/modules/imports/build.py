"""From parsed or extracted source data to import items (M08 §4). Pure functions: everything they
need from the database (existing courses, assessments, event types, term dates) is passed in."""

import re
import unicodedata
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import date, time
from typing import Any

from semestra.modules.imports import dates
from semestra.modules.imports.ics import IcsResult, normalize_code
from semestra.modules.imports.schemas import Evidence, NewItem

# Built-in category keys (M03) and the words a syllabus uses for them, English and Chinese.
CATEGORY_SYNONYMS: dict[str, tuple[str, ...]] = {
    "quiz": ("quiz", "quizzes", "test", "tests", "小测", "测验", "随堂测"),
    "exam": ("exam", "exams", "midterm", "midterms", "final", "finals", "examination", "考试",
             "期中", "期末"),
    "assignment": ("assignment", "assignments", "homework", "problem set", "problem sets", "pset",
                   "psets", "essay", "essays", "paper", "papers", "作业", "论文"),
    "project": ("project", "projects", "term project", "capstone", "项目", "大作业"),
    "lab": ("lab", "labs", "laboratory", "practical", "practicals", "实验"),
    "presentation": ("presentation", "presentations", "talk", "pitch", "展示", "汇报", "演讲"),
    "participation": ("participation", "attendance", "engagement", "discussion", "出勤", "参与",
                      "课堂表现", "考勤"),
}  # fmt: skip
TYPE_ALIASES = {
    "lecture": "LEC", "lec": "LEC", "seminar": "LEC", "sem": "LEC", "讲座": "LEC", "讲课": "LEC",
    "tutorial": "TUT", "tut": "TUT", "discussion": "TUT", "dis": "TUT", "recitation": "TUT",
    "rec": "TUT", "辅导": "TUT", "习题课": "TUT",
    "lab": "PRA", "laboratory": "PRA", "practical": "PRA", "pra": "PRA", "studio": "PRA",
    "实验": "PRA",
}  # fmt: skip


def norm_title(text: str) -> str:
    return re.sub(r"[\s\W_]+", "", unicodedata.normalize("NFKC", text)).casefold()


def category_key(name: str) -> str | None:
    """The built-in category a name means, if any ("Midterm exams" → exam)."""
    words = name.casefold().strip()
    for key, synonyms in CATEGORY_SYNONYMS.items():
        for word in synonyms:
            if (
                words == word
                or re.search(rf"(^|\W){re.escape(word)}($|\W)", words)
                or (not word.isascii() and word in words)
            ):
                return key
    return None


def slug_key(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", unicodedata.normalize("NFKD", name).casefold()).strip("-")
    return (slug or "category")[:32].strip("-") or "category"


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
    day: date | None, ctx: BuildContext, terms: Sequence[tuple[str, date, date]]
) -> str | None:
    """`term:<id>` of the existing term a date falls in when the target has no term of its own
    (course target); None = the target term."""
    if ctx.target_kind in ("term", "term_wizard") or day is None:
        return None
    for term_id, start, end in terms:
        if start <= day <= end:
            return f"term:{term_id}"
    return None


def from_ics(
    result: IcsResult, ctx: BuildContext, terms: Sequence[tuple[str, date, date]]
) -> list[NewItem]:
    """ICS courses and events (M08 §4.1): a course whose code the Program already has keeps
    the existing course (its duplicate course item is rejected) and only gets the meetings."""
    builder = Builder(ctx)
    for course in result.courses:
        # Into one course: the file's other courses are shown, switched off.
        decision = "reject" if builder.foreign(course.code, course.title) else "accept"
        ref = builder.course(
            {"code": course.code, "title": course.title[:200], "planned_terms": 1},
            patch_existing=False,
        )
        for m in course.meetings:
            builder.add(
                "meeting",
                {
                    "course_ref": ref,
                    "term_ref": term_ref_for(m.first_date, ctx, terms),
                    "section_code": m.section_code,
                    "type_code": type_code(m.type_code, ctx.type_codes),
                    "weekday": m.weekday,
                    "start_time": _iso(m.start_time),
                    "end_time": _iso(m.end_time),
                    "recurrence": m.recurrence,
                    "first_date": _iso(m.first_date),
                    "last_date": _iso(m.last_date),
                    "location": (m.location or None) and m.location[:200],
                    "instructor": m.instructor,
                    "source_ref": m.source_ref[:500],
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
    e: Any, ref: str | None, ctx: BuildContext, terms: Sequence[tuple[str, date, date]]
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
