"""Names of Programs, terms and courses for the assistant's chat, and what an MCP client's form
lets the user pick from (`core.labels`)."""

from typing import Any

from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.labels import Resolver, choices, owned_names, resolver
from semestra.modules.academics import service
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


# --- what an MCP client's form lets the user pick (`core.labels.choices`) ---------------------


async def _programs(ctx: Ctx, args: dict[str, Any]) -> list[AcademicsProgram]:
    """The Program the call names, else all of the user's."""
    rows = await service.program_rows(ctx)
    named = [r for r in rows if r.id == args.get("program_id")]
    return named or rows


@choices("program")
async def program_choices(ctx: Ctx, args: dict[str, Any]) -> list[tuple[str, str]]:
    return [(row.id, row.name) for row in await service.program_rows(ctx)]


@choices("term")
async def term_choices(ctx: Ctx, args: dict[str, Any]) -> list[tuple[str, str]]:
    """Newest first; with more than one Program, each term says whose it is."""
    programs = await _programs(ctx, args)
    out: list[tuple[str, str]] = []
    for program in programs:
        for row in reversed(await service.program_terms(ctx, program.id)):
            out.append((row.id, row.name if len(programs) == 1 else f"{row.name} · {program.name}"))
    return out


@choices("course")
async def course_choices(ctx: Ctx, args: dict[str, Any]) -> list[tuple[str, str]]:
    """`CODE · Title (terms)`, the latest terms first; with more than one Program, each course
    says whose it is."""
    programs = await _programs(ctx, args)
    out: list[tuple[str, str]] = []
    for program in programs:
        terms = await service.program_terms(ctx, program.id)
        order = {t.id: i for i, t in enumerate(terms)}
        names = {t.id: t.name for t in terms}
        links = await service.program_links(ctx, program.id)
        rows = (
            await ctx.db.scalars(
                select(AcademicsCourse).where(
                    AcademicsCourse.user_id == ctx.user_id,
                    AcademicsCourse.program_id == program.id,
                )
            )
        ).all()

        latest = {
            r.id: max((order[t] for t in links.get(r.id, ()) if t in order), default=-1)
            for r in rows
        }
        for row in sorted(rows, key=lambda r: (-latest[r.id], r.code or r.title)):
            term_ids = sorted(links.get(row.id, ()), key=lambda t: order.get(t, -1))
            label = " · ".join(p for p in (row.code, row.title) if p)
            if term_ids:
                label += f" ({', '.join(names[t] for t in term_ids if t in names)})"
            if len(programs) > 1:
                label += f" · {program.name}"
            out.append((row.id, label))
    return out
