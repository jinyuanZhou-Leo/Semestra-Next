"""Helpers the grading services share (M03)."""

from typing import Any

from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules.academics import service as academics
from semestra.modules.academics.schemas import Course, CourseListInput


async def _insert_ignore(ctx: Ctx, model: type[Any], values: dict[str, Any]) -> bool:
    """INSERT ... ON CONFLICT DO NOTHING. True when this call created the row.

    The event subscribers and the first request after a course appears can both try to create
    its rows; whoever comes second must not fail.
    """
    result = await ctx.db.execute(sqlite_insert(model).values(**values).on_conflict_do_nothing())
    return bool(result.rowcount)  # pyright: ignore[reportAttributeAccessIssue]


def _reject_nulls(inp: Any, fields: set[str]) -> None:
    """Partial updates: these fields may be left out, but not sent as null."""
    bad = sorted(f for f in inp.model_fields_set & fields if getattr(inp, f) is None)
    if bad:
        raise AppError(
            "common.validation", 422, errors=[{"loc": [f], "code": "none_not_allowed"} for f in bad]
        )


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
