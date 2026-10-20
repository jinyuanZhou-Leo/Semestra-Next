"""The time zone agent/MCP output is shown in (`core.agent_output`): the Program of the call."""

from datetime import tzinfo
from zoneinfo import ZoneInfo

from pydantic import BaseModel
from sqlalchemy import Select, select

from semestra.core.context import Ctx
from semestra.modules.academics.models import AcademicsCourse, AcademicsProgram, AcademicsTerm


def _str(obj: BaseModel, name: str) -> str | None:
    value = getattr(obj, name, None)
    return value if isinstance(value, str) else None


def _program_query(ctx: Ctx, obj: BaseModel) -> Select[str] | None:
    """The Program `obj` names by `program_id`, `course_id` or `term_id`, if any."""
    query = select(AcademicsProgram.timezone).where(AcademicsProgram.user_id == ctx.user_id)
    if program_id := _str(obj, "program_id"):
        return query.where(AcademicsProgram.id == program_id)
    if course_id := _str(obj, "course_id"):
        return query.join(AcademicsCourse).where(AcademicsCourse.id == course_id)
    if term_id := _str(obj, "term_id"):
        return query.join(AcademicsTerm).where(AcademicsTerm.id == term_id)
    return None


async def output_zone(ctx: Ctx, inp: BaseModel, out: BaseModel) -> tzinfo | None:
    """The Program the call names (`program_id`, then `course_id` / `term_id`), else the
    conversation's Program, else the one the output names (a call by task or event id), else the
    user's only Program. None (UTC) when none of these says."""
    if ctx.user is None:
        return None
    owned = select(AcademicsProgram.timezone).where(AcademicsProgram.user_id == ctx.user.id)
    scope = (
        owned.where(AcademicsProgram.id == ctx.scope.program_id) if ctx.scope is not None else None
    )
    for query in (_program_query(ctx, inp), scope, _program_query(ctx, out), owned):
        if query is None:
            continue
        zones = (await ctx.db.scalars(query.limit(2))).all()
        if len(zones) == 1:
            return ZoneInfo(zones[0])
    return None
