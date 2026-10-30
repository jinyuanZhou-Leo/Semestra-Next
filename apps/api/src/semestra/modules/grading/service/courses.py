"""Loading a course's grading rows and setting them up on first use (M03)."""

from sqlalchemy import delete

from semestra.core.context import Ctx
from semestra.core.db import new_id
from semestra.core.errors import not_found
from semestra.modules.academics import service as academics
from semestra.modules.academics.models import AcademicsCourse, AcademicsProgram
from semestra.modules.grading import models
from semestra.modules.grading.schemas import (
    CourseResult,
)
from semestra.modules.grading.service.common import insert_ignore
from semestra.modules.grading.service.scales import get_scale_row


async def course_and_program(ctx: Ctx, course_id: str) -> tuple[AcademicsCourse, AcademicsProgram]:
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
    created = await insert_ignore(
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
