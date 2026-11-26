"""Assignments as every place shows them (M09 §4.5, §5): the one assembly of their facts
(`assignment_facts`) into what the details, the gradebook, the lists and Sem read.

The facts come from the mirror, or from the platform where the mirror can't stand in; the
assembly is the same either way. A quiz is also asked for by its own id (`quiz:<id>`, what a link
to a quiz knows): it opens its assignment, or, having none (a practice quiz), what the quiz
itself says.
"""

from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.modules.academics import service as academics
from semestra.modules.academics.models import AcademicsCourse
from semestra.modules.grading import service as grading
from semestra.modules.lms import announcements, reads, rules, service, sync_state
from semestra.modules.lms import assignment_facts as facts
from semestra.modules.lms.assignment_facts import Facts
from semestra.modules.lms.errors import lms_error
from semestra.modules.lms.models import LmsAssignment, LmsCourseLink, LmsImportedRef
from semestra.modules.lms.schemas.dto import FileMeta, Quiz
from semestra.modules.lms.schemas.io import (
    AssignmentDetail,
    AssignmentList,
    AssignmentsInput,
    AssignmentTarget,
    AssignmentTargets,
    InGradebook,
    InTasks,
    QuizFacts,
)
from semestra.modules.lms.sync_assignments import has_feedback
from semestra.modules.tasks.models import TasksItem

# How a quiz is asked for by its own id.
QUIZ = "quiz:"


def state(f: Facts) -> rules.AssignmentState | None:
    return rules.facts_state(f.assignment, f.submission)


def item(f: Facts, imported_as: dict[str, str] | None, now: datetime) -> dict[str, Any]:
    """One assignment of a list (`AssignmentOut`)."""
    st = state(f)
    return {
        **f.assignment,
        "submission": f.submission,
        "ref": f"assignment:{f.external_id}",
        "imported_as": imported_as,
        "state": st,
        "marks": rules.facts_marks(st, f.submission),
        "due_state": rules.facts_due_state(f.assignment, st, now),
    }


async def imported(ctx: Ctx, link_id: str) -> dict[str, LmsImportedRef]:
    """The course's refs by external id (imported or ignored)."""
    return {
        r.external_id: r
        for r in await ctx.db.scalars(
            select(LmsImportedRef).where(LmsImportedRef.link_id == link_id)
        )
    }


def new_ids(items: Sequence[Facts], refs: dict[str, LmsImportedRef], now: datetime) -> list[str]:
    """M09 table 3e over a course's assignments, soonest due first."""
    found = [
        f
        for f in items
        if rules.is_new(
            f.assignment,
            f.submission,
            imported=(ref := refs.get(f.external_id)) is not None and ref.target_id is not None,
            dismissed=ref is not None and ref.dismissed_at is not None,
            now=now,
        )
    ]
    found.sort(key=lambda f: str(f.assignment.get("due_at")))
    return [f.external_id for f in found]


def _due(f: Facts) -> datetime | None:
    raw = f.assignment.get("due_at")
    return datetime.fromisoformat(raw) if raw else None


async def course_list(ctx: Ctx, inp: AssignmentsInput) -> AssignmentList:
    """The course's assignments with what each was imported as (and the course total when
    asked). The filters narrow `items` only: `new_ids` is about the whole list."""
    linked = await service.require_link(ctx, inp.course_id)
    got = await facts.course(ctx, inp.course_id, refresh=inp.refresh, linked=linked)
    refs = await imported(ctx, linked[0].id)
    zone = await reads.course_zone(ctx, inp.course_id) if inp.due_after or inp.due_before else UTC
    after, before = reads.aware(inp.due_after, zone), reads.aware(inp.due_before, zone)
    items: list[dict[str, Any]] = []
    for f in got.items:
        due = _due(f)
        if after and (due is None or due < after):
            continue
        if before and (due is None or due > before):
            continue
        if inp.state is not None and state(f) != inp.state:
            continue
        ref = refs.get(f.external_id)
        target = (
            {"kind": ref.target_kind or "", "id": ref.target_id}
            if ref is not None and ref.target_id is not None
            else None
        )
        items.append(item(f, target, ctx.now))
    return AssignmentList.model_validate(
        {
            "items": items,
            "new_ids": new_ids(got.items, refs, ctx.now),
            "total": got.total if inp.include_total else None,
            "truncated": got.truncated,
            "source": got.source.kind,
            "as_of": got.source.as_of,
        }
    )


# --- one assignment --------------------------------------------------------------------------


def _practice(provider: str, quiz: Quiz) -> AssignmentDetail:
    """A quiz without an assignment, in the shape of one."""
    return AssignmentDetail.model_validate(
        {
            "provider": provider,
            "assignment": {
                **quiz.model_dump(
                    exclude={"title", "question_count", "time_limit", "assignment_id"}
                ),
                "external_id": f"{QUIZ}{quiz.external_id}",
                "raw_kind": "practice_quiz",
                "name": quiz.title,
            },
            "submission": None,
            "quiz": QuizFacts(question_count=quiz.question_count, time_limit=quiz.time_limit),
            "practice": True,
            "source": "live",
            "as_of": None,
            "state": None,
            # Not graded, nothing to hand in: no due hint (M09 table 3d).
            "due_state": "none",
            "assessment": None,
            "task": None,
        }
    )


async def _places(
    ctx: Ctx, link: LmsCourseLink | None, f: Facts
) -> tuple[InGradebook | None, InTasks | None]:
    """Where the assignment is in Semestra: what it is imported as, else what it is held for."""
    kind, target_id = f.held_for or (None, None)
    if link is not None and f.held_for is None:
        ref = await facts_ref(ctx, link.id, f.external_id)
        if ref is not None and ref.target_id is not None:
            kind, target_id = ref.target_kind, ref.target_id
    assessment = None
    if kind == "assessment" and target_id:
        row = (await grading.find_assessment_rows(ctx, [target_id])).get(target_id)
        assessment = InGradebook(id=row.id, weight=row.weight) if row else None
    task = None
    if assessment is not None or (kind == "task" and target_id):
        task = await ctx.db.scalar(
            select(TasksItem).where(
                TasksItem.user_id == ctx.user_id,
                TasksItem.assessment_id == assessment.id
                if assessment
                else TasksItem.id == target_id,
            )
        )
    return assessment, (
        InTasks(id=task.id, completed=task.completed_at is not None) if task else None
    )


async def facts_ref(ctx: Ctx, link_id: str, external_id: str) -> LmsImportedRef | None:
    return await ctx.db.scalar(
        select(LmsImportedRef).where(
            LmsImportedRef.link_id == link_id, LmsImportedRef.external_id == external_id
        )
    )


async def detail(ctx: Ctx, f: Facts, link: LmsCourseLink | None) -> AssignmentDetail:
    """The whole of one assignment (§7.3)."""
    assessment, task = await _places(ctx, link, f)
    st = state(f)
    mirror = f.source.kind == "mirror" and f.held_for is None
    stale, submission_as_of = (
        await sync_state.assignment_behind(ctx, link, f.external_id)
        if mirror and link is not None
        else (False, None)
    )
    return AssignmentDetail.model_validate(
        {
            "provider": f.provider,
            "assignment": f.assignment,
            "submission": f.submission,
            "quiz": f.quiz,
            "source": f.source.kind,
            "as_of": f.source.as_of,
            "held": f.held_for is not None,
            "stale": stale,
            "submission_as_of": submission_as_of,
            "area_hidden": bool(mirror and link and rules.area_closed(link.area_reads, facts.AREA)),
            "assessment": assessment,
            "task": task,
            "targets": (
                await announcements.link_targets(ctx, link, f.assignment.get("html"))
                if link is not None
                else []
            ),
            "state": st,
            "marks": rules.facts_marks(st, f.submission),
            "due_state": rules.facts_due_state(f.assignment, st, ctx.now),
        }
    )


async def get(
    ctx: Ctx, course_id: str, ref: str, refresh: bool, *, held_for: str | None = None
) -> AssignmentDetail:
    await academics.get_course_row(ctx, course_id)  # owned, or not found
    link = await service.link_row(ctx, course_id)
    if held_for is not None:
        kind, target_id = held_for.split(":", 1)
        row = await ctx.db.scalar(
            select(LmsAssignment).where(
                LmsAssignment.user_id == ctx.user_id,
                LmsAssignment.course_id == course_id,
                LmsAssignment.held_for_kind == kind,
                LmsAssignment.held_for_id == target_id,
                LmsAssignment.external_id == ref,
            )
        )
        if row is not None:
            return await detail(ctx, facts.from_row(row, link), link)
    if ref.startswith(QUIZ):
        quiz_id = ref.removeprefix(QUIZ)
        kept = None if refresh else await facts.by_quiz(ctx, course_id, quiz_id)
        if kept is not None:
            return await detail(ctx, kept, link)
        if link is None:
            raise lms_error("lms.course_not_linked")
        found = await reads.quizzes(ctx, course_id, refresh)
        quiz = next((q for q in found.items if q.external_id == quiz_id), None)
        if quiz is None:
            raise lms_error("lms.not_found")
        if quiz.assignment_id is None:
            _, b = await service.require_link(ctx, course_id)
            return _practice(b.row.provider, quiz)
        ref = quiz.assignment_id
    return await detail(ctx, await facts.one(ctx, course_id, ref, refresh=refresh), link)


# --- the gradebook ---------------------------------------------------------------------------


def _target(f: Facts, course_id: str, kind: str, target_id: str, now: datetime) -> AssignmentTarget:
    s = f.submission
    a = f.assignment
    graded = kind == "assessment"
    return AssignmentTarget(
        course_id=course_id,
        assignment_id=f.external_id,
        assessment_id=target_id if graded else None,
        task_id=None if graded else target_id,
        feedback=graded and has_feedback(s),
        status=rules.status_of(s) if s is not None else None,
        missing=bool(s and s.get("missing")),
        late=bool(s and s.get("late")),
        submitted_at=s.get("submitted_at") if s else None,
        online=rules.submits_online(list(a.get("submission_types") or [])),
        due_state=rules.facts_due_state(a, rules.facts_state(a, s), now),
        submission_types=list(a.get("submission_types") or []),
        is_quiz=a.get("quiz_id") is not None,
        locked=bool(a.get("locked")),
        lock_explanation=a.get("lock_explanation"),
        web_url=a.get("web_url"),
    )


async def targets(ctx: Ctx, program_id: str) -> AssignmentTargets:
    """The Program's assessments and to-dos that are an assignment of the platform (imported:
    with the mirror's facts; held for them: as last read), from the database only."""
    await academics.get_program_row(ctx, program_id)  # owned, or not found
    courses = select(AcademicsCourse.id).where(
        AcademicsCourse.user_id == ctx.user_id, AcademicsCourse.program_id == program_id
    )
    refs = (
        await ctx.db.execute(
            select(LmsImportedRef, LmsCourseLink)
            .join(LmsCourseLink, LmsCourseLink.id == LmsImportedRef.link_id)
            .where(
                LmsImportedRef.user_id == ctx.user_id,
                LmsCourseLink.course_id.in_(courses),
                LmsImportedRef.target_id.is_not(None),
            )
        )
    ).all()
    rows = list(
        await ctx.db.scalars(
            select(LmsAssignment).where(
                LmsAssignment.user_id == ctx.user_id, LmsAssignment.course_id.in_(courses)
            )
        )
    )
    mirror = {(r.link_id, r.external_id): r for r in rows if r.link_id is not None}
    found: list[AssignmentTarget] = []
    for ref, link in refs:
        assert ref.target_kind is not None
        assert ref.target_id is not None
        row = mirror.get((link.id, ref.external_id))
        if row is not None:
            found.append(
                _target(
                    facts.from_row(row, link),
                    link.course_id,
                    ref.target_kind,
                    ref.target_id,
                    ctx.now,
                )
            )
        else:
            # Never read by the sync yet: it opens all the same (the platform is read then).
            graded = ref.target_kind == "assessment"
            found.append(
                AssignmentTarget(
                    course_id=link.course_id,
                    assignment_id=ref.external_id,
                    assessment_id=ref.target_id if graded else None,
                    task_id=None if graded else ref.target_id,
                )
            )
    for row in rows:
        if row.held_for_kind is not None and row.held_for_id is not None:
            held = _target(
                facts.from_row(row, None),
                row.course_id,
                row.held_for_kind,
                row.held_for_id,
                ctx.now,
            )
            held.held = True
            found.append(held)
    return AssignmentTargets(items=found)


async def submitted_file(ctx: Ctx, course_id: str, assignment_id: str, file_id: str) -> FileMeta:
    """A file of the user's own submission, as the file proxy opens it: from the address the
    submission gives now (the mirror keeps files by name only; a submitted file is not one of
    the course's files)."""
    detail_ = await reads.submission(ctx, course_id, assignment_id, False)
    for f in detail_.files:
        if f.external_id == file_id and f.download_url:
            return FileMeta(
                external_id=file_id,
                name=f.name,
                mime_type=f.mime_type,
                size_bytes=f.size_bytes,
                download_url=f.download_url,
            )
    raise lms_error("lms.not_found")
