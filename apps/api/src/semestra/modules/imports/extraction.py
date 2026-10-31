"""Smart extraction from syllabi, pasted text and timetable screenshots (M08 §4.2-4.4).

The model only reads; everything that interprets its answer (dates, weights, categories, year-long
courses, duplicates) is deterministic code in `from_syllabus` / `from_timetable`.
"""

from collections.abc import Awaitable, Callable, Sequence
from datetime import date, time
from typing import Any, Literal

from pydantic import BaseModel, Field

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules import ai
from semestra.modules.imports import dates
from semestra.modules.imports.build import (
    BuildContext,
    Builder,
    category_key,
    norm_title,
    slug_key,
    type_code,
    year_long,
)
from semestra.modules.imports.schemas import Evidence

E = ai.Evidenced
Role = Literal["instructor", "ta", "coordinator"]
Duration = Literal["one_term", "two_terms"]
DateKind = Literal["exam", "deadline", "no_class", "other"]
Day = date  # `ImportantDateX.date` shadows the type inside that class


class InstructorX(BaseModel):
    name: E[str] = Field(default_factory=E[str], description="Full name")
    email: E[str] = Field(default_factory=E[str])
    role: E[Role] = Field(default_factory=E[Role])
    office_hours: E[str] = Field(default_factory=E[str], description="As written")


class CourseX(BaseModel):
    code: E[str] = Field(default_factory=E[str], description="Course code such as 'APS105H1'")
    title: E[str] = Field(default_factory=E[str], description="Course title without the code")
    credits: E[float] = Field(default_factory=E[float], description="Credit value / weight")
    duration: E[Duration] = Field(
        default_factory=E[Duration], description="two_terms for a full-year course"
    )
    term_hint: E[str] = Field(default_factory=E[str], description="E.g. 'Fall 2026'")
    description: E[str] = Field(default_factory=E[str], description="Short course description")
    website_url: E[str] = Field(default_factory=E[str], description="Course website URL")
    instructors: list[InstructorX] = Field(default_factory=list)


class CategoryX(BaseModel):
    name: E[str] = Field(default_factory=E[str], description="E.g. 'Quizzes'")
    weight: E[float] = Field(default_factory=E[float], description="Percent of the course grade")


class AssessmentX(BaseModel):
    title: E[str] = Field(default_factory=E[str], description="E.g. 'Midterm 1'")
    category: E[str] = Field(default_factory=E[str], description="Its category's name")
    weight: E[float] = Field(default_factory=E[float], description="Percent of the course grade")
    due_text: E[str] = Field(
        default_factory=E[str], description="The deadline exactly as written ('Week 5, Friday')"
    )
    due_date: E[date] = Field(default_factory=E[date], description="Deadline as YYYY-MM-DD")
    due_time: E[time] = Field(default_factory=E[time], description="Deadline time HH:MM")
    notes: E[str] = Field(default_factory=E[str])


class GradingX(BaseModel):
    categories: list[CategoryX] = Field(default_factory=list)
    assessments: list[AssessmentX] = Field(default_factory=list)
    policies_text: E[str] = Field(default_factory=E[str], description="Late/drop policies")


class MeetingX(BaseModel):
    type: E[str] = Field(default_factory=E[str], description="lecture, tutorial, lab, ...")
    weekday: E[int] = Field(default_factory=E[int], description="1 = Monday .. 7 = Sunday")
    start_time: E[time] = Field(default_factory=E[time], description="HH:MM, 24-hour")
    end_time: E[time] = Field(default_factory=E[time], description="HH:MM, 24-hour")
    location: E[str] = Field(default_factory=E[str])
    weeks_text: E[str] = Field(default_factory=E[str], description="Which weeks, as written")


class ImportantDateX(BaseModel):
    title: E[str] = Field(default_factory=E[str])
    date_text: E[str] = Field(default_factory=E[str], description="As written")
    date: E[Day] = Field(default_factory=E[Day], description="YYYY-MM-DD when stated")
    kind: E[DateKind] = Field(default_factory=E[DateKind])


class SyllabusExtraction(BaseModel):
    course: CourseX = Field(default_factory=CourseX)
    grading: GradingX = Field(default_factory=GradingX)
    meetings: list[MeetingX] = Field(default_factory=list)
    important_dates: list[ImportantDateX] = Field(default_factory=list)


class TimetableCellX(BaseModel):
    course_code: E[str] = Field(default_factory=E[str])
    title: E[str] = Field(default_factory=E[str])
    type: E[str] = Field(default_factory=E[str], description="LEC, TUT, PRA, lab, ...")
    section: E[str] = Field(default_factory=E[str], description="E.g. 'LEC0101'")
    weekday: E[int] = Field(default_factory=E[int], description="1 = Monday .. 7 = Sunday")
    start_time: E[time] = Field(default_factory=E[time], description="HH:MM, 24-hour")
    end_time: E[time] = Field(default_factory=E[time], description="HH:MM, 24-hour")
    location: E[str] = Field(default_factory=E[str])


class TimetableExtraction(BaseModel):
    cells: list[TimetableCellX] = Field(default_factory=list, description="One per class block")


SYLLABUS_INSTRUCTIONS = """Extract the course information from this course syllabus (or pasted \
text about a course): the course itself, its grading scheme (categories and individual \
assessments with weights and deadlines), its weekly class meetings and important dates.
Only extract what the document states explicitly; leave a field null when it is not stated, never \
guess. Keep deadlines as written in `due_text` / `date_text` (e.g. "Week 5, Friday") and also give \
`due_date` / `date` when the document states a calendar date. Weights are percentages of the \
final grade. List each assessment once; when the syllabus gives a group ("4 quizzes, 20% total"), \
list the category with its weight and each assessment with its share if stated."""

TIMETABLE_INSTRUCTIONS = """This is a weekly class timetable (a screenshot or a page of a \
timetable). List every class block once: course code, title if shown, type (lecture, tutorial, \
lab...), section, weekday (1 = Monday .. 7 = Sunday), start and end time (24-hour HH:MM) and the \
location. Use the [image N] number as the evidence page. Do not invent blocks that are not shown."""

# A syllabus is read in three requests side by side: the whole schema is too large for strict
# structured output (M06 `extract`). Updating the course info reads only the first.
SYLLABUS_PARTS = (("course",), ("grading",), ("meetings", "important_dates"))
COURSE_INFO_PARTS = (("course",),)

# The model call; replaced in tests.
Extract = Callable[..., Awaitable[ai.Extraction[Any]]]
run_extract: Extract = ai.extract


def _conf(value: float) -> str:
    return "high" if value >= 0.8 else "medium" if value >= 0.5 else "low"


class _Fields:
    """Collects data, evidence and confidence of one item from Evidenced leaves."""

    def __init__(self, source: dict[str, str | None]) -> None:
        self.source = source
        self.data: dict[str, Any] = {}
        self.evidence: dict[str, Evidence] = {}
        self.confidence: dict[str, str] = {}

    def put(self, name: str, leaf: ai.Evidenced[Any], value: Any = None) -> Any:
        raw = leaf.value if value is None else value
        if raw is None or raw == "":
            return None
        self.data[name] = raw.isoformat() if isinstance(raw, date | time) else raw
        if leaf.evidence is not None:
            self.evidence[name] = Evidence(
                **self.source, page=leaf.evidence.page, quote=leaf.evidence.quote[:400]
            )
        self.confidence[name] = _conf(leaf.confidence)
        return raw


def _text(leaf: ai.Evidenced[Any]) -> str | None:
    value = leaf.value
    return value.strip() if isinstance(value, str) and value.strip() else None


def _cancel_meetings(builder: Builder, course_ref: str, day: date) -> bool:
    """Adds `day` to the exceptions of the course's meetings on that weekday; False when the
    course has none (the date then stays an event)."""
    meetings = [
        i
        for i in builder.items
        if i.type == "meeting"
        and i.data.get("course_ref") == course_ref
        and i.data.get("weekday") == day.isoweekday()
    ]
    for meeting in meetings:
        dates_ = meeting.data.setdefault("exceptions", [])
        if day.isoformat() not in dates_:
            dates_.append(day.isoformat())
    return bool(meetings)


def _share_category_weights(builder: Builder, course_ref: str) -> None:
    """ "Quizzes 20% (4 quizzes)": M03 counts each assessment by its own weight, so what the
    category's total leaves over is shared evenly by its assessments without one (marked
    medium, with the category's total as the source)."""
    categories = {
        f"item:{i.key}": i
        for i in builder.items
        if i.type == "category"
        and i.data.get("course_ref") == course_ref
        and i.data.get("weight_total") is not None
    }
    for ref, category in categories.items():
        members = [
            i
            for i in builder.items
            if i.type == "assessment"
            and i.data.get("course_ref") == course_ref
            and i.data.get("category_ref") == ref
        ]
        open_ = [i for i in members if i.data.get("weight") is None]
        left = float(category.data["weight_total"]) - sum(
            float(i.data.get("weight") or 0) for i in members
        )
        if not open_ or left <= 0:
            continue
        # Rounded shares, the last one taking the remainder, so they add up to the category.
        share = round(left / len(open_), 2)
        shares = [share] * (len(open_) - 1) + [round(left - share * (len(open_) - 1), 2)]
        for item, weight in zip(open_, shares, strict=True):
            item.data["weight"] = weight
            item.confidence["weight"] = "medium"
            if "weight_total" in category.evidence:
                item.evidence["weight"] = category.evidence["weight_total"]


def from_syllabus(
    ext: SyllabusExtraction,
    ctx: BuildContext,
    builder: Builder,
    source: dict[str, str | None],
) -> int:
    """Adds the items of one syllabus to `builder`; returns how many were added."""
    before = len(builder.items)
    course, code = _syllabus_course(ext.course, source)
    course.data["planned_terms"] = 2 if year_long(code, ext.course.duration.value) else 1
    if not (course.data.get("title") or code) and ctx.target_kind != "course":
        return 0  # nothing identifies a course: the document is not a syllabus
    ref = builder.course(
        course.data, evidence=course.evidence, confidence=course.confidence, patch_existing=True
    )
    course_id = ref.removeprefix("course:") if ref.startswith("course:") else None
    existing = ctx.existing_assessments.get(course_id or "", set())
    category_refs = _syllabus_categories(ext, builder, source, ref)
    titles = _syllabus_assessments(ext, ctx, builder, source, ref, category_refs, existing)
    _share_category_weights(builder, ref)
    _syllabus_meetings(ext, ctx, builder, source, ref)
    _syllabus_dates(ext, ctx, builder, source, ref, titles)
    return len(builder.items) - before


def _syllabus_course(c: CourseX, source: dict[str, str | None]) -> tuple[_Fields, str | None]:
    """The course's own fields, and its code."""
    course = _Fields(source)
    raw_code = _text(c.code)
    code = course.put("code", c.code, raw_code[:32]) if raw_code else None
    if title := _text(c.title):
        course.put("title", c.title, title[:200])
    if isinstance(c.credits.value, int | float) and 0 <= c.credits.value <= 100:
        course.put("credits", c.credits)
    if desc := _text(c.description):
        course.put("description", c.description, desc[:5000])
    if (url := _text(c.website_url)) and url.startswith(("http://", "https://")):
        course.put("website_url", c.website_url, url[:500])
    instructors = [
        {
            "name": name[:200],
            "email": _text(i.email),
            "role": {"ta": "TA", "coordinator": "Coordinator"}.get(str(i.role.value)),
        }
        for i in c.instructors
        if (name := _text(i.name))
    ]
    if instructors:
        course.data["instructors"] = instructors[:20]
        first = next((i.name for i in c.instructors if i.name.evidence), None)
        if first is not None and first.evidence is not None:
            course.evidence["instructors"] = Evidence(
                **source, page=first.evidence.page, quote=first.evidence.quote[:400]
            )
    return course, code


def _syllabus_categories(
    ext: SyllabusExtraction, builder: Builder, source: dict[str, str | None], ref: str
) -> dict[str, str]:
    """Categories: a built-in key when the name means one, else a new custom category. Returns
    their refs by normalized name and by `key:<key>`."""
    category_refs: dict[str, str] = {}
    for cat in ext.grading.categories:
        name = _text(cat.name)
        if not name:
            continue
        fields = _Fields(source)
        fields.put("name", cat.name, name[:200])
        if isinstance(cat.weight.value, int | float) and 0 <= cat.weight.value <= 100:
            fields.put("weight_total", cat.weight)
        key = category_key(name) or slug_key(name)
        fields.data.update(course_ref=ref, key=key)
        item_key = builder.add(
            "category", fields.data, evidence=fields.evidence, confidence=fields.confidence
        )
        category_refs[norm_title(name)] = f"item:{item_key}"
        category_refs.setdefault(f"key:{key}", f"item:{item_key}")
    return category_refs


def _syllabus_assessments(
    ext: SyllabusExtraction,
    ctx: BuildContext,
    builder: Builder,
    source: dict[str, str | None],
    ref: str,
    category_refs: dict[str, str],
    existing: set[str],
) -> set[str]:
    """Adds the assessments; returns their normalized titles."""
    titles: set[str] = set()
    for a in ext.grading.assessments:
        name = _text(a.title)
        if not name:
            continue
        fields = _Fields(source)
        fields.put("title", a.title, name[:200])
        fields.data["course_ref"] = ref
        if isinstance(a.weight.value, int | float) and 0 <= a.weight.value <= 100:
            fields.put("weight", a.weight)
        cat_name = _text(a.category) or name
        builtin = category_key(cat_name)
        cat_ref = category_refs.get(norm_title(cat_name))
        if cat_ref is None and builtin is not None:
            cat_ref = category_refs.get(f"key:{builtin}", f"key:{builtin}")
        if cat_ref:
            fields.data["category_ref"] = cat_ref
        due_text = _text(a.due_text)
        if due_text:
            fields.put("due_text", a.due_text, due_text[:200])
        due = a.due_date.value or dates.resolve(due_text, ctx.term)
        if due is not None:
            fields.put("due_date", a.due_date if a.due_date.value else a.due_text, due)
            if a.due_time.value is not None:
                fields.put("due_time", a.due_time)
        if note := _text(a.notes):
            fields.data["note"] = note[:2000]
        normalized = norm_title(name)
        fields.data["source_ref"] = f"syllabus:{normalized}"[:200]
        titles.add(normalized)
        builder.add(
            "assessment",
            fields.data,
            evidence=fields.evidence,
            confidence=fields.confidence,
            decision="reject" if normalized in existing else "accept",
        )
    return titles


def _syllabus_meetings(
    ext: SyllabusExtraction,
    ctx: BuildContext,
    builder: Builder,
    source: dict[str, str | None],
    ref: str,
) -> None:
    for m in ext.meetings:
        if not (m.start_time.value and m.end_time.value and m.weekday.value):
            continue
        if not 1 <= m.weekday.value <= 7 or m.start_time.value >= m.end_time.value:
            continue
        fields = _Fields(source)
        fields.data.update(course_ref=ref, type_code=type_code(_text(m.type), ctx.type_codes))
        fields.put("weekday", m.weekday)
        fields.put("start_time", m.start_time)
        fields.put("end_time", m.end_time)
        if loc := _text(m.location):
            fields.put("location", m.location, loc[:200])
        if weeks := _text(m.weeks_text):
            fields.put("weeks_text", m.weeks_text, weeks[:200])
        fields.data["source_ref"] = (
            f"syllabus:{m.weekday.value}:{m.start_time.value.isoformat('minutes')}:"
            f"{fields.data['type_code']}"
        )
        builder.add("meeting", fields.data, evidence=fields.evidence, confidence=fields.confidence)


def _syllabus_dates(
    ext: SyllabusExtraction,
    ctx: BuildContext,
    builder: Builder,
    source: dict[str, str | None],
    ref: str,
    titles: set[str],
) -> None:
    """Important dates: deadlines become tasks, "no class" days cancel meetings, the rest are
    events. One already added as an assessment is skipped."""
    for d in ext.important_dates:
        name = _text(d.title)
        if not name or norm_title(name) in titles:
            continue  # already an assessment
        fields = _Fields(source)
        fields.put("title", d.title, name[:200])
        date_text = _text(d.date_text)
        if date_text:
            fields.put("date_text", d.date_text, date_text[:200])
        day = d.date.value or dates.resolve(date_text, ctx.term)
        kind = d.kind.value or "other"
        if kind == "deadline":
            fields.data["course_ref"] = ref
            if day is not None:
                fields.put("due_date", d.date if d.date.value else d.date_text, day)
            # A task calls it due_text; its source and certainty move with it.
            if "date_text" in fields.data:
                fields.data["due_text"] = fields.data.pop("date_text")
            if "date_text" in fields.evidence:
                fields.evidence["due_text"] = fields.evidence.pop("date_text")
            if "date_text" in fields.confidence:
                fields.confidence["due_text"] = fields.confidence.pop("date_text")
            builder.add("task", fields.data, evidence=fields.evidence, confidence=fields.confidence)
            continue
        if kind == "no_class" and day is not None and _cancel_meetings(builder, ref, day):
            continue  # "no class on Oct 14": a cancelled date of the course's meetings
        fields.data.update(course_ref=ref, kind=kind, all_day=True)
        if kind == "exam" and "EXAM" in {c.upper() for c in ctx.type_codes}:
            fields.data["type_code"] = "EXAM"
        if day is not None:
            fields.put("date", d.date if d.date.value else d.date_text, day)
        builder.add("event", fields.data, evidence=fields.evidence, confidence=fields.confidence)


def from_timetable(
    ext: TimetableExtraction, ctx: BuildContext, builder: Builder, source: dict[str, str | None]
) -> int:
    before = len(builder.items)
    for cell in ext.cells:
        if not (cell.weekday.value and cell.start_time.value and cell.end_time.value):
            continue
        if not 1 <= cell.weekday.value <= 7 or cell.start_time.value >= cell.end_time.value:
            continue
        code = _text(cell.course_code)
        title = _text(cell.title) or code
        if not title:
            continue
        ref = builder.course(
            {"code": code and code[:32], "title": title[:200], "planned_terms": 1},
            patch_existing=False,
        )
        decision = "reject" if builder.foreign(code, _text(cell.title)) else "accept"
        fields = _Fields(source)
        section = (_text(cell.section) or "")[:32]
        fields.data.update(
            course_ref=ref,
            type_code=type_code(_text(cell.type) or section, ctx.type_codes),
            section_code=section,
        )
        fields.put("weekday", cell.weekday)
        fields.put("start_time", cell.start_time)
        fields.put("end_time", cell.end_time)
        if loc := _text(cell.location):
            fields.put("location", cell.location, loc[:200])
        fields.data["source_ref"] = (
            f"timetable:{code or title}:{section}:{cell.weekday.value}:"
            f"{cell.start_time.value.isoformat('minutes')}"
        )[:500]
        builder.add(
            "meeting",
            fields.data,
            evidence=fields.evidence,
            confidence=fields.confidence,
            decision=decision,
        )
    return len(builder.items) - before


async def extract_syllabus(
    ctx: Ctx,
    pages: Sequence[ai.PageText],
    *,
    images: Sequence[ai.Image] = (),
    label: str,
    source_ref: str,
    course_only: bool = False,
    on_segment: Callable[[int, int], Awaitable[None]] | None = None,
) -> SyllabusExtraction:
    """A syllabus from its page texts and the images of pages without text (a photo, a scan).
    Images need a vision model; without one, only the text pages are read. `course_only` reads
    just the course's own fields."""
    purpose: ai.Purpose = "extraction"
    if images:
        if await ai.available(ctx, "vision"):
            purpose = "vision"
        elif pages:
            images = ()
        else:
            raise AppError("ai.not_configured", 409, purpose="vision")
    result = await run_extract(
        ctx,
        purpose,
        SyllabusExtraction,
        texts=pages,
        images=images,
        instructions=SYLLABUS_INSTRUCTIONS,
        source_module="imports",
        source_ref=source_ref,
        label=label,
        parts=COURSE_INFO_PARTS if course_only else SYLLABUS_PARTS,
        on_segment=on_segment,
    )
    return result.value


async def extract_timetable(
    ctx: Ctx,
    images: Sequence[ai.Image],
    *,
    source_ref: str,
    on_segment: Callable[[int, int], Awaitable[None]] | None = None,
) -> TimetableExtraction:
    result = await run_extract(
        ctx,
        "vision",
        TimetableExtraction,
        images=images,
        instructions=TIMETABLE_INSTRUCTIONS,
        source_module="imports",
        source_ref=source_ref,
        label="timetable",
        on_segment=on_segment,
    )
    return result.value
