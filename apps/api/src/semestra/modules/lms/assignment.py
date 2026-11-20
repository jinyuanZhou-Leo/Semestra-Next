"""One assignment, whole (M09 §5): what every place that mentions an assignment opens.

The platform is asked first: the assignment (from the course's cached list), the user's own
submission with the teacher's feedback, and for a quiz its question count and time limit. When
the platform can't be asked (unreachable, the course no longer linked, the assignment gone from
it) and the assignment was imported, the answer is what the sync kept (`LmsFeedback`), marked
with when it was read and why. An assignment never imported has nothing kept: the error stands.
"""

from typing import Any

from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules.academics import service as academics
from semestra.modules.academics.models import AcademicsCourse
from semestra.modules.grading import service as grading
from semestra.modules.lms import announcements, reads, service
from semestra.modules.lms.errors import lms_error
from semestra.modules.lms.models import LmsCourseLink, LmsFeedback, LmsImportedRef
from semestra.modules.lms.schemas.dto import FileMeta, SubmissionDetail
from semestra.modules.lms.schemas.io import (
    AssignmentDetail,
    AssignmentTarget,
    AssignmentTargets,
    InGradebook,
    InTasks,
    QuizFacts,
)
from semestra.modules.lms.service import Bound
from semestra.modules.tasks.models import TasksItem


async def _kept(ctx: Ctx, course_id: str, assignment_id: str) -> LmsFeedback | None:
    """What the sync kept of the assignment; the assessment's row when a to-do has one too."""
    rows = await ctx.db.scalars(
        select(LmsFeedback)
        .where(
            LmsFeedback.user_id == ctx.user_id,
            LmsFeedback.course_id == course_id,
            LmsFeedback.assignment_id == assignment_id,
        )
        .order_by(LmsFeedback.assessment_id.is_(None), LmsFeedback.read_at.desc())
    )
    return rows.first()


async def _places(
    ctx: Ctx, link: LmsCourseLink | None, kept: LmsFeedback | None, assignment_id: str
) -> tuple[InGradebook | None, InTasks | None]:
    """Where the assignment is in Semestra: what it is imported as, else what kept it."""
    assessment_id = kept.assessment_id if kept else None
    task_id = kept.task_id if kept else None
    if link is not None:
        ref = await ctx.db.scalar(
            select(LmsImportedRef).where(
                LmsImportedRef.link_id == link.id,
                LmsImportedRef.external_id == assignment_id,
                LmsImportedRef.target_id.is_not(None),
            )
        )
        if ref is not None and ref.target_kind == "assessment":
            assessment_id, task_id = ref.target_id, None
        elif ref is not None:
            assessment_id, task_id = None, ref.target_id
    assessment = None
    if assessment_id:
        row = (await grading.find_assessment_rows(ctx, [assessment_id])).get(assessment_id)
        assessment = InGradebook(id=row.id, weight=row.weight) if row else None
    task = await ctx.db.scalar(
        select(TasksItem).where(
            TasksItem.user_id == ctx.user_id,
            TasksItem.assessment_id == assessment.id if assessment else TasksItem.id == task_id,
        )
    )
    return assessment, (
        InTasks(id=task.id, completed=task.completed_at is not None) if task else None
    )


async def _quiz(
    ctx: Ctx, course_id: str, assignment_id: str, b: Bound, refresh: bool
) -> QuizFacts | None:
    if "quizzes" not in b.provider.features:
        return None
    try:
        found = await reads.quizzes(ctx, course_id, refresh)
    except AppError as exc:
        if not exc.code.startswith("lms."):
            raise
        return None  # the quizzes are hidden: the assignment still opens
    for quiz in found.items:
        if quiz.assignment_id == assignment_id:
            return QuizFacts(question_count=quiz.question_count, time_limit=quiz.time_limit)
    return None


async def _live(
    ctx: Ctx, linked: tuple[LmsCourseLink, Bound], course_id: str, assignment_id: str, refresh: bool
) -> dict[str, Any]:
    _, b = linked

    async def find(again: bool) -> dict[str, Any] | None:
        listed, _ = await reads.raw_assignments(ctx, course_id, again, linked=linked)
        return next((a for a in listed if a["external_id"] == assignment_id), None)

    # One published since the list was cached is found by reading the list again.
    found = await find(refresh) or (None if refresh else await find(True))
    if found is None:
        raise lms_error("lms.not_found")
    submission = None
    if "submissions" in b.provider.features:
        try:
            submission = await reads.submission(ctx, course_id, assignment_id, refresh)
        except AppError as exc:
            if exc.code not in reads.ITEM_ERRORS:
                raise
    quiz = (
        await _quiz(ctx, course_id, assignment_id, b, refresh)
        if found.get("raw_kind") == "quiz"
        else None
    )
    return {
        "provider": b.row.provider,
        "assignment": {**found, "submission": None},
        "submission": submission,
        "quiz": quiz,
    }


def _from_kept(row: LmsFeedback, title: str, problem: str) -> dict[str, Any]:
    """The answer from what the sync kept. A row kept before descriptions were (`details`
    null) has the feedback only: the assignment is named after what it was imported as."""
    submission = SubmissionDetail.model_validate(
        {
            "external_id": row.assignment_id,
            "assignment_id": row.assignment_id,
            **(row.work or {}),
            "score": row.score,
            "grade": row.grade,
            "attempt": row.attempt,
            "graded_at": row.graded_at,
            "comments": row.comments,
            "rubric_scores": row.rubric_scores,
        }
    )
    return {
        "provider": row.provider,
        "assignment": {
            "external_id": row.assignment_id,
            "name": title,
            **(row.details or {}),
            "web_url": row.web_url,
            "points": row.points,
            "rubric": row.rubric,
        },
        "submission": submission,
        "kept": True,
        "kept_at": row.read_at,
        "problem": problem,
    }


async def get(ctx: Ctx, course_id: str, assignment_id: str, refresh: bool) -> AssignmentDetail:
    await academics.get_course_row(ctx, course_id)  # owned, or not found
    kept = await _kept(ctx, course_id, assignment_id)
    link: LmsCourseLink | None = None
    try:
        linked = await service.require_link(ctx, course_id)
        link = linked[0]
        answer = await _live(ctx, linked, course_id, assignment_id, refresh)
        assessment, task = await _places(ctx, link, kept, assignment_id)
        answer["targets"] = await announcements.link_targets(
            ctx, link, answer["assignment"].get("html")
        )
    except AppError as exc:
        if kept is None or not exc.code.startswith("lms."):
            raise
        assessment, task = await _places(ctx, link, kept, assignment_id)
        title = ""
        if assessment is not None:
            found = await grading.find_assessment_rows(ctx, [assessment.id])
            title = found[assessment.id].title
        elif task is not None:
            title = (await ctx.db.get_one(TasksItem, task.id)).title
        answer = _from_kept(kept, title, exc.code)
    return AssignmentDetail.model_validate({**answer, "assessment": assessment, "task": task})


async def targets(ctx: Ctx, program_id: str) -> AssignmentTargets:
    """The Program's assessments and to-dos that are an assignment of the platform (imported,
    or kept from when they were), from the database only: what their rows open."""
    await academics.get_program_row(ctx, program_id)  # owned, or not found
    courses = select(AcademicsCourse.id).where(
        AcademicsCourse.user_id == ctx.user_id, AcademicsCourse.program_id == program_id
    )
    found: dict[tuple[str, str], AssignmentTarget] = {}
    kept = await ctx.db.scalars(
        select(LmsFeedback)
        .where(LmsFeedback.user_id == ctx.user_id, LmsFeedback.course_id.in_(courses))
        .order_by(LmsFeedback.assessment_id.is_not(None))
    )
    for row in kept:
        found[row.course_id, row.assignment_id] = AssignmentTarget(
            course_id=row.course_id,
            assignment_id=row.assignment_id,
            assessment_id=row.assessment_id,
            task_id=row.task_id,
        )
    refs = await ctx.db.execute(
        select(LmsImportedRef, LmsCourseLink.course_id)
        .join(LmsCourseLink, LmsCourseLink.id == LmsImportedRef.link_id)
        .where(
            LmsImportedRef.user_id == ctx.user_id,
            LmsCourseLink.course_id.in_(courses),
            LmsImportedRef.target_id.is_not(None),
        )
    )
    for ref, course_id in refs:
        graded = ref.target_kind == "assessment"
        found[course_id, ref.external_id] = AssignmentTarget(
            course_id=course_id,
            assignment_id=ref.external_id,
            assessment_id=ref.target_id if graded else None,
            task_id=None if graded else ref.target_id,
        )
    return AssignmentTargets(items=list(found.values()))


async def submitted_file(ctx: Ctx, course_id: str, assignment_id: str, file_id: str) -> FileMeta:
    """A file of the user's own submission, as the file proxy opens it: from the address the
    submission gave (no file lookup: a submitted file is not one of the course's files)."""
    detail = await reads.submission(ctx, course_id, assignment_id, False)
    for f in detail.files:
        if f.external_id == file_id and f.download_url:
            return FileMeta(
                external_id=file_id,
                name=f.name,
                mime_type=f.mime_type,
                size_bytes=f.size_bytes,
                download_url=f.download_url,
            )
    raise lms_error("lms.not_found")
