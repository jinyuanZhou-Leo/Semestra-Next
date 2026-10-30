"""A course's grading categories (M03)."""

from collections.abc import Sequence

from sqlalchemy import select, update

from semestra.core.context import Ctx
from semestra.core.db import new_id
from semestra.core.errors import AppError, not_found
from semestra.core.events import events
from semestra.modules.academics import service as academics
from semestra.modules.grading import models
from semestra.modules.grading.schemas import (
    AssessmentCategory,
    CategoryCreateInput,
    CategoryUpdateInput,
)
from semestra.modules.grading.service.common import reject_nulls
from semestra.modules.grading.service.courses import course_and_program, ensure_course_setup


def category_out(row: models.GradingCategory) -> AssessmentCategory:
    return AssessmentCategory.model_validate(
        {c.key: getattr(row, c.key) for c in row.__table__.columns}
    )


async def category_rows(ctx: Ctx, course_id: str) -> list[models.GradingCategory]:
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


async def get_category(ctx: Ctx, category_id: str) -> models.GradingCategory:
    row = await ctx.db.get(models.GradingCategory, category_id)
    if row is None or row.user_id != ctx.user_id:
        raise not_found("category", category_id)
    return row


def _slug(name: str) -> str:
    slug = "".join(ch if ch.isascii() and ch.isalnum() else "-" for ch in name.casefold())
    slug = "-".join(part for part in slug.split("-") if part)[:28]
    return slug or "category"


async def create_category(ctx: Ctx, inp: CategoryCreateInput) -> AssessmentCategory:
    course, program = await course_and_program(ctx, inp.course_id)
    await ensure_course_setup(ctx, course.id, program.id)
    rows = await category_rows(ctx, course.id)
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
    await announce_course(ctx, course.id)
    return category_out(row)


async def update_category(ctx: Ctx, inp: CategoryUpdateInput) -> AssessmentCategory:
    row = await get_category(ctx, inp.category_id)
    reject_nulls(inp, inp.model_fields_set - {"category_id"})
    if inp.name is not None:
        row.name = inp.name.strip()
    if inp.color is not None:
        row.color = inp.color
    if inp.archived is not None:
        row.archived = inp.archived
    await ctx.db.flush()
    await announce_course(ctx, row.course_id)
    return category_out(row)


async def delete_category(ctx: Ctx, category_id: str) -> None:
    row = await get_category(ctx, category_id)
    course_id = row.course_id
    # Its assessments stay, uncategorised (also enforced by the foreign key's SET NULL).
    await ctx.db.execute(
        update(models.GradingAssessment)
        .where(models.GradingAssessment.category_id == row.id)
        .values(category_id=None)
    )
    await ctx.db.delete(row)
    await ctx.db.flush()
    await announce_course(ctx, course_id)


async def reorder_categories(
    ctx: Ctx, course_id: str, category_ids: Sequence[str]
) -> list[AssessmentCategory]:
    course, program = await course_and_program(ctx, course_id)
    await ensure_course_setup(ctx, course.id, program.id)
    rows = await category_rows(ctx, course.id)
    by_id = {r.id: r for r in rows}
    if any(i not in by_id for i in category_ids):
        raise not_found()
    ordered = [by_id[i] for i in dict.fromkeys(category_ids)]
    ordered += [r for r in rows if r.id not in {o.id for o in ordered}]
    for position, row in enumerate(ordered):
        row.position = position
    await ctx.db.flush()
    await announce_course(ctx, course.id)
    return [category_out(r) for r in ordered]


async def announce_course(ctx: Ctx, course_id: str) -> None:
    course = await academics.get_course_row(ctx, course_id)
    await events.publish(
        ctx,
        "grading.course_result.updated",
        {"course_id": course_id, "program_id": course.program_id},
    )
