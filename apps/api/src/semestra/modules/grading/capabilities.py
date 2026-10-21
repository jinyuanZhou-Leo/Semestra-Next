"""Grading capabilities (M03 §4)."""

from semestra.core.agent_output import CHANGED
from semestra.core.capability import Http, NoInput, capability
from semestra.core.context import Ctx
from semestra.modules.academics import service as academics
from semestra.modules.academics.schemas import CourseRef, Deleted, ProgramRef
from semestra.modules.grading import service
from semestra.modules.grading.schemas import (
    Assessment,
    AssessmentCandidates,
    AssessmentCategory,
    AssessmentCreateInput,
    AssessmentCreateManyInput,
    AssessmentCreateManyResult,
    AssessmentFindInput,
    AssessmentListInput,
    AssessmentOrder,
    AssessmentOrderInput,
    AssessmentPage,
    AssessmentRef,
    AssessmentUpdateInput,
    CategoryCreateInput,
    CategoryList,
    CategoryOrderInput,
    CategoryRef,
    CategoryUpdateInput,
    CourseGrades,
    CourseResult,
    CourseResultUpdateInput,
    Gradebook,
    GradingScale,
    ProgramGrades,
    ProgramSummaryInput,
    ScalePresets,
    ScaleUpdateInput,
    ScoreSuggestion,
    SimulateCourseInput,
    SimulatedGradebook,
    SuggestInput,
    TermGrades,
    TermGradeSimulation,
    TermSimulateInput,
    TermSummaryInput,
)

TAGS = ("grading",)

# What agents get back (M00 §3.6): local due dates (not `due_at`), no import keys, positions,
# colors or timestamps, and no per-assessment predictions.
_ASSESSMENT_FIELDS = (
    "id", "category_id", "title", "due_date", "due_time", "weight", "score_percentage",
    "points_earned", "points_possible", "dropped", "note", "status",
)  # fmt: skip
_RESULT_FIELDS = (
    "basis", "manual_percentage", "final_override_percentage", "pass_fail_result",
    "target_points", "forecast_model", "gradebook_enabled",
)  # fmt: skip
_SUMMARY_FIELDS = (
    "status", "weight_total", "weight_gap", "weights_ok", "graded_count", "remaining_count",
    "graded_weight", "remaining_weight", "locked_contribution", "current_percentage",
    "current_points", "current_letter", "final_percentage", "final_points", "final_letter",
    "final_source", "overridden", "forecast_percentage", "forecast_points", "forecast_letter",
    "target_points", "target_percentage", "required_average", "reachable",
)  # fmt: skip

# --- scale ----------------------------------------------------------------------------------


@capability(
    name="grading.scale.get",
    summary="Get a Program's grading scale: percentage ranges → grade points and letters.",
    description="""Use to convert a percentage to grade points or a letter, or to read the Program's
grading defaults (how year-long courses count, default categories, hidden GPA).""",
    effect="read",
    http=Http("GET", "/programs/{program_id}/grading-scale"),
    tags=TAGS,
    agent_output_fields=(
        "bands",
        "max_points",
        "year_course_attribution",
        "default_forecast_model",
        "default_categories.key",
        "default_categories.name",
        "hide_gpa",
    ),
)
async def scale_get(ctx: Ctx, inp: ProgramRef) -> GradingScale:
    return service.scale_out(await service.get_scale_row(ctx, inp.program_id))


@capability(
    name="grading.scale.update",
    summary="Change a Program's grading scale or grading defaults.",
    description="""Partial update: only the fields that are sent change. `bands` replaces the whole
table; the ranges must not overlap and must reach from 0 to 100, with points of at most
`max_points`. Every GPA of the Program is recalculated from the new scale.""",
    effect="write",
    http=Http("PUT", "/programs/{program_id}/grading-scale"),
    tags=TAGS,
    agent_output_fields=("program_id", CHANGED),
)
async def scale_update(ctx: Ctx, inp: ScaleUpdateInput) -> GradingScale:
    return await service.update_scale(ctx, inp)


@capability(
    name="grading.scale.list_presets",
    summary=(
        "List the built-in grading scales (UofT 4.0, US 4.0 and 4.33, standard 4.0, "
        "China 100-point, Australia 7-point, Korea 4.5, custom)."
    ),
    description="Use to offer ready-made scales; apply one with grading.scale.update.",
    effect="read",
    http=Http("GET", "/grading/scale-presets"),
    tags=TAGS,
)
async def scale_presets(ctx: Ctx, inp: NoInput) -> ScalePresets:
    del ctx, inp
    return ScalePresets(items=service.list_presets())


# --- gradebook ------------------------------------------------------------------------------


@capability(
    name="grading.gradebook.get",
    summary="A course's gradebook: categories, assessments, and every calculated figure.",
    description="""Use to answer questions about a course's grade: the current average, the final
grade, the forecast, or what the remaining assessments must average to reach a target grade
(`summary.required_average`). The summary figures are null while the weights do not add up to
100 (`summary.weight_gap` says how much is missing). Never calculate grades yourself.""",
    effect="read",
    http=Http("GET", "/courses/{course_id}/gradebook"),
    tags=TAGS,
    agent_core=True,
    agent_output_fields=(
        "course_id",
        "scale",
        *(f"result.{f}" for f in _RESULT_FIELDS),
        "categories.id",
        "categories.name",
        "categories.archived",
        *(f"assessments.{f}" for f in _ASSESSMENT_FIELDS),
        *(f"summary.{f}" for f in _SUMMARY_FIELDS),
    ),
)
async def gradebook_get(ctx: Ctx, inp: CourseRef) -> Gradebook:
    return await service.get_gradebook(ctx, inp.course_id)


@capability(
    name="grading.course_result.update",
    summary="Change how a course is graded: official final grade, target, pass/fail, forecast.",
    description="""Use to enter the official final grade (`final_override_percentage`, which wins
over the calculated one; null clears it), set the target in grade points, switch a course to
pass/fail, or enter a final grade for a course without a gradebook (`manual_percentage` with
`gradebook_enabled: false`). To record the score of one assessment use
grading.assessment.update.""",
    effect="write",
    http=Http("PATCH", "/courses/{course_id}/grade"),
    tags=TAGS,
    agent_output_fields=("course_id", CHANGED),
)
async def course_result_update(ctx: Ctx, inp: CourseResultUpdateInput) -> CourseResult:
    return await service.update_result(ctx, inp)


@capability(
    name="grading.category.create",
    summary="Add an assessment category (e.g. 'Midterm') to a course's gradebook.",
    description="Use when the syllabus has a kind of assessment the built-in categories lack.",
    effect="write",
    http=Http("POST", "/courses/{course_id}/grading-categories"),
    tags=TAGS,
    agent_output_fields=("id", "key", "name"),
)
async def category_create(ctx: Ctx, inp: CategoryCreateInput) -> AssessmentCategory:
    return await service.create_category(ctx, inp)


@capability(
    name="grading.category.update",
    summary="Rename, recolor or archive an assessment category.",
    description="Partial update. Archived categories keep their assessments but leave the pickers.",
    effect="write",
    http=Http("PATCH", "/grading-categories/{category_id}"),
    tags=TAGS,
    agent_output_fields=("id", "name", CHANGED),
)
async def category_update(ctx: Ctx, inp: CategoryUpdateInput) -> AssessmentCategory:
    return await service.update_category(ctx, inp)


@capability(
    name="grading.category.delete",
    summary="Delete an assessment category; its assessments become uncategorised.",
    description="Irreversible, but no assessment is deleted. Prefer archiving.",
    effect="destructive",
    http=Http("DELETE", "/grading-categories/{category_id}"),
    preview=service.preview_category_delete,
    tags=TAGS,
)
async def category_delete(ctx: Ctx, inp: CategoryRef) -> Deleted:
    await service.delete_category(ctx, inp.category_id)
    return Deleted()


@capability(
    name="grading.category.reorder",
    summary="Set the display order of a course's assessment categories.",
    description="Categories not listed keep their order after the listed ones.",
    effect="write",
    http=Http("PUT", "/courses/{course_id}/grading-category-order"),
    tags=TAGS,
    agent_output_fields=("items.id", "items.name"),
)
async def category_reorder(ctx: Ctx, inp: CategoryOrderInput) -> CategoryList:
    return CategoryList(
        items=await service.reorder_categories(ctx, inp.course_id, inp.category_ids)
    )


# --- assessments ----------------------------------------------------------------------------


@capability(
    name="grading.assessment.list",
    summary="List a course's assessments with deadline, weight and score.",
    description="""Use to see what is graded, still pending or overdue in a course. To locate one
assessment the user named in words ("Lab 3", "the midterm"), prefer grading.assessment.find.""",
    effect="read",
    http=Http("GET", "/courses/{course_id}/assessments"),
    tags=TAGS,
    agent_default_fields=(
        "title",
        "category_id",
        "due_date",
        "weight",
        "score_percentage",
        "status",
    ),
)
async def assessment_list(ctx: Ctx, inp: AssessmentListInput) -> AssessmentPage:
    return await service.list_assessments(ctx, inp)


@capability(
    name="grading.assessment.find",
    summary="Find assessments by how the user names them: 'Lab 3', 'midterm'.",
    description="""Use first whenever the user refers to an assessment in words to get its id, then
update it. Searches the given course; otherwise the Program, ranking the current term's courses
first. Returns candidates with their course and a score; ask the user when the top candidates are
close. When none matches, read the course's grading.assessment.list before creating one: the
user may call it something else ("Q2" for "Quiz 2").""",
    effect="read",
    expose=("agent", "mcp"),
    tags=TAGS,
    agent_core=True,
)
async def assessment_find(ctx: Ctx, inp: AssessmentFindInput) -> AssessmentCandidates:
    return await service.find_assessments(ctx, inp)


@capability(
    name="grading.assessment.create",
    summary="Add an assessment (quiz, exam, assignment...) to a course gradebook.",
    description="""Use when the user adds a graded item. Give the deadline as `due_date` (and
`due_time` if known) in the Program's time zone. Do not use to record a score on an existing
assessment; use grading.assessment.update.""",
    effect="write",
    http=Http("POST", "/courses/{course_id}/assessments"),
    tags=TAGS,
    agent_output_fields=("id", "course_id", "title", "due_date", "weight"),
)
async def assessment_create(ctx: Ctx, inp: AssessmentCreateInput) -> Assessment:
    result = await service.create_assessments(ctx, inp.course_id, [inp], dedupe=False)
    return result.created[0]


@capability(
    name="grading.assessment.create_many",
    summary="Add several assessments at once.",
    description="""Use for assessments the user typed or listed in the chat. A grading scheme in a
file goes through imports.session.create, and LMS assignments through lms.assignment.import.
Items that carry `source_kind` and `source_ref` are skipped when the course
already has an assessment from the same source, so repeating an import creates no duplicates.""",
    effect="write",
    http=Http("POST", "/courses/{course_id}/assessments:batch"),
    tags=TAGS,
    agent_output_fields=("created.id", "created.title", "skipped"),
)
async def assessment_create_many(
    ctx: Ctx, inp: AssessmentCreateManyInput
) -> AssessmentCreateManyResult:
    return await service.create_assessments(ctx, inp.course_id, inp.assessments, dedupe=True)


@capability(
    name="grading.assessment.update",
    summary="Change an assessment, mainly to record its score.",
    description="""Record a score with `score_percentage` (82), or `points_earned` with
`points_possible` (18 of 20). Send null to clear the score again. Also changes title, category,
deadline, weight, `dropped` (ignore it in every calculation) and note. Only the fields that are sent
change.""",
    effect="write",
    http=Http("PATCH", "/assessments/{assessment_id}"),
    tags=TAGS,
    agent_core=True,
    preview=service.preview_assessment_update,
    agent_output_fields=("id", "title", "status", CHANGED),
)
async def assessment_update(ctx: Ctx, inp: AssessmentUpdateInput) -> Assessment:
    return await service.update_assessment(ctx, inp)


@capability(
    name="grading.assessment.delete",
    summary="Delete an assessment from a gradebook.",
    description="Irreversible. To ignore an assessment in the grade, set `dropped` instead.",
    effect="destructive",
    http=Http("DELETE", "/assessments/{assessment_id}"),
    preview=service.preview_assessment_delete,
    tags=TAGS,
)
async def assessment_delete(ctx: Ctx, inp: AssessmentRef) -> Deleted:
    await service.delete_assessment(ctx, inp.assessment_id)
    return Deleted()


@capability(
    name="grading.assessment.reorder",
    summary="Set the order of a course's assessments.",
    description="Assessments not listed keep their order after the listed ones.",
    effect="write",
    http=Http("PUT", "/courses/{course_id}/assessment-order"),
    tags=TAGS,
)
async def assessment_reorder(ctx: Ctx, inp: AssessmentOrderInput) -> AssessmentOrder:
    return await service.reorder_assessments(ctx, inp.course_id, inp.assessment_ids)


# --- what-if --------------------------------------------------------------------------------


@capability(
    name="grading.simulate.course",
    summary="What-if: the course figures if ungraded assessments scored the given marks.",
    description="""Use to answer "what if I get 80 on the final". Nothing is saved: never change
real scores to simulate. Scores it could not use (already graded, not of this course) come back in
`ignored`. Fails with grading.weights_not_100 while the weights do not add up.""",
    effect="read",
    http=Http("POST", "/courses/{course_id}/gradebook:simulate"),
    tags=TAGS,
    agent_output_fields=_SUMMARY_FIELDS,
)
async def simulate_course(ctx: Ctx, inp: SimulateCourseInput) -> SimulatedGradebook:
    return await service.simulate_course(ctx, inp)


@capability(
    name="grading.score.suggest",
    summary="Suggest a score for every ungraded assessment that reaches the target grade.",
    description="""Scores follow the student's results so far in each category and land exactly on
the target. Used to auto-fill a what-if plan. Fails with grading.weights_not_100 while the
weights do not add up.""",
    effect="read",
    http=Http("POST", "/courses/{course_id}/gradebook:suggest"),
    tags=TAGS,
)
async def suggest_scores(ctx: Ctx, inp: SuggestInput) -> ScoreSuggestion:
    return await service.suggest_scores(ctx, inp)


# --- summaries ------------------------------------------------------------------------------


@capability(
    name="grading.summary.term",
    summary="A term's GPA, average, credits and every course's grade.",
    description="""Use for "what is my GPA this term". Unfinished courses are left out unless
`include_in_progress` counts their current average.""",
    effect="read",
    http=Http("GET", "/terms/{term_id}/grade-summary"),
    tags=TAGS,
)
async def summary_term(ctx: Ctx, inp: TermSummaryInput) -> TermGrades:
    with academics.read_memo():
        return await service.term_grades(ctx, inp.term_id, inp.include_in_progress)


@capability(
    name="grading.simulate.term",
    summary="What-if for a term: the term GPA if unfinished courses ended with given marks.",
    description="""Pass assumed final percentages per unfinished course in `scores`; with
`target_gpa` the result says whether it is reachable and what average the other unfinished courses
need. Marks it could not use (finished or unknown courses) come back in `ignored`. Nothing is
saved.""",
    effect="read",
    http=Http("POST", "/terms/{term_id}/grade-summary:simulate"),
    tags=TAGS,
)
async def simulate_term(ctx: Ctx, inp: TermSimulateInput) -> TermGradeSimulation:
    return await service.simulate_term(ctx, inp)


@capability(
    name="grading.summary.program",
    summary="Cumulative GPA, earned credits, progress to graduation and GPA per term.",
    description="""Use for "what is my overall GPA" or "how many credits do I have left". Every
course counts once, a year-long one in the term the Program's setting names.""",
    effect="read",
    http=Http("GET", "/programs/{program_id}/grade-summary"),
    tags=TAGS,
)
async def summary_program(ctx: Ctx, inp: ProgramSummaryInput) -> ProgramGrades:
    with academics.read_memo():
        return await service.program_grades(ctx, inp.program_id, inp.include_in_progress)


@capability(
    name="grading.course_summary.list",
    summary="The grade, grade points and status of every course in a Program.",
    description="Use to compare courses or list which are finished, in progress or pass/fail.",
    effect="read",
    http=Http("GET", "/programs/{program_id}/course-grades"),
    tags=TAGS,
)
async def course_summaries(ctx: Ctx, inp: ProgramSummaryInput) -> CourseGrades:
    with academics.read_memo():
        return await service.course_grades(ctx, inp.program_id, inp.include_in_progress)
