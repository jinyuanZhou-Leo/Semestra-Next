"""Assessments: create, change, reorder, find, deadlines (M03)."""

from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, time
from difflib import SequenceMatcher
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import func, select

from semestra.core.context import Ctx
from semestra.core.db import new_id
from semestra.core.errors import AppError, not_found
from semestra.core.events import events
from semestra.modules.academics import rules as academic_rules
from semestra.modules.academics import service as academics
from semestra.modules.academics.models import AcademicsProgram
from semestra.modules.grading import models
from semestra.modules.grading.schemas import (
    PERCENT_MAX,
    Assessment,
    AssessmentCandidate,
    AssessmentCandidates,
    AssessmentCreateManyResult,
    AssessmentFields,
    AssessmentFindInput,
    AssessmentListInput,
    AssessmentOrder,
    AssessmentPage,
    AssessmentRef,
    AssessmentUpdateInput,
    CategoryRef,
    SkippedAssessment,
    UpcomingAssessments,
    UpcomingInput,
)
from semestra.modules.grading.service.categories import _announce_course, _get_category
from semestra.modules.grading.service.common import _program_courses, _reject_nulls
from semestra.modules.grading.service.courses import _course_and_program, ensure_course_setup


def _local(due_at: datetime, tz: str) -> datetime:
    return due_at.astimezone(ZoneInfo(tz))


def assessment_out(row: models.GradingAssessment, tz: str, now: datetime) -> Assessment:
    local = _local(row.due_at, tz) if row.due_at is not None else None
    if row.score_percentage is not None:
        status = "graded"
    elif row.due_at is not None and row.due_at < now:
        status = "overdue"
    else:
        status = "pending"
    return Assessment.model_validate(
        {
            **{c.key: getattr(row, c.key) for c in row.__table__.columns},
            "due_date": local.date() if local else None,
            "due_time": local.time().replace(second=0, microsecond=0)
            if local and row.due_has_time
            else None,
            "status": status,
        }
    )


async def _assessment_rows(
    ctx: Ctx, course_ids: Sequence[str]
) -> dict[str, list[models.GradingAssessment]]:
    out: dict[str, list[models.GradingAssessment]] = defaultdict(list)
    if not course_ids:
        return out
    rows = (
        await ctx.db.scalars(
            select(models.GradingAssessment)
            .where(
                models.GradingAssessment.user_id == ctx.user_id,
                models.GradingAssessment.course_id.in_(course_ids),
            )
            .order_by(models.GradingAssessment.position, models.GradingAssessment.created_at)
        )
    ).all()
    for row in rows:
        out[row.course_id].append(row)
    return out


async def find_assessment_row(ctx: Ctx, assessment_id: str) -> models.GradingAssessment | None:
    """The ctx user's assessment, or None (for other modules: M05 keeps its tasks in sync)."""
    row = await ctx.db.get(models.GradingAssessment, assessment_id)
    return row if row is not None and row.user_id == ctx.user_id else None


async def dated_unscored_assessment_rows(
    ctx: Ctx, program_id: str
) -> list[models.GradingAssessment]:
    """A Program's assessments with a due date and no score yet, soonest first."""
    return list(
        await ctx.db.scalars(
            select(models.GradingAssessment)
            .where(
                models.GradingAssessment.user_id == ctx.user_id,
                models.GradingAssessment.course_id.in_(
                    [c.id for c in await _program_courses(ctx, program_id)]
                ),
                models.GradingAssessment.due_at.is_not(None),
                models.GradingAssessment.score_percentage.is_(None),
            )
            .order_by(models.GradingAssessment.due_at)
        )
    )


async def _get_assessment(ctx: Ctx, assessment_id: str) -> models.GradingAssessment:
    row = await ctx.db.get(models.GradingAssessment, assessment_id)
    if row is None or row.user_id != ctx.user_id:
        raise not_found("assessment", assessment_id)
    return row


def _resolve_due(
    tz: str, due_at: datetime | None, due_date: date | None, due_time: time | None
) -> tuple[datetime | None, bool]:
    """The stored deadline (UTC) and whether it has a time of day (M03 §2).

    A date without a time means "by the end of that day", stored as 23:59 local time.
    """
    zone = ZoneInfo(tz)
    if due_at is not None:
        aware = due_at if due_at.tzinfo is not None else due_at.replace(tzinfo=zone)
        return aware.astimezone(UTC), True
    if due_date is None:
        return None, False
    local = datetime.combine(due_date, due_time or time(23, 59), tzinfo=zone)
    return local.astimezone(UTC), due_time is not None


async def _check_category(ctx: Ctx, course_id: str, category_id: str | None) -> None:
    if category_id is None:
        return
    row = await _get_category(ctx, category_id)
    if row.course_id != course_id:
        raise not_found("category", category_id)


def _score_fields(
    earned: float | None, possible: float | None, percentage: float | None
) -> tuple[float | None, float | None, float | None]:
    """(score_percentage, points_earned, points_possible) as stored."""
    if earned is not None:
        if possible is None:
            raise AppError("grading.points_invalid", 422, reason="points_possible_missing")
        derived = earned / possible * 100
        if derived > PERCENT_MAX:  # the same bound the percentage field itself enforces
            raise AppError("grading.points_invalid", 422, reason="percentage_out_of_range")
        return derived, earned, possible
    return percentage, None, possible if percentage is None else None


async def _next_position(ctx: Ctx, course_id: str) -> int:
    last = await ctx.db.scalar(
        select(func.max(models.GradingAssessment.position)).where(
            models.GradingAssessment.user_id == ctx.user_id,
            models.GradingAssessment.course_id == course_id,
        )
    )
    return (last + 1) if last is not None else 0


def _new_assessment(
    ctx: Ctx, course_id: str, tz: str, fields: AssessmentFields, position: int
) -> models.GradingAssessment:
    due_at, has_time = _resolve_due(tz, fields.due_at, fields.due_date, fields.due_time)
    percentage, earned, possible = _score_fields(
        fields.points_earned, fields.points_possible, fields.score_percentage
    )
    return models.GradingAssessment(
        id=new_id(),
        user_id=ctx.user_id,
        course_id=course_id,
        category_id=fields.category_id,
        title=fields.title.strip(),
        due_at=due_at,
        due_has_time=has_time,
        weight=fields.weight,
        score_percentage=percentage,
        points_earned=earned,
        points_possible=possible,
        dropped=fields.dropped,
        note=fields.note,
        source_kind=fields.source_kind,
        source_ref=fields.source_ref,
        position=position,
        created_at=ctx.now,
        updated_at=ctx.now,
    )


async def _announce_assessment(
    ctx: Ctx, kind: str, row: models.GradingAssessment, program_id: str, changed: Sequence[str]
) -> None:
    await events.publish(
        ctx,
        f"grading.assessment.{kind}",
        {
            "assessment_id": row.id,
            "course_id": row.course_id,
            "program_id": program_id,
            "changed": list(changed),
            "due_changed": bool({"due_at", "due_has_time"} & set(changed)),
        },
    )


async def create_assessments(
    ctx: Ctx, course_id: str, items: Sequence[AssessmentFields], *, dedupe: bool
) -> AssessmentCreateManyResult:
    course, program = await _course_and_program(ctx, course_id)
    await ensure_course_setup(ctx, course.id, program.id)
    for item in items:
        await _check_category(ctx, course.id, item.category_id)
    known: dict[tuple[str, str], str] = {}
    if dedupe:
        existing = (
            await ctx.db.execute(
                select(
                    models.GradingAssessment.source_kind,
                    models.GradingAssessment.source_ref,
                    models.GradingAssessment.id,
                ).where(
                    models.GradingAssessment.user_id == ctx.user_id,
                    models.GradingAssessment.course_id == course.id,
                    models.GradingAssessment.source_ref.is_not(None),
                )
            )
        ).all()
        known = {(kind, ref): aid for kind, ref, aid in existing if kind and ref}
    position = await _next_position(ctx, course.id)
    created: list[models.GradingAssessment] = []
    skipped: list[SkippedAssessment] = []
    for item in items:
        if item.source_kind and item.source_ref and (item.source_kind, item.source_ref) in known:
            skipped.append(
                SkippedAssessment(
                    source_kind=item.source_kind,
                    source_ref=item.source_ref,
                    assessment_id=known[(item.source_kind, item.source_ref)],
                )
            )
            continue
        row = _new_assessment(ctx, course.id, program.timezone, item, position)
        position += 1
        ctx.db.add(row)
        created.append(row)
        if item.source_kind and item.source_ref:
            known[(item.source_kind, item.source_ref)] = row.id
    await ctx.db.flush()
    if created:
        # One event for the whole batch: an import of 30 assessments is one change to react to.
        dated = any(r.due_at is not None for r in created)
        await events.publish(
            ctx,
            "grading.assessment.created",
            {
                **({"assessment_id": created[0].id} if len(created) == 1 else {}),
                "assessment_ids": [r.id for r in created],
                "course_id": course.id,
                "program_id": program.id,
                "changed": ["due_at"] if dated else [],
                "due_changed": dated,
            },
        )
    return AssessmentCreateManyResult(
        created=[assessment_out(r, program.timezone, ctx.now) for r in created], skipped=skipped
    )


def _plain(value: Any) -> Any:
    return value.isoformat() if isinstance(value, date | time | datetime) else value


async def preview_assessment_update(ctx: Ctx, inp: AssessmentUpdateInput) -> dict[str, Any]:
    """The assistant's confirmation card (M12 §3.5): the assessment, its course, each sent field
    as before → after, and a link to the course's grades page."""
    row = await _get_assessment(ctx, inp.assessment_id)
    course, program = await _course_and_program(ctx, row.course_id)
    # Before-values as the user sees them: the deadline as a local date and time.
    current = assessment_out(row, program.timezone, ctx.now)
    changes: list[dict[str, Any]] = []
    for field in sorted(inp.model_fields_set - {"assessment_id"}):
        after = getattr(inp, field)
        before = getattr(current, field, None)
        if field == "category_id":
            # Categories by name, never their ids.
            changes.append(
                {
                    "field": "category",
                    "before": await _category_name(ctx, before),
                    "after": await _category_name(ctx, after),
                }
            )
            continue
        changes.append({"field": field, "before": _plain(before), "after": _plain(after)})
    label = f"{course.code} {course.title}" if course.code else course.title
    return {
        "target": f"{row.title} · {label}",
        "changes": changes,
        "link": {"to": f"/p/{program.id}/c/{course.id}/grades", "page": "grades"},
    }


async def _category_name(ctx: Ctx, category_id: str | None) -> str | None:
    if category_id is None:
        return None
    row = await ctx.db.get(models.GradingCategory, category_id)
    return row.name if row is not None and row.user_id == ctx.user_id else None


async def preview_assessment_delete(ctx: Ctx, inp: AssessmentRef) -> dict[str, Any]:
    """What goes with the assessment: its weight and the score recorded for it."""
    row = await _get_assessment(ctx, inp.assessment_id)
    course, _ = await _course_and_program(ctx, row.course_id)
    label = f"{course.code} {course.title}" if course.code else course.title
    changes: list[dict[str, Any]] = [{"field": "weight", "before": row.weight, "after": None}]
    for field in ("score_percentage", "points_earned"):
        if (value := getattr(row, field)) is not None:
            changes.append({"field": field, "before": value, "after": None})
    return {"target": f"{row.title} · {label}", "changes": changes}


async def preview_category_delete(ctx: Ctx, inp: CategoryRef) -> dict[str, Any]:
    """How many assessments lose their category (they stay, without one)."""
    row = await _get_category(ctx, inp.category_id)
    course, _ = await _course_and_program(ctx, row.course_id)
    label = f"{course.code} {course.title}" if course.code else course.title
    rows = (await _assessment_rows(ctx, [row.course_id]))[row.course_id]
    titles = [a.title for a in rows if a.category_id == row.id]
    changes: list[dict[str, Any]] = []
    if titles:
        changes.append({"field": "uncategorized", "after": titles[:10], "count": len(titles)})
    return {"target": f"{row.name} · {label}", "changes": changes}


async def update_assessment(ctx: Ctx, inp: AssessmentUpdateInput) -> Assessment:
    row = await _get_assessment(ctx, inp.assessment_id)
    course, program = await _course_and_program(ctx, row.course_id)
    tz = program.timezone
    sent = inp.model_fields_set - {"assessment_id"}
    _reject_nulls(inp, {"title", "weight", "dropped"})
    before = {
        k: getattr(row, k)
        for k in (
            "title",
            "category_id",
            "due_at",
            "due_has_time",
            "weight",
            "score_percentage",
            "points_earned",
            "points_possible",
            "dropped",
            "note",
        )
    }
    if "category_id" in sent:
        await _check_category(ctx, course.id, inp.category_id)
        row.category_id = inp.category_id
    if "title" in sent and inp.title is not None:
        row.title = inp.title.strip()
    if "weight" in sent and inp.weight is not None:
        row.weight = inp.weight
    if "dropped" in sent and inp.dropped is not None:
        row.dropped = inp.dropped
    if "note" in sent:
        row.note = inp.note

    if sent & {"due_at", "due_date", "due_time"}:
        row.due_at, row.due_has_time = _updated_due(row, inp, sent, tz)

    if sent & {"score_percentage", "points_earned", "points_possible"}:
        row.score_percentage, row.points_earned, row.points_possible = _updated_score(
            row, inp, sent
        )
    row.updated_at = ctx.now
    await ctx.db.flush()
    changed = [k for k, v in before.items() if getattr(row, k) != v]
    if changed:
        await _announce_assessment(ctx, "updated", row, program.id, changed)
    return assessment_out(row, tz, ctx.now)


def _updated_score(
    row: models.GradingAssessment, inp: AssessmentUpdateInput, sent: set[str]
) -> tuple[float | None, float | None, float | None]:
    """A score is a percentage or points, never both at once: a percentage sent together with
    points (or points possible alone, for a score that is a plain percentage) is refused rather
    than guessed at."""
    points_sent = sent & {"points_earned", "points_possible"}
    if "score_percentage" in sent and inp.score_percentage is not None and points_sent:
        raise AppError("grading.points_invalid", 422, reason="conflicting_score")
    if "score_percentage" in sent and inp.score_percentage is None:
        # null clears the score; points possible sent with it is kept for the next score.
        if "points_earned" in sent and inp.points_earned is not None:
            raise AppError("grading.points_invalid", 422, reason="conflicting_score")
        possible = inp.points_possible if "points_possible" in sent else row.points_possible
        return _score_fields(None, possible, None)
    if "score_percentage" in sent and not points_sent:
        # A percentage replaces any points score.
        return _score_fields(None, row.points_possible, inp.score_percentage)
    earned = inp.points_earned if "points_earned" in sent else row.points_earned
    possible = inp.points_possible if "points_possible" in sent else row.points_possible
    if "points_earned" in sent and earned is None:
        return _score_fields(None, possible, None)  # points_earned: null clears the score
    if earned is None and row.score_percentage is not None:
        raise AppError("grading.points_invalid", 422, reason="conflicting_score")
    return _score_fields(earned, possible, None)


def _updated_due(
    row: models.GradingAssessment, inp: AssessmentUpdateInput, sent: set[str], tz: str
) -> tuple[datetime | None, bool]:
    if "due_at" in sent and inp.due_at is not None:
        return _resolve_due(tz, inp.due_at, None, None)
    if "due_at" in sent and not sent & {"due_date", "due_time"}:
        return None, False  # due_at: null on its own clears the deadline
    local = _local(row.due_at, tz) if row.due_at is not None else None
    day = inp.due_date if "due_date" in sent else (local.date() if local else None)
    if "due_time" in sent:
        clock = inp.due_time
    else:
        clock = local.time() if local and row.due_has_time else None
    return _resolve_due(tz, None, day, clock)


async def delete_assessment(ctx: Ctx, assessment_id: str) -> None:
    row = await _get_assessment(ctx, assessment_id)
    course = await academics.get_course_row(ctx, row.course_id)
    data = {"assessment_id": row.id, "course_id": row.course_id, "program_id": course.program_id}
    await events.publish_in_transaction(ctx, "grading.assessment.deleting", data)
    await ctx.db.delete(row)
    await ctx.db.flush()
    await events.publish(
        ctx,
        "grading.assessment.deleted",
        {**data, "changed": [], "due_changed": row.due_at is not None},
    )


async def reorder_assessments(
    ctx: Ctx, course_id: str, assessment_ids: Sequence[str]
) -> AssessmentOrder:
    await academics.get_course_row(ctx, course_id)
    rows = (await _assessment_rows(ctx, [course_id]))[course_id]
    by_id = {r.id: r for r in rows}
    if any(i not in by_id for i in assessment_ids):
        raise not_found()
    ordered = [by_id[i] for i in dict.fromkeys(assessment_ids)]
    ordered += [r for r in rows if r.id not in {o.id for o in ordered}]
    for position, row in enumerate(ordered):
        row.position = position
    await ctx.db.flush()
    await _announce_course(ctx, course_id)
    return AssessmentOrder(course_id=course_id, assessment_ids=[r.id for r in ordered])


async def list_assessments(ctx: Ctx, inp: AssessmentListInput) -> AssessmentPage:
    _, program = await _course_and_program(ctx, inp.course_id)
    rows = (await _assessment_rows(ctx, [inp.course_id]))[inp.course_id]
    outs = [assessment_out(r, program.timezone, ctx.now) for r in rows]
    if inp.status is not None:
        outs = [a for a in outs if a.status == inp.status]
    offset = int(inp.cursor) if inp.cursor and inp.cursor.isdigit() else 0
    page = outs[offset : offset + inp.limit]
    more = offset + inp.limit < len(outs)
    return AssessmentPage(items=page, next_cursor=str(offset + inp.limit) if more else None)


def _normalize(text: str | None) -> str:
    return "".join((text or "").casefold().split())


def title_score(query: str, title: str) -> float:
    """How well `query` names an assessment title, 0 to 1 (case and spaces ignored)."""
    q, t = _normalize(query), _normalize(title)
    if not q or not t:
        return 0.0
    if q == t:
        return 1.0
    if t.startswith(q):
        return 0.9
    if q in t:
        return 0.8
    words = query.casefold().split()
    title_words = title.casefold().split()
    if words and all(any(tw.startswith(w) for tw in title_words) for w in words):
        return 0.85
    return round(0.6 * SequenceMatcher(None, q, t).ratio(), 3)


async def find_assessments(ctx: Ctx, inp: AssessmentFindInput) -> AssessmentCandidates:
    scope = ctx.scope
    names: dict[str, tuple[str | None, str]] = {}  # course id → (code, title)
    current: set[str] = set()  # courses of each searched Program's current term
    if inp.course_id is not None:
        row = await academics.get_course_row(ctx, inp.course_id)
        course = await academics.course_out(ctx, row)
        names[course.id] = (course.code, course.title)
        program = await academics.get_program_row(ctx, course.program_id)
        if await _current_term_id(ctx, program) in course.term_ids:
            current.add(course.id)
    else:
        program_id = inp.program_id or (scope.program_id if scope else None)
        program_ids = (
            [program_id]
            if program_id is not None
            else [p.id for p in await academics.list_programs(ctx)]
        )
        for pid in program_ids:
            program = await academics.get_program_row(ctx, pid)
            program_courses = await _program_courses(ctx, program.id)
            names |= {c.id: (c.code, c.title) for c in program_courses}
            term_id = await _current_term_id(ctx, program)
            current |= {c.id for c in program_courses if term_id in c.term_ids}
    rows_by_course = await _assessment_rows(ctx, list(names))
    focus = scope.course_id if scope else None  # conversations from before scopes stopped at terms
    scored: list[tuple[float, models.GradingAssessment]] = []
    for course_id, rows in rows_by_course.items():
        for row in rows:
            score = title_score(inp.query, row.title)
            if score >= 0.35:
                boost = (0.1 if course_id == focus else 0.0) + (
                    0.05 if course_id in current else 0.0
                )
                scored.append((score + boost, row))
    # Ties: the current term first, then the deadline nearest to now, past or future: a deadline
    # that just passed beats one months away, which suits "the midterm" asked about either side
    # of it; the score boosts above already keep an old term's same-named assessment below.
    scored.sort(
        key=lambda pair: (
            -pair[0],
            pair[1].course_id not in current,
            abs((pair[1].due_at - ctx.now).total_seconds()) if pair[1].due_at else float("inf"),
            pair[1].title,
        )
    )
    top = scored[: inp.limit]
    category_ids = {r.category_id for _, r in top if r.category_id}
    categories = (
        dict(
            (
                await ctx.db.execute(
                    select(models.GradingCategory.id, models.GradingCategory.name).where(
                        models.GradingCategory.user_id == ctx.user_id,
                        models.GradingCategory.id.in_(category_ids),
                    )
                )
            ).tuples()
        )
        if category_ids
        else {}
    )
    return AssessmentCandidates(
        items=[
            AssessmentCandidate(
                id=r.id,
                course_id=r.course_id,
                course_code=names[r.course_id][0],
                course_title=names[r.course_id][1],
                in_current_term=r.course_id in current,
                title=r.title,
                category_id=r.category_id,
                category_name=categories.get(r.category_id) if r.category_id else None,
                due_at=r.due_at,
                weight=r.weight,
                score_percentage=r.score_percentage,
                score=round(min(1.0, s), 3),
            )
            for s, r in top
        ]
    )


async def _current_term_id(ctx: Ctx, program: AcademicsProgram) -> str | None:
    """The term the conversation is in when it belongs to this Program, else the current one."""
    scope = ctx.scope
    if scope and scope.program_id == program.id and scope.term_id:
        return scope.term_id
    term = academic_rules.current_term(
        await academics.program_terms(ctx, program.id), academics.program_today(ctx, program)
    )
    return term.id if term else None


async def assessment_deadlines(
    ctx: Ctx,
    program_id: str,
    start: datetime,
    end: datetime,
    course_ids: Sequence[str] | None = None,
) -> list[Assessment]:
    """Unscored, undropped assessments due in [start, end): the calendar source M04 registers."""
    program = await academics.get_program_row(ctx, program_id)
    allowed = {c.id for c in await _program_courses(ctx, program_id)}
    wanted = [c for c in (course_ids or allowed) if c in allowed]
    if not wanted:
        return []
    rows = (
        await ctx.db.scalars(
            select(models.GradingAssessment)
            .where(
                models.GradingAssessment.user_id == ctx.user_id,
                models.GradingAssessment.course_id.in_(wanted),
                models.GradingAssessment.dropped.is_(False),
                models.GradingAssessment.score_percentage.is_(None),
                models.GradingAssessment.due_at >= start,
                models.GradingAssessment.due_at < end,
            )
            .order_by(models.GradingAssessment.due_at)
        )
    ).all()
    return [assessment_out(r, program.timezone, ctx.now) for r in rows]


async def upcoming_assessments(ctx: Ctx, inp: UpcomingInput) -> UpcomingAssessments:
    """Ungraded, undropped assessments with a deadline, soonest first (overdue ones first of
    all), for a Program, one of its terms or one course: the "upcoming" card in one request."""
    program = await academics.get_program_row(ctx, inp.program_id)
    allowed = {c.id for c in await _program_courses(ctx, program.id, inp.term_id)}
    wanted = [inp.course_id] if inp.course_id is not None else sorted(allowed)
    wanted = [c for c in wanted if c in allowed]
    if not wanted:
        return UpcomingAssessments(items=[])
    rows = (
        await ctx.db.scalars(
            select(models.GradingAssessment)
            .where(
                models.GradingAssessment.user_id == ctx.user_id,
                models.GradingAssessment.course_id.in_(wanted),
                models.GradingAssessment.dropped.is_(False),
                models.GradingAssessment.score_percentage.is_(None),
                models.GradingAssessment.due_at.is_not(None),
            )
            .order_by(models.GradingAssessment.due_at, models.GradingAssessment.title)
            .limit(inp.limit)
        )
    ).all()
    return UpcomingAssessments(items=[assessment_out(r, program.timezone, ctx.now) for r in rows])


@dataclass(frozen=True)
class AssessmentSnapshot:
    """What other modules may read of an assessment's score and weight (M09's update review)."""

    id: str
    weight: float
    score_percentage: float | None
    points_earned: float | None
    points_possible: float | None


async def assessment_snapshots(
    ctx: Ctx, assessment_ids: Sequence[str]
) -> dict[str, AssessmentSnapshot]:
    """The user's assessments among the ids, by id; unknown ids are left out."""
    if not assessment_ids:
        return {}
    rows = await ctx.db.execute(
        select(
            models.GradingAssessment.id,
            models.GradingAssessment.weight,
            models.GradingAssessment.score_percentage,
            models.GradingAssessment.points_earned,
            models.GradingAssessment.points_possible,
        ).where(
            models.GradingAssessment.user_id == ctx.user_id,
            models.GradingAssessment.id.in_(list(assessment_ids)),
        )
    )
    return {r.id: AssessmentSnapshot(*r) for r in rows}
