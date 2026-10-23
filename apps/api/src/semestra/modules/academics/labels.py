"""Names of Programs, terms and courses for the assistant's chat (`core.labels`)."""

from typing import Any

from semestra.core.context import Ctx
from semestra.core.labels import Resolver, owned_names, resolver
from semestra.modules.academics.models import AcademicsCourse, AcademicsProgram, AcademicsTerm

program = resolver("program")(owned_names(AcademicsProgram, lambda row: row.name))
term = resolver("term")(owned_names(AcademicsTerm, lambda row: row.name))
course = resolver("course")(owned_names(AcademicsCourse, lambda row: row.code or row.title))
resolver("continue_course")(course)


@resolver("scope")
async def scope(ctx: Ctx, ids: list[str], args: dict[str, Any]) -> dict[str, str]:
    """A settings level or a board, by the `scope_type` beside it (`today` is a Program's)."""
    by_kind: dict[Any, Resolver] = {
        "program": program,
        "today": program,
        "term": term,
        "course": course,
    }
    fn = by_kind.get(args.get("scope_type"))
    return await fn(ctx, ids, args) if fn is not None else {}
