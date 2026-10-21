from datetime import date, datetime, time
from typing import Annotated, Literal

from pydantic import BaseModel, Field, model_validator

from semestra.modules.academics.schemas import Id, Name

# Scores may exceed 100 (bonus marks); weights are shares of the course in percent.
PERCENT_MAX = 1000
Percent = Annotated[float, Field(ge=0, le=PERCENT_MAX)]
Weight = Annotated[float, Field(ge=0, le=100)]
Points = Annotated[float, Field(ge=0, le=100)]
Note = Annotated[str, Field(max_length=2000)]
CategoryKey = Annotated[str, Field(pattern=r"^[a-z0-9][a-z0-9_-]{0,31}$")]
# One of the built-in color names (resolved to theme tokens by the frontend) or "#rrggbb".
CategoryColor = Annotated[
    str, Field(pattern=r"^(blue|amber|emerald|violet|cyan|rose|slate|#[0-9a-fA-F]{6})$")
]

ForecastModel = Literal["auto", "simple_minimum_needed"]
YearAttribution = Literal["end_term", "split_evenly"]
Basis = Literal["percentage", "pass_fail"]
GradeStatus = Literal["completed", "in_progress", "passed", "failed"]
AssessmentStatus = Literal["graded", "pending", "overdue"]
SourceKind = Literal["lms", "syllabus", "manual"]


# --- grading scale --------------------------------------------------------------------------


class ScaleBand(BaseModel):
    min: Annotated[float, Field(ge=0, le=100)] = Field(description="Lowest percentage in the band")
    max: Annotated[float, Field(ge=0, le=100)] = Field(description="Highest percentage in the band")
    points: Points = Field(description="Grade points of the band")
    letter: Annotated[str, Field(max_length=8)] | None = Field(
        default=None, description="Letter grade shown for the band, e.g. 'A-'"
    )


class CategoryTemplate(BaseModel):
    key: CategoryKey = Field(description="Stable key such as 'quiz'; unique in the list")
    name: Name = Field(description="Display name")
    color: CategoryColor = Field(description="Color name or #rrggbb")


class GradingScale(BaseModel):
    program_id: str
    bands: list[ScaleBand] = Field(description="Highest percentage first")
    max_points: float = Field(description="Points of a perfect grade, e.g. 4.0")
    year_course_attribution: YearAttribution = Field(
        description="Which term a year-long course's grade counts in"
    )
    default_forecast_model: ForecastModel
    default_categories: list[CategoryTemplate] = Field(
        description="Categories every new course of the Program starts with"
    )
    hide_gpa: bool
    updated_at: datetime


class ScaleUpdateInput(BaseModel):
    """Only the fields that are sent change; `bands` replaces the whole table."""

    program_id: Id = Field(description="Program id")
    bands: list[ScaleBand] | None = Field(
        default=None,
        max_length=40,
        description="The percentage → points table; must cover 0-100 without overlapping",
    )
    max_points: Annotated[float, Field(gt=0, le=100)] | None = Field(
        default=None, description="Points of a perfect grade"
    )
    year_course_attribution: YearAttribution | None = Field(
        default=None, description="'end_term' counts a year-long course once in its last term"
    )
    default_forecast_model: ForecastModel | None = Field(
        default=None, description="Forecast model new courses start with"
    )
    default_categories: list[CategoryTemplate] | None = Field(
        default=None, max_length=30, description="Category template for new courses"
    )
    hide_gpa: bool | None = Field(default=None, description="Mask GPA figures in the interface")


class ScalePreset(BaseModel):
    id: str = Field(
        description=(
            "Preset id: uoft_4_0, us_4_0, us_4_33, standard_4_0, cn_100, au_7, kr_4_5, custom"
        )
    )
    max_points: float
    bands: list[ScaleBand]


class ScalePresets(BaseModel):
    items: list[ScalePreset]


# --- categories and assessments -------------------------------------------------------------


class AssessmentCategory(BaseModel):
    id: str
    course_id: str
    key: str
    name: str
    color: str
    position: int
    archived: bool


class CategoryList(BaseModel):
    items: list[AssessmentCategory]


class CategoryRef(BaseModel):
    category_id: Id = Field(description="Category id")


class CategoryCreateInput(BaseModel):
    course_id: Id = Field(description="Course id")
    name: Name = Field(description="Category name, e.g. 'Midterm'")
    color: CategoryColor = Field(default="slate", description="Color name or #rrggbb")
    key: CategoryKey | None = Field(
        default=None, description="Stable key; derived from the name when omitted"
    )


class CategoryUpdateInput(BaseModel):
    category_id: Id = Field(description="Category id")
    name: Name | None = Field(default=None, description="New name")
    color: CategoryColor | None = Field(default=None, description="New color")
    archived: bool | None = Field(
        default=None, description="Archived categories are hidden from pickers"
    )


class CategoryOrderInput(BaseModel):
    course_id: Id = Field(description="Course id")
    category_ids: list[Id] = Field(max_length=50, description="Category ids in display order")


class Assessment(BaseModel):
    id: str
    course_id: str
    category_id: str | None
    title: str
    due_at: datetime | None = Field(description="Deadline (UTC)")
    due_has_time: bool = Field(description="False when only the date is known")
    due_date: date | None = Field(description="Deadline date in the Program's time zone")
    due_time: time | None = Field(description="Deadline time in the Program's time zone")
    weight: float
    score_percentage: float | None
    points_earned: float | None
    points_possible: float | None
    dropped: bool
    note: str | None
    source_kind: SourceKind | None
    source_ref: str | None
    position: int
    status: AssessmentStatus
    created_at: datetime
    updated_at: datetime


AssessmentField = Literal[
    "course_id",
    "category_id",
    "title",
    "due_at",
    "due_has_time",
    "due_date",
    "due_time",
    "weight",
    "score_percentage",
    "points_earned",
    "points_possible",
    "dropped",
    "note",
    "source_kind",
    "source_ref",
    "position",
    "status",
    "created_at",
    "updated_at",
]


class AssessmentFields(BaseModel):
    """Fields shared by the creation inputs."""

    title: Name = Field(description="Assessment title, e.g. 'Midterm 1'")
    category_id: Id | None = Field(default=None, description="Category id")
    due_at: datetime | None = Field(
        default=None, description="Exact deadline with time zone; wins over due_date/due_time"
    )
    due_date: date | None = Field(
        default=None, description="Deadline date in the Program's time zone"
    )
    due_time: time | None = Field(
        default=None,
        description="Deadline time in the Program's time zone; without it the deadline is the end "
        "of due_date and only the date is shown",
    )
    weight: Weight = Field(default=0, description="Share of the course grade in percent")
    score_percentage: Percent | None = Field(
        default=None, description="Score in percent; leave empty until it is graded"
    )
    points_earned: Annotated[float, Field(ge=0, le=100000)] | None = Field(
        default=None, description="Points earned, e.g. 18 of 20; sets the percentage"
    )
    points_possible: Annotated[float, Field(gt=0, le=100000)] | None = Field(
        default=None, description="Points possible"
    )
    dropped: bool = Field(
        default=False, description="Ignored in every calculation (e.g. lowest quiz dropped)"
    )
    note: Note | None = Field(default=None, description="Free-form note")
    source_kind: SourceKind | None = Field(
        default=None, description="Where an imported item came from; used to skip duplicates"
    )
    source_ref: Annotated[str, Field(max_length=200)] | None = Field(
        default=None, description="Id of the item in its source, used with source_kind"
    )

    @model_validator(mode="after")
    def _source_is_complete(self) -> AssessmentFields:
        if (self.source_kind is None) != (self.source_ref is None):
            raise ValueError("source_kind and source_ref go together")
        return self


class AssessmentCreateInput(AssessmentFields):
    course_id: Id = Field(description="Course id")


class AssessmentCreateManyInput(BaseModel):
    course_id: Id = Field(description="Course id")
    assessments: list[AssessmentFields] = Field(
        min_length=1, max_length=200, description="Assessments to add"
    )


class SkippedAssessment(BaseModel):
    source_kind: SourceKind
    source_ref: str
    assessment_id: str = Field(description="The existing assessment with this source")


class AssessmentCreateManyResult(BaseModel):
    created: list[Assessment]
    skipped: list[SkippedAssessment] = Field(
        description="Items left out because the course already has one from the same source"
    )


class AssessmentUpdateInput(BaseModel):
    """Only the fields that are sent change. To record a score send `score_percentage`, or
    `points_earned` with `points_possible`; send null to clear it again."""

    assessment_id: Id = Field(description="Assessment id")
    title: Name | None = Field(default=None, description="Title")
    category_id: Id | None = Field(default=None, description="Category id, or null for none")
    due_at: datetime | None = Field(default=None, description="Exact deadline, or null to clear")
    due_date: date | None = Field(default=None, description="Deadline date, or null to clear")
    due_time: time | None = Field(default=None, description="Deadline time, or null for date only")
    weight: Weight | None = Field(default=None, description="Share of the course in percent")
    score_percentage: Percent | None = Field(default=None, description="Score in percent, or null")
    points_earned: Annotated[float, Field(ge=0, le=100000)] | None = Field(
        default=None, description="Points earned, or null"
    )
    points_possible: Annotated[float, Field(gt=0, le=100000)] | None = Field(
        default=None, description="Points possible, or null"
    )
    dropped: bool | None = Field(default=None, description="Ignored in every calculation")
    note: Note | None = Field(default=None, description="Note, or null to clear")


class AssessmentListInput(BaseModel):
    course_id: Id = Field(description="Course id")
    status: AssessmentStatus | None = Field(
        default=None, description="graded, pending (no score yet) or overdue (pending, past due)"
    )
    fields: list[AssessmentField] | None = Field(
        default=None,
        description="Agent/MCP only: return just these fields of each assessment (and its id)",
    )
    cursor: str | None = Field(default=None, description="`next_cursor` of the previous page")
    limit: Annotated[int, Field(ge=1, le=500)] = Field(default=200, description="Page size")


class AssessmentPage(BaseModel):
    items: list[Assessment]
    next_cursor: str | None


class AssessmentOrderInput(BaseModel):
    course_id: Id = Field(description="Course id")
    assessment_ids: list[Id] = Field(max_length=500, description="Assessment ids in order")


class AssessmentOrder(BaseModel):
    course_id: str
    assessment_ids: list[str]


class AssessmentRef(BaseModel):
    assessment_id: Id = Field(description="Assessment id")


class AssessmentFindInput(BaseModel):
    query: Annotated[str, Field(min_length=1, max_length=100)] = Field(
        description="How the user named it: 'Lab 3', 'midterm', 'assignment 2'"
    )
    course_id: Id | None = Field(
        default=None,
        description="Search only this course; otherwise the whole Program, the current term's "
        "courses first",
    )
    program_id: Id | None = Field(
        default=None, description="Program to search when no course is given"
    )
    limit: Annotated[int, Field(ge=1, le=20)] = Field(default=5, description="Max candidates")


class AssessmentCandidate(BaseModel):
    id: str
    course_id: str
    course_code: str | None
    course_title: str
    in_current_term: bool = Field(description="The course runs in the current term")
    title: str
    category_id: str | None
    category_name: str | None
    due_at: datetime | None
    weight: float
    score_percentage: float | None
    score: float = Field(description="Match quality from 0 to 1")


class AssessmentCandidates(BaseModel):
    items: list[AssessmentCandidate] = Field(description="Best match first")


# --- course result and gradebook ------------------------------------------------------------


class CourseResult(BaseModel):
    course_id: str
    basis: Basis
    manual_percentage: float | None
    final_override_percentage: float | None
    pass_fail_result: Literal["pass", "fail"] | None
    target_points: float | None = Field(description="Chosen goal; the scale's top points if null")
    forecast_model: ForecastModel
    gradebook_enabled: bool
    updated_at: datetime


class CourseResultUpdateInput(BaseModel):
    """Only the fields that are sent change; nullable fields accept null."""

    course_id: Id = Field(description="Course id")
    basis: Basis | None = Field(default=None, description="'pass_fail' courses have no GPA")
    manual_percentage: Percent | None = Field(
        default=None, description="Final grade of a course without a gradebook, or null"
    )
    final_override_percentage: Percent | None = Field(
        default=None, description="Official final grade; wins over the calculated one. Null clears"
    )
    pass_fail_result: Literal["pass", "fail"] | None = Field(
        default=None, description="Result of a pass/fail course, or null while unknown"
    )
    target_points: Points | None = Field(
        default=None, description="Goal in grade points, or null for the scale's maximum"
    )
    forecast_model: ForecastModel | None = Field(default=None, description="Forecast model")
    gradebook_enabled: bool | None = Field(
        default=None, description="False when only a final grade is entered for the course"
    )


class GradebookSummary(BaseModel):
    """Every figure of M03 §3 for one course; null where it cannot be calculated."""

    status: GradeStatus
    weight_total: float
    weight_gap: float = Field(description="100 - weight_total; positive means weight is missing")
    weights_ok: bool = Field(description="False: the weights do not add up to 100, so no figures")
    graded_count: int
    remaining_count: int
    graded_weight: float
    remaining_weight: float
    locked_contribution: float | None = Field(
        description="The final grade if everything still to come scored 0"
    )
    current_percentage: float | None = Field(description="Weighted average of the graded items")
    current_points: float | None
    current_letter: str | None
    final_percentage: float | None = Field(
        description="Official or fully calculated final grade, null while the course is running"
    )
    final_points: float | None
    final_letter: str | None
    final_source: Literal["override", "computed", "manual"] | None
    overridden: bool
    forecast_percentage: float | None = Field(description="Predicted final grade ('auto' model)")
    forecast_points: float | None
    forecast_letter: str | None
    predictions: dict[str, float] = Field(description="Predicted score per ungraded assessment id")
    missing_history_category_ids: list[str | None] = Field(
        description="Categories of ungraded items without any graded item to predict from"
    )
    target_points: float
    target_percentage: float | None = Field(description="Lowest percentage reaching the target")
    required_average: float | None = Field(
        description="Average the remaining items need to reach the target"
    )
    reachable: bool | None = Field(description="False when the target needs more than 100%")


class GradingScaleInfo(BaseModel):
    max_points: float
    hide_gpa: bool


class Gradebook(BaseModel):
    course_id: str
    program_id: str
    scale: GradingScaleInfo
    result: CourseResult
    categories: list[AssessmentCategory]
    assessments: list[Assessment]
    summary: GradebookSummary


class GradeTarget(BaseModel):
    kind: Literal["points", "percentage"] = Field(description="What `value` is measured in")
    value: Annotated[float, Field(ge=0, le=1000)] = Field(description="Target value")


class IgnoredScore(BaseModel):
    id: str
    reason: Literal["graded", "unknown"] = Field(
        description="graded: it already has a real score; unknown: not an assessment of this course"
    )


class SimulatedGradebook(GradebookSummary):
    ignored: list[IgnoredScore] = Field(description="Assumed scores that were not used")


class SimulateCourseInput(BaseModel):
    course_id: Id = Field(description="Course id")
    scores: dict[str, Percent] = Field(
        default_factory=dict,
        description="Assumed score in percent per ungraded assessment id; nothing is saved",
    )
    target: GradeTarget | None = Field(
        default=None, description="Goal; the course's own target when omitted"
    )


class SuggestInput(BaseModel):
    course_id: Id = Field(description="Course id")
    target: GradeTarget | None = Field(
        default=None, description="Goal; the course's own target when omitted"
    )


class SuggestedScore(BaseModel):
    assessment_id: str
    score: float


class ScoreSuggestion(BaseModel):
    items: list[SuggestedScore]
    target_percentage: float | None
    resulting_percentage: float
    reachable: bool


# --- term and Program summaries -------------------------------------------------------------


class CourseGrade(BaseModel):
    """A course's effective grade as the summaries count it."""

    course_id: str
    code: str | None
    title: str
    alias: str | None
    credits: float
    include_in_gpa: bool
    basis: Basis
    status: GradeStatus
    percentage: float | None
    current_percentage: float | None
    points: float | None
    letter: str | None
    counts_in_gpa: bool
    year_long: bool
    attributed_credits: float | None = Field(
        description="Credits that land in the requested term (term summaries only)"
    )


class TermSummaryInput(BaseModel):
    term_id: Id = Field(description="Term id")
    include_in_progress: bool = Field(
        default=False, description="Count the current average of unfinished courses"
    )


class ProgramSummaryInput(BaseModel):
    program_id: Id = Field(description="Program id")
    include_in_progress: bool = Field(
        default=False, description="Count the current average of unfinished courses"
    )


class TermGrades(BaseModel):
    term_id: str
    max_points: float
    hide_gpa: bool
    gpa: float | None
    average_percentage: float | None
    credits_counted: float = Field(description="Credits behind the GPA")
    credits_total: float = Field(description="Credits of all courses landing in the term")
    credits_earned: float
    excluded_count: int = Field(description="Courses not counted towards the GPA")
    courses: list[CourseGrade]


class TermSimulateInput(BaseModel):
    term_id: Id = Field(description="Term id")
    scores: dict[str, Percent] = Field(
        default_factory=dict,
        description="Assumed final percentage per unfinished course id; nothing is saved",
    )
    target_gpa: Points | None = Field(default=None, description="Term GPA to aim for")
    include_in_progress: bool = Field(
        default=False, description="Count the current average of unfinished courses"
    )


class IgnoredCourseScore(BaseModel):
    id: str
    reason: Literal["finished", "unknown"] = Field(
        description="finished: the course already has its final grade (or is not graded by "
        "percentage); unknown: not a course of this term that counts towards its GPA"
    )


class TermGradeSimulation(BaseModel):
    term_id: str
    gpa: float | None
    average_percentage: float | None
    credits_counted: float
    target_gpa: float | None
    gap: float | None = Field(description="target - simulated GPA; positive means short")
    max_possible_gpa: float | None
    reachable: bool | None
    required_percentage: float | None = Field(
        description="One average for the courses left blank that reaches the target"
    )
    ignored: list[IgnoredCourseScore] = Field(description="Assumed percentages that were not used")


class TermGradePoint(BaseModel):
    term_id: str
    name: str
    start_date: date
    gpa: float | None
    cumulative_gpa: float | None
    credits_counted: float
    cumulative_credits: float


class ProgramGrades(BaseModel):
    program_id: str
    max_points: float
    hide_gpa: bool
    gpa: float | None
    average_percentage: float | None
    credits_counted: float
    credits_earned: float
    credits_required: float | None
    progress: float | None = Field(description="credits_earned / credits_required, 0-1")
    graded_course_count: int
    term_count: int
    terms: list[TermGradePoint] = Field(description="Chronological, for charts")


class CourseGrades(BaseModel):
    program_id: str
    max_points: float
    hide_gpa: bool
    items: list[CourseGrade]
