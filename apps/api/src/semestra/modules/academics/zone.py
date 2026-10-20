"""The time zone agent/MCP output is shown in (`core.agent_output`): the Program of the call."""

from datetime import tzinfo
from zoneinfo import ZoneInfo

from pydantic import BaseModel
from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.modules.academics.models import AcademicsCourse, AcademicsProgram, AcademicsTerm


async def output_zone(ctx: Ctx, inp: BaseModel) -> tzinfo | None:
    """The call's `program_id`, else the conversation's Program, else the Program of the call's
    `course_id` / `term_id`, else the user's only Program. None (UTC) when none of these says."""
    if ctx.user is None:
        return None
    owned = AcademicsProgram.user_id == ctx.user.id
    query = select(AcademicsProgram.timezone).where(owned)
    program_id = getattr(inp, "program_id", None) or (ctx.scope and ctx.scope.program_id)
    if isinstance(program_id, str):
        query = query.where(AcademicsProgram.id == program_id)
    elif isinstance(course_id := getattr(inp, "course_id", None), str):
        query = query.join(AcademicsCourse).where(AcademicsCourse.id == course_id)
    elif isinstance(term_id := getattr(inp, "term_id", None), str):
        query = query.join(AcademicsTerm).where(AcademicsTerm.id == term_id)
    zones = (await ctx.db.scalars(query.limit(2))).all()
    return ZoneInfo(zones[0]) if len(zones) == 1 else None
