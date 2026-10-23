"""Academic structure capabilities (M02 §4)."""

from semestra.core.agent_output import CHANGED
from semestra.core.capability import Http, NoInput, capability
from semestra.core.context import Ctx
from semestra.modules.academics import service
from semestra.modules.academics.schemas import (
    CalendarInfo,
    Course,
    CourseCandidates,
    CourseCreateInput,
    CourseCreateManyInput,
    CourseFindInput,
    CourseList,
    CourseListInput,
    CoursePage,
    CourseRef,
    CourseSetTermsInput,
    CourseUpdateInput,
    Deleted,
    Program,
    ProgramCreateInput,
    ProgramList,
    ProgramRef,
    ProgramUpdateInput,
    SubjectColorInput,
    Term,
    TermCreateInput,
    TermCreateResult,
    TermDeletePreview,
    TermDeleteResult,
    TermList,
    TermRef,
    TermUpdateInput,
)

TAGS = ("academics",)

# What agents get back (M00 §3.6): no colors, sort keys or timestamps.
_PROGRAM_FIELDS = (
    "id", "name", "institution", "timezone", "default_course_credits", "credit_requirement",
    "term_count", "course_count",
)  # fmt: skip
_TERM_FIELDS = (
    "id", "name", "start_date", "end_date", "breaks", "count_break_weeks", "is_current",
    "course_count",
)  # fmt: skip
_COURSE_FIELDS = (
    "id", "code", "title", "alias", "subject_code", "credits", "include_in_gpa", "instructors",
    "description", "website_url", "planned_terms", "term_ids", "end_term_id",
)  # fmt: skip

# --- programs -------------------------------------------------------------------------------


@capability(
    name="academics.program.list",
    summary="List the user's Programs (degrees) with their term and course counts.",
    description="""Use to find the Program ids of the user, e.g. before listing terms or courses
when no Program is given. Most users have exactly one Program.""",
    effect="read",
    http=Http("GET", "/programs"),
    tags=TAGS,
    agent_output_fields=tuple(f"items.{f}" for f in _PROGRAM_FIELDS),
)
async def program_list(ctx: Ctx, inp: NoInput) -> ProgramList:
    return ProgramList(items=await service.list_programs(ctx))


@capability(
    name="academics.program.get",
    summary="Get one Program: name, school, time zone, credit defaults and subject colors.",
    description="Use when you need a Program's details such as its time zone or credit goal.",
    effect="read",
    http=Http("GET", "/programs/{program_id}"),
    tags=TAGS,
    agent_output_fields=_PROGRAM_FIELDS,
)
async def program_get(ctx: Ctx, inp: ProgramRef) -> Program:
    return await service.program_out(ctx, await service.get_program_row(ctx, inp.program_id))


@capability(
    name="academics.program.create",
    summary="Create a Program (a degree or study plan).",
    description="""Use only when the user explicitly wants a new, separate Program, e.g. a second
degree. Do not use to add a term or a course; use academics.term.create or
academics.course.create.""",
    effect="write",
    http=Http("POST", "/programs"),
    tags=TAGS,
    agent_output_fields=("id", "name", "timezone"),
)
async def program_create(ctx: Ctx, inp: ProgramCreateInput) -> Program:
    return await service.create_program(ctx, inp)


@capability(
    name="academics.program.update",
    summary="Change a Program's name, school, time zone or credit settings.",
    description="Partial update: only the fields that are sent change.",
    effect="write",
    http=Http("PATCH", "/programs/{program_id}"),
    tags=TAGS,
    agent_output_fields=("id", "name", CHANGED),
)
async def program_update(ctx: Ctx, inp: ProgramUpdateInput) -> Program:
    return await service.update_program(ctx, inp)


@capability(
    name="academics.program.delete",
    summary="Delete a Program with all of its terms, courses and their data.",
    description="""Irreversible. Use only when the user clearly asks to delete the whole Program.
To remove one term or course use academics.term.delete or academics.course.delete.""",
    effect="destructive",
    http=Http("DELETE", "/programs/{program_id}"),
    preview=service.preview_program_delete,
    tags=TAGS,
)
async def program_delete(ctx: Ctx, inp: ProgramRef) -> Deleted:
    await service.delete_program(ctx, inp.program_id)
    return Deleted()


@capability(
    name="academics.program.set_subject_color",
    summary="Set the color of a subject code (e.g. all 'APS' courses) in a Program.",
    description="""Use when the user wants every course of a subject in another color. To color a
single course differently, use academics.course.update with `color`.""",
    effect="write",
    http=Http("PUT", "/programs/{program_id}/subject-colors/{subject_code}"),
    tags=TAGS,
    agent_output_fields=("id", "name", "subject_colors"),
)
async def program_set_subject_color(ctx: Ctx, inp: SubjectColorInput) -> Program:
    return await service.set_subject_color(ctx, inp.program_id, inp.subject_code, inp.color)


# --- terms ----------------------------------------------------------------------------------


@capability(
    name="academics.term.list",
    summary="List the terms (semesters) of a Program in chronological order.",
    description="""Use to find a term id, or which term is current (`is_current`), before creating
courses or answering questions about a semester.""",
    effect="read",
    http=Http("GET", "/programs/{program_id}/terms"),
    tags=TAGS,
    agent_core=True,
    agent_output_fields=tuple(f"items.{f}" for f in _TERM_FIELDS),
)
async def term_list(ctx: Ctx, inp: ProgramRef) -> TermList:
    return TermList(items=await service.list_terms(ctx, inp.program_id))


@capability(
    name="academics.term.get",
    summary="Get one term with its dates and breaks.",
    description="Use when you need a term's dates, reading weeks or holidays.",
    effect="read",
    http=Http("GET", "/terms/{term_id}"),
    tags=TAGS,
    agent_output_fields=_TERM_FIELDS,
)
async def term_get(ctx: Ctx, inp: TermRef) -> Term:
    return await service.term_out(ctx, await service.get_term_row(ctx, inp.term_id))


@capability(
    name="academics.term.get_weeks",
    summary="Week numbers of a term: each week's dates, number or break, and today's week.",
    description="""Use to translate between dates and week numbers ("week 6", "reading week"),
e.g. to resolve "the Friday of week 3". Week 1 is the week the term starts in.""",
    effect="read",
    http=Http("GET", "/terms/{term_id}/calendar-info"),
    tags=TAGS,
)
async def term_calendar_info(ctx: Ctx, inp: TermRef) -> CalendarInfo:
    return await service.calendar_info(ctx, inp.term_id)


@capability(
    name="academics.term.create",
    summary="Create a term, optionally with its courses, in one step.",
    description="""Use when the user starts a new semester. Check academics.term.list first so the
term does not exist already. `courses` creates courses in the new term; `continue_course_ids`
extends year-long courses of the previous term into it.""",
    effect="write",
    http=Http("POST", "/programs/{program_id}/terms"),
    tags=TAGS,
    agent_output_fields=(
        "term.id",
        "term.name",
        "term.start_date",
        "term.end_date",
        "course_ids",
        "continued_course_ids",
    ),
)
async def term_create(ctx: Ctx, inp: TermCreateInput) -> TermCreateResult:
    return await service.create_term(ctx, inp)


@capability(
    name="academics.term.update",
    summary="Change a term's name, dates, breaks or week numbering.",
    description="""Partial update. `breaks` replaces the whole list; keep the ids of breaks that
stay. Fails with academics.course_terms_not_adjacent when new dates would separate the terms of
a year-long course.""",
    effect="write",
    http=Http("PATCH", "/terms/{term_id}"),
    tags=TAGS,
    agent_output_fields=("id", "name", CHANGED),
)
async def term_update(ctx: Ctx, inp: TermUpdateInput) -> Term:
    return await service.update_term(ctx, inp)


@capability(
    name="academics.term.preview_delete",
    summary="What deleting a term would remove: its own courses vs. year-long courses kept.",
    description="Use before academics.term.delete to tell the user what will be deleted.",
    effect="read",
    http=Http("GET", "/terms/{term_id}/delete-preview"),
    tags=TAGS,
)
async def term_delete_preview(ctx: Ctx, inp: TermRef) -> TermDeletePreview:
    return await service.delete_preview(ctx, inp.term_id)


@capability(
    name="academics.term.delete",
    summary="Delete a term and the courses that are only in it.",
    description="""Irreversible. Year-long courses that also run in other terms are kept and only
lose this term. Show academics.term.preview_delete to the user first.""",
    effect="destructive",
    http=Http("DELETE", "/terms/{term_id}"),
    preview=service.preview_term_delete,
    tags=TAGS,
)
async def term_delete(ctx: Ctx, inp: TermRef) -> TermDeleteResult:
    return await service.delete_term(ctx, inp.term_id)


# --- courses --------------------------------------------------------------------------------


@capability(
    name="academics.course.list",
    summary="List the courses of a Program, optionally of one term, subject or search text.",
    description="""Use to see all courses of a term or Program. To locate one course the user
described in words ("my programming course"), prefer academics.course.find.""",
    effect="read",
    http=Http("GET", "/programs/{program_id}/courses"),
    tags=TAGS,
    agent_default_fields=("code", "title", "alias", "credits", "term_ids"),
)
async def course_list(ctx: Ctx, inp: CourseListInput) -> CoursePage:
    return await service.list_courses(ctx, inp)


@capability(
    name="academics.course.get",
    summary="Get one course with its terms, credits, instructors and resolved color.",
    description="Use when you need the details of a course whose id you know.",
    effect="read",
    http=Http("GET", "/courses/{course_id}"),
    tags=TAGS,
    agent_output_fields=_COURSE_FIELDS,
)
async def course_get(ctx: Ctx, inp: CourseRef) -> Course:
    return await service.course_out(ctx, await service.get_course_row(ctx, inp.course_id))


@capability(
    name="academics.course.find",
    summary="Find courses by how the user names them: code, title words or nickname.",
    description="""Use first whenever the user refers to a course in words ("APS 105", "the
programming course", "calc") to get its id. Returns candidates with a score; ask the user when
the top candidates are close. Searches the current Program unless `program_id` is given.""",
    effect="read",
    expose=("agent", "mcp"),
    tags=TAGS,
    agent_core=True,
    agent_output_fields=tuple(
        f"items.{f}" for f in ("course_id", "code", "title", "alias", "term_ids", "score")
    ),
)
async def course_find(ctx: Ctx, inp: CourseFindInput) -> CourseCandidates:
    return await service.find_courses(ctx, inp.query, inp.program_id, inp.limit)


@capability(
    name="academics.course.create",
    summary="Add a course to one term, or to consecutive terms for a year-long course.",
    description="""Use when the user adds a course. Get term ids from academics.term.list.
For a year-long course whose second term does not exist yet, link the current term only and set
`planned_terms` to 2; the term wizard offers to continue it later.""",
    effect="write",
    http=Http("POST", "/programs/{program_id}/courses"),
    tags=TAGS,
    agent_output_fields=("id", "code", "title", "term_ids"),
)
async def course_create(ctx: Ctx, inp: CourseCreateInput) -> Course:
    return (await service.create_courses(ctx, inp.program_id, [(inp, inp.term_ids)]))[0]


@capability(
    name="academics.course.create_many",
    summary="Add several courses at once.",
    description="""Use for a batch of courses the user typed or listed in the chat. Courses in a
document or file (a timetable, a syllabus) go through imports.session.create instead.""",
    effect="write",
    http=Http("POST", "/programs/{program_id}/courses:batch"),
    tags=TAGS,
    agent_output_fields=("items.id", "items.code", "items.title", "items.term_ids"),
)
async def course_create_many(ctx: Ctx, inp: CourseCreateManyInput) -> CourseList:
    items = [(c, c.term_ids) for c in inp.courses]
    return CourseList(items=await service.create_courses(ctx, inp.program_id, items))


@capability(
    name="academics.course.update",
    summary="Change a course's code, title, alias, credits, color, instructors or other fields.",
    description="""Partial update: only the fields that are sent change. To move a course to other
terms or make it year-long, use academics.course.set_terms.""",
    effect="write",
    http=Http("PATCH", "/courses/{course_id}"),
    tags=TAGS,
    agent_output_fields=("id", "code", "title", CHANGED),
)
async def course_update(ctx: Ctx, inp: CourseUpdateInput) -> Course:
    return await service.update_course(ctx, inp)


@capability(
    name="academics.course.set_terms",
    summary="Set which terms a course runs in (consecutive terms for a year-long course).",
    description="""Replaces the course's terms. They must belong to its Program and be next to each
other in time.""",
    effect="write",
    http=Http("PUT", "/courses/{course_id}/terms"),
    preview=service.preview_course_set_terms,
    tags=TAGS,
    agent_output_fields=("id", "code", "term_ids", "end_term_id"),
)
async def course_set_terms(ctx: Ctx, inp: CourseSetTermsInput) -> Course:
    return await service.set_course_terms(ctx, inp.course_id, inp.term_ids)


@capability(
    name="academics.course.delete",
    summary="Delete a course and all of its data (grades, files, schedule).",
    description="Irreversible. Use only when the user clearly asks to delete the course.",
    effect="destructive",
    http=Http("DELETE", "/courses/{course_id}"),
    preview=service.preview_course_delete,
    tags=TAGS,
)
async def course_delete(ctx: Ctx, inp: CourseRef) -> Deleted:
    await service.delete_course(ctx, inp.course_id)
    return Deleted()
