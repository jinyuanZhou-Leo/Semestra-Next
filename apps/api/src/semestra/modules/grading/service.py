"""Gradebook, grading scale and summaries (M03). Capabilities stay thin and call into here.

All arithmetic lives in `engine.py`; this module loads rows (through the academics service for
anything that module owns), calls the engine and shapes the results.
"""

from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime, time
from difflib import SequenceMatcher
from typing import Any, Literal
from zoneinfo import ZoneInfo

from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from semestra.core.context import Ctx
from semestra.core.db import new_id
from semestra.core.errors import AppError, not_found
from semestra.core.events import events
from semestra.modules.academics import rules as academic_rules
from semestra.modules.academics import service as academics
from semestra.modules.academics.models import AcademicsCourse, AcademicsProgram
from semestra.modules.academics.schemas import Course, CourseListInput, Term
from semestra.modules.grading import engine, models, presets
from semestra.modules.grading.schemas import (
    PERCENT_MAX,
    Assessment,
    AssessmentCandidate,
    AssessmentCandidates,
    AssessmentCategory,
    AssessmentCreateManyResult,
    AssessmentFields,
    AssessmentFindInput,
    AssessmentListInput,
    AssessmentOrder,
    AssessmentPage,
    AssessmentRef,
    AssessmentUpdateInput,
    CategoryCreateInput,
    CategoryRef,
    CategoryUpdateInput,
    CourseGrade,
    CourseGrades,
    CourseResult,
    CourseResultUpdateInput,
    Gradebook,
    GradebookSummary,
    GradeTarget,
    GradingScale,
    GradingScaleInfo,
    IgnoredCourseScore,
    IgnoredScore,
    ProgramGrades,
    ScalePreset,
    ScaleUpdateInput,
    ScoreSuggestion,
    SimulateCourseInput,
    SimulatedGradebook,
    SkippedAssessment,
    SuggestedScore,
    SuggestInput,
    TermGradePoint,
    TermGrades,
    TermGradeSimulation,
    TermSimulateInput,
)

_PASS_FAIL: dict[str, Literal["pass", "fail"]] = {"pass": "pass", "fail": "fail"}

# --- inserting without racing ---------------------------------------------------------------


async def _insert_ignore(ctx: Ctx, model: type[Any], values: dict[str, Any]) -> bool:
    """INSERT ... ON CONFLICT DO NOTHING. True when this call created the row.

    The event subscribers and the first request after a course appears can both try to create
    its rows; whoever comes second must not fail.
    """
    result = await ctx.db.execute(sqlite_insert(model).values(**values).on_conflict_do_nothing())
    return bool(result.rowcount)  # pyright: ignore[reportAttributeAccessIssue]


# --- grading scale --------------------------------------------------------------------------


def _bands(rows: Sequence[Mapping[str, Any]]) -> list[engine.Band]:
    return [
        engine.Band(float(b["min"]), float(b["max"]), float(b["points"]), b.get("letter"))
        for b in rows
    ]


def scale_of(row: models.GradingScale) -> engine.Scale:
    return engine.make_scale(_bands(row.bands), row.max_points)


def scale_out(row: models.GradingScale) -> GradingScale:
    ordered = sorted(row.bands, key=lambda b: -b["min"])
    return GradingScale.model_validate(
        {
            "program_id": row.program_id,
            "bands": ordered,
            "max_points": row.max_points,
            "year_course_attribution": row.year_course_attribution,
            "default_forecast_model": row.default_forecast_model,
            "default_categories": row.default_categories,
            "hide_gpa": row.hide_gpa,
            "updated_at": row.updated_at,
        }
    )


def list_presets() -> list[ScalePreset]:
    return [
        ScalePreset.model_validate(
            {
                "id": preset_id,
                "max_points": 4.0,
                "bands": sorted(presets.preset_bands(preset_id), key=lambda b: -b["min"]),
            }
        )
        for preset_id in presets.PRESET_IDS
    ]


async def create_scale(ctx: Ctx, program_id: str, preset: str | None = None) -> models.GradingScale:
    """The Program's scale from a preset (the default one when unknown); a no-op if it exists."""
    preset_id = preset if preset in presets.PRESET_IDS else presets.DEFAULT_PRESET
    await _insert_ignore(
        ctx,
        models.GradingScale,
        {
            "id": new_id(),
            "user_id": ctx.user_id,
            "program_id": program_id,
            "bands": presets.preset_bands(preset_id),
            "max_points": 4.0,
            "year_course_attribution": "end_term",
            "default_forecast_model": "auto",
            "default_categories": presets.BUILTIN_CATEGORIES,
            "hide_gpa": False,
            "created_at": ctx.now,
            "updated_at": ctx.now,
        },
    )
    row = await ctx.db.scalar(
        select(models.GradingScale).where(
            models.GradingScale.user_id == ctx.user_id,
            models.GradingScale.program_id == program_id,
        )
    )
    assert row is not None
    return row


async def get_scale_row(ctx: Ctx, program_id: str) -> models.GradingScale:
    """The Program's scale, created with the default preset if it is missing."""
    await academics.get_program_row(ctx, program_id)  # not_found for other people's Programs
    row = await ctx.db.scalar(
        select(models.GradingScale).where(
            models.GradingScale.user_id == ctx.user_id,
            models.GradingScale.program_id == program_id,
        )
    )
    return row or await create_scale(ctx, program_id)


def _scale_error(exc: engine.ScaleError) -> AppError:
    return AppError("grading.scale_invalid", 422, reason=exc.reason)


def _validate_templates(templates: Sequence[Mapping[str, Any]]) -> None:
    keys = [t["key"] for t in templates]
    if len(set(keys)) != len(keys):
        raise AppError("grading.scale_invalid", 422, reason="category_key_duplicate")


async def update_scale(ctx: Ctx, inp: ScaleUpdateInput) -> GradingScale:
    row = await get_scale_row(ctx, inp.program_id)
    sent = inp.model_fields_set
    bad = sorted(f for f in sent - {"program_id"} if getattr(inp, f) is None)
    if bad:
        raise AppError(
            "common.validation", 422, errors=[{"loc": [f], "code": "none_not_allowed"} for f in bad]
        )
    bands = (
        [b.model_dump(mode="json") for b in inp.bands] if inp.bands is not None else list(row.bands)
    )
    max_points = inp.max_points if inp.max_points is not None else row.max_points
    try:
        engine.validate_bands(_bands(bands), max_points)
    except engine.ScaleError as exc:
        raise _scale_error(exc) from exc
    if inp.default_categories is not None:
        _validate_templates([t.model_dump() for t in inp.default_categories])
        row.default_categories = [t.model_dump(mode="json") for t in inp.default_categories]
    row.bands = sorted(bands, key=lambda b: -b["min"])
    if max_points < row.max_points:
        # A target above the new maximum could no longer be set; drop the ones that now exceed it.
        course_ids = [c.id for c in await _program_courses(ctx, row.program_id)]
        if course_ids:
            await ctx.db.execute(
                update(models.GradingCourseResult)
                .where(
                    models.GradingCourseResult.user_id == ctx.user_id,
                    models.GradingCourseResult.course_id.in_(course_ids),
                    models.GradingCourseResult.target_points > max_points,
                )
                .values(target_points=None, updated_at=ctx.now)
            )
    row.max_points = max_points
    if inp.year_course_attribution is not None:
        row.year_course_attribution = inp.year_course_attribution
    if inp.default_forecast_model is not None:
        row.default_forecast_model = inp.default_forecast_model
    if inp.hide_gpa is not None:
        row.hide_gpa = inp.hide_gpa
    row.updated_at = ctx.now
    await ctx.db.flush()
    await events.publish(ctx, "grading.scale.updated", {"program_id": row.program_id})
    return scale_out(row)


# --- courses: loading and first-use setup ---------------------------------------------------


async def _course_and_program(ctx: Ctx, course_id: str) -> tuple[AcademicsCourse, AcademicsProgram]:
    course = await academics.get_course_row(ctx, course_id)
    return course, await academics.get_program_row(ctx, course.program_id)


def _result_out(row: models.GradingCourseResult) -> CourseResult:
    return CourseResult.model_validate(
        {
            "course_id": row.course_id,
            "basis": row.basis,
            "manual_percentage": row.manual_percentage,
            "final_override_percentage": row.final_override_percentage,
            "pass_fail_result": row.pass_fail_result,
            "target_points": row.target_points,
            "forecast_model": row.forecast_model,
            "gradebook_enabled": row.gradebook_enabled,
            "updated_at": row.updated_at,
        }
    )


async def ensure_course_setup(
    ctx: Ctx, course_id: str, program_id: str
) -> models.GradingCourseResult:
    """The course's result row, created together with its default categories on first use."""
    row = await ctx.db.get(models.GradingCourseResult, course_id)
    if row is not None:
        if row.user_id != ctx.user_id:
            raise not_found()
        return row
    scale = await get_scale_row(ctx, program_id)
    created = await _insert_ignore(
        ctx,
        models.GradingCourseResult,
        {
            "course_id": course_id,
            "user_id": ctx.user_id,
            "basis": "percentage",
            "forecast_model": scale.default_forecast_model,
            "gradebook_enabled": True,
            "created_at": ctx.now,
            "updated_at": ctx.now,
        },
    )
    if created:
        for position, template in enumerate(scale.default_categories):
            ctx.db.add(
                models.GradingCategory(
                    id=new_id(),
                    user_id=ctx.user_id,
                    course_id=course_id,
                    key=template["key"],
                    name=template["name"],
                    color=template["color"],
                    position=position,
                    archived=False,
                )
            )
        await ctx.db.flush()
    row = await ctx.db.get(models.GradingCourseResult, course_id)
    assert row is not None
    return row


async def delete_course_data(ctx: Ctx, course_id: str) -> None:
    for model in (models.GradingAssessment, models.GradingCategory):
        await ctx.db.execute(
            delete(model).where(model.user_id == ctx.user_id, model.course_id == course_id)
        )
    await ctx.db.execute(
        delete(models.GradingCourseResult).where(
            models.GradingCourseResult.user_id == ctx.user_id,
            models.GradingCourseResult.course_id == course_id,
        )
    )


async def delete_program_data(ctx: Ctx, program_id: str) -> None:
    await ctx.db.execute(
        delete(models.GradingScale).where(
            models.GradingScale.user_id == ctx.user_id,
            models.GradingScale.program_id == program_id,
        )
    )


# --- categories -----------------------------------------------------------------------------


def category_out(row: models.GradingCategory) -> AssessmentCategory:
    return AssessmentCategory.model_validate(
        {c.key: getattr(row, c.key) for c in row.__table__.columns}
    )


async def _category_rows(ctx: Ctx, course_id: str) -> list[models.GradingCategory]:
    return list(
        (
            await ctx.db.scalars(
                select(models.GradingCategory)
                .where(
                    models.GradingCategory.user_id == ctx.user_id,
                    models.GradingCategory.course_id == course_id,
                )
                .order_by(models.GradingCategory.position, models.GradingCategory.name)
            )
        ).all()
    )


async def _get_category(ctx: Ctx, category_id: str) -> models.GradingCategory:
    row = await ctx.db.get(models.GradingCategory, category_id)
    if row is None or row.user_id != ctx.user_id:
        raise not_found("category", category_id)
    return row


def _slug(name: str) -> str:
    slug = "".join(ch if ch.isascii() and ch.isalnum() else "-" for ch in name.casefold())
    slug = "-".join(part for part in slug.split("-") if part)[:28]
    return slug or "category"


async def create_category(ctx: Ctx, inp: CategoryCreateInput) -> AssessmentCategory:
    course, program = await _course_and_program(ctx, inp.course_id)
    await ensure_course_setup(ctx, course.id, program.id)
    rows = await _category_rows(ctx, course.id)
    taken = {r.key for r in rows}
    if inp.key is not None:
        if inp.key in taken:
            raise AppError("grading.category_key_conflict", 409, key=inp.key)
        key = inp.key
    else:
        base = _slug(inp.name)
        key, n = base, 2
        while key in taken:
            key, n = f"{base}-{n}", n + 1
    row = models.GradingCategory(
        id=new_id(),
        user_id=ctx.user_id,
        course_id=course.id,
        key=key,
        name=inp.name.strip(),
        color=inp.color,
        position=(max((r.position for r in rows), default=-1)) + 1,
        archived=False,
    )
    ctx.db.add(row)
    await ctx.db.flush()
    await events.publish(
        ctx, "grading.course_result.updated", {"course_id": course.id, "program_id": program.id}
    )
    return category_out(row)


async def update_category(ctx: Ctx, inp: CategoryUpdateInput) -> AssessmentCategory:
    row = await _get_category(ctx, inp.category_id)
    bad = sorted(f for f in inp.model_fields_set - {"category_id"} if getattr(inp, f) is None)
    if bad:
        raise AppError(
            "common.validation", 422, errors=[{"loc": [f], "code": "none_not_allowed"} for f in bad]
        )
    if inp.name is not None:
        row.name = inp.name.strip()
    if inp.color is not None:
        row.color = inp.color
    if inp.archived is not None:
        row.archived = inp.archived
    await ctx.db.flush()
    await _announce_course(ctx, row.course_id)
    return category_out(row)


async def delete_category(ctx: Ctx, category_id: str) -> None:
    row = await _get_category(ctx, category_id)
    course_id = row.course_id
    # Its assessments stay, uncategorised (also enforced by the foreign key's SET NULL).
    await ctx.db.execute(
        update(models.GradingAssessment)
        .where(models.GradingAssessment.category_id == row.id)
        .values(category_id=None)
    )
    await ctx.db.delete(row)
    await ctx.db.flush()
    await _announce_course(ctx, course_id)


async def reorder_categories(
    ctx: Ctx, course_id: str, category_ids: Sequence[str]
) -> list[AssessmentCategory]:
    course, program = await _course_and_program(ctx, course_id)
    await ensure_course_setup(ctx, course.id, program.id)
    rows = await _category_rows(ctx, course.id)
    by_id = {r.id: r for r in rows}
    if any(i not in by_id for i in category_ids):
        raise not_found()
    ordered = [by_id[i] for i in dict.fromkeys(category_ids)]
    ordered += [r for r in rows if r.id not in {o.id for o in ordered}]
    for position, row in enumerate(ordered):
        row.position = position
    await ctx.db.flush()
    await _announce_course(ctx, course.id)
    return [category_out(r) for r in ordered]


async def _announce_course(ctx: Ctx, course_id: str) -> None:
    course = await academics.get_course_row(ctx, course_id)
    await events.publish(
        ctx,
        "grading.course_result.updated",
        {"course_id": course_id, "program_id": course.program_id},
    )


# --- assessments ----------------------------------------------------------------------------


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
    for row in created:
        await _announce_assessment(
            ctx, "created", row, program.id, ["due_at"] if row.due_at else []
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
        changes.append({"field": field, "before": _plain(before), "after": _plain(after)})
    label = f"{course.code} {course.title}" if course.code else course.title
    return {
        "target": f"{row.title} · {label}",
        "changes": changes,
        "link": {"to": f"/p/{program.id}/c/{course.id}/grades", "page": "grades"},
    }


async def preview_assessment_delete(ctx: Ctx, inp: AssessmentRef) -> dict[str, Any]:
    row = await _get_assessment(ctx, inp.assessment_id)
    course, _ = await _course_and_program(ctx, row.course_id)
    label = f"{course.code} {course.title}" if course.code else course.title
    return {"target": f"{row.title} · {label}", "changes": []}


async def preview_category_delete(ctx: Ctx, inp: CategoryRef) -> dict[str, Any]:
    row = await _get_category(ctx, inp.category_id)
    course, _ = await _course_and_program(ctx, row.course_id)
    label = f"{course.code} {course.title}" if course.code else course.title
    return {"target": f"{row.name} · {label}", "changes": []}


async def update_assessment(ctx: Ctx, inp: AssessmentUpdateInput) -> Assessment:
    row = await _get_assessment(ctx, inp.assessment_id)
    course, program = await _course_and_program(ctx, row.course_id)
    tz = program.timezone
    sent = inp.model_fields_set - {"assessment_id"}
    required = {"title", "weight", "dropped"}
    bad = sorted(f for f in sent & required if getattr(inp, f) is None)
    if bad:
        raise AppError(
            "common.validation", 422, errors=[{"loc": [f], "code": "none_not_allowed"} for f in bad]
        )
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
        score_only = "score_percentage" in sent and not sent & {"points_earned", "points_possible"}
        earned = inp.points_earned if "points_earned" in sent else row.points_earned
        possible = inp.points_possible if "points_possible" in sent else row.points_possible
        percentage = inp.score_percentage if "score_percentage" in sent else row.score_percentage
        if score_only:
            earned = None
        elif "points_earned" in sent and earned is None and "score_percentage" not in sent:
            percentage = None  # points_earned: null clears the score
        row.score_percentage, row.points_earned, row.points_possible = _score_fields(
            earned, possible, percentage
        )
    row.updated_at = ctx.now
    await ctx.db.flush()
    changed = [k for k, v in before.items() if getattr(row, k) != v]
    if changed:
        await _announce_assessment(ctx, "updated", row, program.id, changed)
    return assessment_out(row, tz, ctx.now)


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


# --- one course: result, gradebook, what-if -------------------------------------------------


async def _program_courses(ctx: Ctx, program_id: str, term_id: str | None = None) -> list[Course]:
    """Every course of the Program, or of one term, through the academics service (500 a page)."""
    courses: list[Course] = []
    cursor: str | None = None
    while True:
        page = await academics.list_courses(
            ctx, CourseListInput(program_id=program_id, term_id=term_id, cursor=cursor, limit=500)
        )
        courses.extend(page.items)
        if page.next_cursor is None:
            return courses
        cursor = page.next_cursor


def _items(rows: Sequence[models.GradingAssessment]) -> tuple[engine.Item, ...]:
    return tuple(
        engine.Item(r.id, r.category_id, r.weight, r.score_percentage, r.dropped) for r in rows
    )


def _forecast_model(value: str) -> engine.ForecastModel:
    return "simple_minimum_needed" if value == "simple_minimum_needed" else "auto"


def _resolve_target(
    scale: engine.Scale, default_points: float, target: GradeTarget | None
) -> tuple[float, float | None]:
    """(target grade points, lowest percentage reaching them) for a requested target."""
    if target is None:
        return default_points, engine.min_percentage_for(scale, default_points)
    if target.kind == "percentage":
        return engine.points_for(scale, target.value), target.value
    return target.value, engine.min_percentage_for(scale, target.value)


def _course_input(
    course: Course, result: models.GradingCourseResult | None, items: tuple[engine.Item, ...]
) -> engine.CourseInput:
    return engine.CourseInput(
        course_id=course.id,
        credits=course.credits,
        include_in_gpa=course.include_in_gpa,
        term_ids=tuple(course.term_ids),
        basis="pass_fail" if result and result.basis == "pass_fail" else "percentage",
        gradebook_enabled=result.gradebook_enabled if result else True,
        manual_percentage=result.manual_percentage if result else None,
        final_override=result.final_override_percentage if result else None,
        pass_fail_result=_PASS_FAIL.get(result.pass_fail_result or "") if result else None,
        items=items,
    )


def _reachable(
    calc: engine.CourseCalc,
    use_gradebook: bool,
    target_percentage: float | None,
    override: float | None,
) -> bool | None:
    """Whether the target can still be met; False when the scale has no band that high."""
    if not use_gradebook or override is not None:
        return None
    if target_percentage is None and calc.weights_ok:
        return False
    return calc.reachable


def build_summary(
    course: engine.CourseInput,
    scale: engine.Scale,
    forecast_model: engine.ForecastModel,
    target_points: float,
    target_percentage: float | None,
) -> tuple[GradebookSummary, engine.CourseCalc]:
    calc = engine.compute_course(
        course.items,
        target_percentage=target_percentage if course.basis == "percentage" else None,
        forecast_model=forecast_model,
        override=course.final_override,
    )
    grade = engine.course_grade(course, scale, calc=calc)
    use_gradebook = course.basis == "percentage" and course.gradebook_enabled
    final = grade.percentage if grade.status == "completed" else None
    if final is None or course.basis != "percentage":
        final_points = final_letter = None
    else:
        final_points, final_letter = grade.points, grade.letter
    source: Any = None
    if final is not None:
        source = calc.final_source if use_gradebook else "manual"

    def points(p: float | None) -> float | None:
        return None if p is None else engine.points_for(scale, p)

    def letter(p: float | None) -> str | None:
        return None if p is None else engine.letter_for(scale, p)

    current = calc.current_percentage if use_gradebook else None
    forecast = calc.forecast_percentage if use_gradebook else None
    summary = GradebookSummary.model_validate(
        {
            "status": grade.status,
            "weight_total": calc.weight_total,
            "weight_gap": calc.weight_gap,
            "weights_ok": calc.weights_ok,
            "graded_count": calc.graded_count,
            "remaining_count": calc.remaining_count,
            "graded_weight": calc.graded_weight,
            "remaining_weight": calc.remaining_weight,
            "locked_contribution": calc.locked_contribution if use_gradebook else None,
            "current_percentage": current,
            "current_points": points(current),
            "current_letter": letter(current),
            "final_percentage": final,
            "final_points": final_points,
            "final_letter": final_letter,
            "final_source": source,
            "overridden": use_gradebook and course.final_override is not None,
            "forecast_percentage": forecast,
            "forecast_points": points(forecast),
            "forecast_letter": letter(forecast),
            "predictions": calc.predictions if use_gradebook else {},
            "missing_history_category_ids": list(calc.missing_history) if use_gradebook else [],
            "target_points": target_points,
            "target_percentage": target_percentage,
            "required_average": calc.required_average if use_gradebook else None,
            "reachable": _reachable(calc, use_gradebook, target_percentage, course.final_override),
        }
    )
    return summary, calc


@dataclass
class _CourseState:
    course: Course
    program: AcademicsProgram
    result: models.GradingCourseResult
    scale_row: models.GradingScale
    scale: engine.Scale
    categories: list[models.GradingCategory]
    rows: list[models.GradingAssessment]


async def _load_course(ctx: Ctx, course_id: str) -> _CourseState:
    row, program = await _course_and_program(ctx, course_id)
    result = await ensure_course_setup(ctx, row.id, program.id)
    scale_row = await get_scale_row(ctx, program.id)
    return _CourseState(
        course=await academics.course_out(ctx, row),
        program=program,
        result=result,
        scale_row=scale_row,
        scale=scale_of(scale_row),
        categories=await _category_rows(ctx, row.id),
        rows=(await _assessment_rows(ctx, [row.id]))[row.id],
    )


def _summary_for(
    state: _CourseState, items: tuple[engine.Item, ...], target: GradeTarget | None = None
) -> tuple[GradebookSummary, engine.CourseCalc]:
    default = state.result.target_points
    default = state.scale_row.max_points if default is None else default
    target_points, target_percentage = _resolve_target(state.scale, default, target)
    course = _course_input(state.course, state.result, items)
    return build_summary(
        course,
        state.scale,
        _forecast_model(state.result.forecast_model),
        target_points,
        target_percentage,
    )


async def get_gradebook(ctx: Ctx, course_id: str) -> Gradebook:
    state = await _load_course(ctx, course_id)
    summary, _ = _summary_for(state, _items(state.rows))
    tz = state.program.timezone
    return Gradebook(
        course_id=state.course.id,
        program_id=state.program.id,
        scale=GradingScaleInfo(
            max_points=state.scale_row.max_points, hide_gpa=state.scale_row.hide_gpa
        ),
        result=_result_out(state.result),
        categories=[category_out(c) for c in state.categories],
        assessments=[assessment_out(r, tz, ctx.now) for r in state.rows],
        summary=summary,
    )


async def update_result(ctx: Ctx, inp: CourseResultUpdateInput) -> CourseResult:
    course, program = await _course_and_program(ctx, inp.course_id)
    row = await ensure_course_setup(ctx, course.id, program.id)
    sent = inp.model_fields_set - {"course_id"}
    required = {"basis", "forecast_model", "gradebook_enabled"}
    bad = sorted(f for f in sent & required if getattr(inp, f) is None)
    if bad:
        raise AppError(
            "common.validation", 422, errors=[{"loc": [f], "code": "none_not_allowed"} for f in bad]
        )
    if inp.target_points is not None:
        scale = await get_scale_row(ctx, program.id)
        if inp.target_points > scale.max_points:
            raise AppError("grading.points_invalid", 422, reason="above_scale_maximum")
    for field in sorted(sent):
        setattr(row, field, getattr(inp, field))
    row.updated_at = ctx.now
    await ctx.db.flush()
    await events.publish(
        ctx, "grading.course_result.updated", {"course_id": course.id, "program_id": program.id}
    )
    return _result_out(row)


def _require_complete_weights(calc: engine.CourseCalc) -> None:
    if not calc.weights_ok:
        raise AppError(
            "grading.weights_not_100",
            422,
            weight_total=calc.weight_total,
            weight_gap=calc.weight_gap,
        )


async def simulate_course(ctx: Ctx, inp: SimulateCourseInput) -> SimulatedGradebook:
    state = await _load_course(ctx, inp.course_id)
    graded = {i.id for i in _items(state.rows) if i.score is not None}
    known = {r.id for r in state.rows}
    ignored = [
        IgnoredScore(id=aid, reason="graded" if aid in graded else "unknown")
        for aid in inp.scores
        if aid not in known or aid in graded
    ]
    items = tuple(
        engine.Item(
            i.id,
            i.category,
            i.weight,
            inp.scores[i.id] if i.score is None and i.id in inp.scores else i.score,
            i.dropped,
        )
        for i in _items(state.rows)
    )
    # What-if ignores the official grade: the question is what the marks would add up to.
    course = _course_input(state.course, state.result, items)
    course = replace(course, final_override=None)
    default = state.result.target_points
    default = state.scale_row.max_points if default is None else default
    target_points, target_percentage = _resolve_target(state.scale, default, inp.target)
    summary, calc = build_summary(
        course,
        state.scale,
        _forecast_model(state.result.forecast_model),
        target_points,
        target_percentage,
    )
    _require_complete_weights(calc)
    return SimulatedGradebook(**summary.model_dump(), ignored=ignored)


async def suggest_scores(ctx: Ctx, inp: SuggestInput) -> ScoreSuggestion:
    state = await _load_course(ctx, inp.course_id)
    items = _items(state.rows)
    calc = engine.compute_course(items)
    _require_complete_weights(calc)
    default = state.result.target_points
    default = state.scale_row.max_points if default is None else default
    _, target_percentage = _resolve_target(state.scale, default, inp.target)
    goal = 100.0 if target_percentage is None else target_percentage
    suggestion = engine.suggest_scores(items, goal)
    return ScoreSuggestion(
        items=[SuggestedScore(assessment_id=k, score=v) for k, v in suggestion.scores.items()],
        target_percentage=target_percentage,
        resulting_percentage=suggestion.resulting_percentage,
        reachable=suggestion.reachable and target_percentage is not None,
    )


# --- term, Program and course summaries -----------------------------------------------------


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
    courses = await _program_courses(ctx, program_id)
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
    assessments = await _assessment_rows(ctx, ids)
    return _ProgramState(
        program=program,
        scale_row=scale_row,
        scale=scale_of(scale_row),
        terms=await academics.list_terms(ctx, program_id),
        courses=courses,
        results=results,
        items={cid: _items(rows) for cid, rows in assessments.items()},
    )


def _grade_all(state: _ProgramState, include_in_progress: bool) -> list[engine.GradedCourse]:
    graded: list[engine.GradedCourse] = []
    for course in state.courses:
        inp = _course_input(course, state.results.get(course.id), state.items.get(course.id, ()))
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
    order = [c.id for c in await _program_courses(ctx, term.program_id, term_id)]
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
