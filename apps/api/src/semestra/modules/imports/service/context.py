"""What building and validating import items needs to know (M08)."""

from collections.abc import Sequence
from typing import Any

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules.academics import service as academics
from semestra.modules.academics.schemas import CourseListInput
from semestra.modules.imports import build, dates, deps
from semestra.modules.imports.models import ImportsItem, ImportsSession
from semestra.modules.imports.schemas import (
    SessionTarget,
)
from semestra.modules.imports.validate import ValidationContext, summarize, validate


def target_of(row: ImportsSession) -> SessionTarget:
    return SessionTarget.model_validate(row.target)


async def _term_dates(ctx: Ctx, target: SessionTarget) -> dates.TermDates | None:
    if target.kind == "term_wizard" and target.term_id is None:
        # The term does not exist yet: plain weeks from the wizard's dates (no breaks known).
        if target.start_date and target.end_date:
            return dates.TermDates(
                target.start_date,
                target.end_date,
                dates.plain_weeks(target.start_date, target.end_date),
            )
        return None
    if target.term_id is None:
        return None
    term = await academics.get_term_row(ctx, target.term_id)
    return await term_dates_of(ctx, term)


async def term_dates_of(ctx: Ctx, term: Any) -> dates.TermDates:
    weeks = await academics.weeks_of(ctx, term)
    return dates.TermDates(
        term.start_date,
        term.end_date,
        [dates.TermWeekSpan(w.number, w.start_date, w.end_date) for w in weeks],
    )


async def _program_courses(ctx: Ctx, program_id: str) -> list[Any]:
    page = await academics.list_courses(ctx, CourseListInput(program_id=program_id, limit=500))
    return page.items


async def _existing_assessments(ctx: Ctx, course_ids: Sequence[str]) -> dict[str, set[str]]:
    """Normalised titles of the courses' assessments (the plain list: no gradebook maths, which
    every review edit would otherwise pay for)."""
    if not course_ids or not deps.has_capability("grading.assessment.list"):
        return {}
    out: dict[str, set[str]] = {}
    for course_id in course_ids:
        try:
            page = await deps.call(
                ctx, "grading.assessment.list", {"course_id": course_id, "limit": 500}
            )
        except AppError:
            continue
        out[course_id] = {build.norm_title(a["title"]) for a in page.get("items", [])}
    return out


async def build_context(ctx: Ctx, row: ImportsSession) -> build.BuildContext:
    target = target_of(row)
    courses = await _program_courses(ctx, row.program_id)
    existing = [
        build.ExistingCourse(
            id=c.id,
            code=c.code,
            title=c.title,
            fields={
                "code": c.code,
                "title": c.title,
                "credits": c.credits,
                "instructors": [i.model_dump(mode="json") for i in c.instructors],
                "description": c.description,
                "website_url": c.website_url,
            },
        )
        for c in courses
    ]
    type_codes: list[str] = []
    if deps.has_capability("schedule.event_type.list"):
        types = await deps.call(ctx, "schedule.event_type.list", {"program_id": row.program_id})
        type_codes = [t["code"] for t in types.get("items", [])]
    ids = [target.course_id] if target.course_id else [c.id for c in courses]
    return build.BuildContext(
        target_kind=target.kind,
        target_course_id=target.course_id,
        term=await _term_dates(ctx, target),
        courses=existing,
        type_codes=type_codes,
        existing_assessments=await _existing_assessments(ctx, ids),
        source_kind=row.source_kind,
    )


async def _validation_context(
    ctx: Ctx, row: ImportsSession, items: Sequence[ImportsItem]
) -> ValidationContext:
    target = target_of(row)
    course_ids = sorted(
        {
            str(i.data.get("course_ref", "")).removeprefix("course:")
            for i in items
            if str(i.data.get("course_ref", "")).startswith("course:")
        }
    )
    course_terms: dict[str, list[str]] = {}
    for course_id in course_ids:
        try:
            course = await academics.course_out(ctx, await academics.get_course_row(ctx, course_id))
        except AppError:
            continue
        course_terms[course_id] = list(course.term_ids)
    term_ids = {t for terms in course_terms.values() for t in terms}
    term_ids |= {str(t) for i in items if i.type == "course" for t in i.data.get("term_ids") or []}
    terms: dict[str, dates.TermDates] = {}
    for term_id in sorted(term_ids - {target.term_id}):
        try:
            terms[term_id] = await term_dates_of(ctx, await academics.get_term_row(ctx, term_id))
        except AppError:
            continue
    term = await _term_dates(ctx, target)
    if term is not None and target.term_id is not None:
        terms[target.term_id] = term
    return ValidationContext(
        target_kind=target.kind,
        target_term_id=target.term_id,
        existing_assessments=await _existing_assessments(ctx, course_ids),
        course_term_counts={c: len(t) for c, t in course_terms.items()},
        target_weeks=term.weeks if term else None,
        course_terms=course_terms,
        terms=terms,
    )


async def revalidate(ctx: Ctx, row: ImportsSession, items: Sequence[ImportsItem]) -> None:
    validate(items, await _validation_context(ctx, row, items))
    row.summary = summarize(items)
    row.updated_at = ctx.now
    await ctx.db.flush()
