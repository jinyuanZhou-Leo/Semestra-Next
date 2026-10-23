"""M13 export/import adapter: Programs, terms and courses.

Backups made before per-term course order was dropped still carry `term_course_order`; the
adapter only reads the tables it lists, so that key is ignored."""

from typing import Any

from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.modules.academics.models import (
    AcademicsCourse,
    AcademicsCourseTerm,
    AcademicsProgram,
    AcademicsTerm,
)
from semestra.modules.portability import ImportOptions, Table, table_adapter

IMPORTED_SUFFIX = {"zh-CN": "（导入）", "en": " (imported)"}  # noqa: RUF001


async def _program(ctx: Ctx, row: dict[str, Any], options: ImportOptions) -> dict[str, Any] | None:
    """Only the selected Programs; a merged one whose name is taken gets a suffix (M13 §4)."""
    if options.program_ids is not None and row.get("id") not in options.program_ids:
        return None
    if options.mode == "merge":
        taken = await ctx.db.scalar(
            select(AcademicsProgram.id).where(
                AcademicsProgram.user_id == ctx.user_id, AcademicsProgram.name == row.get("name")
            )
        )
        if taken is not None:
            suffix = IMPORTED_SUFFIX.get(ctx.locale, IMPORTED_SUFFIX["en"])
            row["name"] = f"{row.get('name') or ''}{suffix}"
    return row


ADAPTER = table_adapter(
    module="academics",
    schema_version=1,
    tables=(
        Table(AcademicsProgram, "programs", transform=_program),
        Table(AcademicsTerm, "terms", refs={"program_id": "required"}),
        Table(AcademicsCourse, "courses", refs={"program_id": "required"}),
        Table(
            AcademicsCourseTerm,
            "course_terms",
            id_column=None,
            refs={"course_id": "required", "term_id": "required"},
        ),
    ),
)
