"""The Program's grading scale (M03)."""

from collections.abc import Mapping, Sequence
from typing import Any

from sqlalchemy import select, update

from semestra.core.context import Ctx
from semestra.core.db import new_id
from semestra.core.errors import AppError
from semestra.core.events import events
from semestra.modules.academics import service as academics
from semestra.modules.grading import engine, models, presets
from semestra.modules.grading.schemas import (
    GradingScale,
    ScalePreset,
    ScaleUpdateInput,
)
from semestra.modules.grading.service.common import insert_ignore, program_courses, reject_nulls


def _bands(rows: Sequence[Mapping[str, Any]]) -> list[engine.Band]:
    return [
        engine.Band(float(b["min"]), float(b["max"]), float(b["points"]), b.get("letter"))
        for b in rows
    ]


def scale_of(row: models.GradingScale) -> engine.Scale:
    return engine.make_scale(
        _bands(row.bands), row.max_points, round_to_whole=row.round_before_lookup
    )


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
            "round_before_lookup": row.round_before_lookup,
            "updated_at": row.updated_at,
        }
    )


def list_presets() -> list[ScalePreset]:
    return [
        ScalePreset.model_validate(
            {
                "id": preset_id,
                "max_points": presets.preset_max_points(preset_id),
                "bands": sorted(presets.preset_bands(preset_id), key=lambda b: -b["min"]),
            }
        )
        for preset_id in presets.PRESET_IDS
    ]


async def create_scale(ctx: Ctx, program_id: str, preset: str | None = None) -> models.GradingScale:
    """The Program's scale from a preset (the default one when unknown); a no-op if it exists."""
    preset_id = preset if preset in presets.PRESET_IDS else presets.DEFAULT_PRESET
    await insert_ignore(
        ctx,
        models.GradingScale,
        {
            "id": new_id(),
            "user_id": ctx.user_id,
            "program_id": program_id,
            "bands": presets.preset_bands(preset_id),
            "max_points": presets.preset_max_points(preset_id),
            "year_course_attribution": "end_term",
            "default_forecast_model": "auto",
            "default_categories": presets.BUILTIN_CATEGORIES,
            "hide_gpa": False,
            "round_before_lookup": True,
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
    reject_nulls(inp, inp.model_fields_set - {"program_id"})
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
        course_ids = [c.id for c in await program_courses(ctx, row.program_id)]
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
    if inp.round_before_lookup is not None:
        row.round_before_lookup = inp.round_before_lookup
    row.updated_at = ctx.now
    await ctx.db.flush()
    await events.publish(ctx, "grading.scale.updated", {"program_id": row.program_id})
    return scale_out(row)
