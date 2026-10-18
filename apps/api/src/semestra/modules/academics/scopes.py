"""How a settings scope finds its Program and term (M11 §9, registered in `register`)."""

from semestra.core.context import Ctx
from semestra.modules.academics import service
from semestra.modules.settings import ScopeChain
from semestra.modules.settings.registry import ScopeType


async def resolve_scope(ctx: Ctx, scope_type: ScopeType, scope_id: str) -> ScopeChain:
    """Raises `common.not_found` for scopes that do not exist or belong to someone else.

    A course's term is the one containing today (year-long courses) or its only term; a course
    with several terms none of which is running today has no term level.
    """
    if scope_type == "program":
        return ScopeChain((await service.get_program_row(ctx, scope_id)).id)
    if scope_type == "term":
        term = await service.get_term_row(ctx, scope_id)
        return ScopeChain(term.program_id, term.id)
    course = await service.get_course_row(ctx, scope_id)
    program = await service.get_program_row(ctx, course.program_id)
    course_out = await service.course_out(ctx, course)
    if len(course_out.term_ids) == 1:
        return ScopeChain(program.id, course_out.term_ids[0], course.id)
    today = service.program_today(ctx, program)
    terms = [t for t in await service.program_terms(ctx, program.id) if t.id in course_out.term_ids]
    running = [t for t in terms if t.start_date <= today <= t.end_date]
    return ScopeChain(program.id, running[0].id if running else None, course.id)
