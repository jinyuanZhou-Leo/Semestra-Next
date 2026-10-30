"""Term, Program and course summaries (M03)."""

from dataclasses import dataclass

from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.modules.academics import service as academics
from semestra.modules.academics.models import AcademicsProgram
from semestra.modules.academics.schemas import Course, Term
from semestra.modules.grading import engine, models
from semestra.modules.grading.schemas import (
    CourseGrade,
    CourseGrades,
    IgnoredCourseScore,
    ProgramGrades,
    TermGradePoint,
    TermGrades,
    TermGradeSimulation,
    TermSimulateInput,
)
from semestra.modules.grading.service.assessments import assessment_rows
from semestra.modules.grading.service.common import program_courses
from semestra.modules.grading.service.gradebook import course_input, engine_items
from semestra.modules.grading.service.scales import get_scale_row, scale_of


@dataclass
class _ProgramState:
    program: AcademicsProgram
    scale_row: models.GradingScale
    scale: engine.Scale
    terms: list[Term]
    courses: list[Course]
    results: dict[str, models.GradingCourseResult]
    items: dict[str, tuple[engine.Item, ...]]

    @property
    def attribution(self) -> engine.YearAttribution:
        return (
            "split_evenly"
            if self.scale_row.year_course_attribution == "split_evenly"
            else "end_term"
        )


async def _load_program(ctx: Ctx, program_id: str) -> _ProgramState:
    program = await academics.get_program_row(ctx, program_id)
    scale_row = await get_scale_row(ctx, program_id)
    courses = await program_courses(ctx, program_id)
    ids = [c.id for c in courses]
    results: dict[str, models.GradingCourseResult] = {}
    if ids:
        rows = (
            await ctx.db.scalars(
                select(models.GradingCourseResult).where(
                    models.GradingCourseResult.user_id == ctx.user_id,
                    models.GradingCourseResult.course_id.in_(ids),
                )
            )
        ).all()
        results = {r.course_id: r for r in rows}
    assessments = await assessment_rows(ctx, ids)
    return _ProgramState(
        program=program,
        scale_row=scale_row,
        scale=scale_of(scale_row),
        terms=await academics.list_terms(ctx, program_id),
        courses=courses,
        results=results,
        items={cid: engine_items(rows) for cid, rows in assessments.items()},
    )


def _grade_all(state: _ProgramState, include_in_progress: bool) -> list[engine.GradedCourse]:
    graded: list[engine.GradedCourse] = []
    for course in state.courses:
        inp = course_input(course, state.results.get(course.id), state.items.get(course.id, ()))
        graded.append(
            engine.GradedCourse(
                inp, engine.course_grade(inp, state.scale, include_in_progress=include_in_progress)
            )
        )
    return graded


def _course_grade_out(
    g: engine.GradedCourse,
    course: Course,
    term_id: str | None = None,
    rule: engine.YearAttribution = "end_term",
) -> CourseGrade:
    attributed = (
        engine.attribute_credits(course.credits, course.term_ids, rule).get(term_id, 0.0)
        if term_id
        else None
    )
    return CourseGrade(
        course_id=course.id,
        code=course.code,
        title=course.title,
        alias=course.alias,
        credits=course.credits,
        include_in_gpa=course.include_in_gpa,
        basis=g.course.basis,
        status=g.grade.status,
        percentage=g.grade.percentage,
        current_percentage=g.grade.current_percentage,
        points=g.grade.points,
        letter=g.grade.letter,
        counts_in_gpa=g.grade.counts_in_gpa,
        year_long=len(course.term_ids) > 1,
        attributed_credits=None if attributed is None else round(attributed, 3),
    )


async def term_grades(ctx: Ctx, term_id: str, include_in_progress: bool) -> TermGrades:
    term = await academics.get_term_row(ctx, term_id)
    state = await _load_program(ctx, term.program_id)
    graded = _grade_all(state, include_in_progress)
    rule = state.attribution
    aggregate = engine.term_aggregate(graded, term_id, rule)
    order = [c.id for c in await program_courses(ctx, term.program_id, term_id)]
    by_course = {g.course.course_id: g for g in graded}
    courses = {c.id: c for c in state.courses}
    rows = [
        _course_grade_out(by_course[i], courses[i], term_id, rule) for i in order if i in courses
    ]
    return TermGrades(
        term_id=term_id,
        max_points=state.scale_row.max_points,
        hide_gpa=state.scale_row.hide_gpa,
        gpa=aggregate.gpa,
        average_percentage=aggregate.average_percentage,
        credits_counted=aggregate.credits_counted,
        credits_total=round(sum(r.attributed_credits or 0 for r in rows), 3),
        credits_earned=aggregate.credits_earned,
        excluded_count=aggregate.excluded_count,
        in_progress_count=aggregate.in_progress_count,
        courses=rows,
    )


async def simulate_term(ctx: Ctx, inp: TermSimulateInput) -> TermGradeSimulation:
    term = await academics.get_term_row(ctx, inp.term_id)
    state = await _load_program(ctx, term.program_id)
    graded = _grade_all(state, inp.include_in_progress)
    result = engine.simulate_term(
        graded, inp.term_id, state.attribution, state.scale, inp.scores, inp.target_gpa
    )
    return TermGradeSimulation(
        term_id=inp.term_id,
        gpa=result.aggregate.gpa,
        average_percentage=result.aggregate.average_percentage,
        credits_counted=result.aggregate.credits_counted,
        target_gpa=result.target_gpa,
        gap=result.gap,
        max_possible_gpa=result.max_possible_gpa,
        reachable=result.reachable,
        required_percentage=result.required_percentage,
        ignored=[IgnoredCourseScore(id=cid, reason=r) for cid, r in result.ignored],  # pyright: ignore[reportArgumentType]
    )


async def program_grades(ctx: Ctx, program_id: str, include_in_progress: bool) -> ProgramGrades:
    state = await _load_program(ctx, program_id)
    graded = _grade_all(state, include_in_progress)
    aggregate = engine.program_aggregate(graded)
    series = engine.program_series(graded, [t.id for t in state.terms], state.attribution)
    names = {t.id: t for t in state.terms}
    required = state.program.credit_requirement
    return ProgramGrades(
        program_id=program_id,
        max_points=state.scale_row.max_points,
        hide_gpa=state.scale_row.hide_gpa,
        gpa=aggregate.gpa,
        average_percentage=aggregate.average_percentage,
        credits_counted=aggregate.credits_counted,
        credits_earned=aggregate.credits_earned,
        credits_required=required,
        progress=round(min(1.0, aggregate.credits_earned / required), 3) if required else None,
        graded_course_count=sum(1 for g in graded if g.grade.counts_in_gpa),
        term_count=len(state.terms),
        terms=[
            TermGradePoint(
                term_id=p.term_id,
                name=names[p.term_id].name,
                start_date=names[p.term_id].start_date,
                gpa=p.aggregate.gpa,
                cumulative_gpa=p.cumulative_gpa,
                credits_counted=p.aggregate.credits_counted,
                cumulative_credits=p.cumulative_credits,
            )
            for p in series
        ],
    )


async def course_grades(ctx: Ctx, program_id: str, include_in_progress: bool) -> CourseGrades:
    state = await _load_program(ctx, program_id)
    graded = _grade_all(state, include_in_progress)
    by_course = {c.id: c for c in state.courses}
    return CourseGrades(
        program_id=program_id,
        max_points=state.scale_row.max_points,
        hide_gpa=state.scale_row.hide_gpa,
        items=[_course_grade_out(g, by_course[g.course.course_id]) for g in graded],
    )
