"""The system prompt (M12 §3.4): today's date and week, the page scope and the reply language."""

from datetime import datetime
from pathlib import Path
from string import Template
from zoneinfo import ZoneInfo

from sqlalchemy import select

from semestra.core.context import Ctx, ScopeRef
from semestra.core.errors import AppError
from semestra.modules.academics import rules
from semestra.modules.academics import service as academics
from semestra.modules.academics.models import AcademicsProgram
from semestra.modules.ai import UNTRUSTED_NOTICE

_TEMPLATE = Template((Path(__file__).parent / "prompts" / "system.md").read_text(encoding="utf-8"))
_LANGUAGES = {"en": "English", "zh-CN": "Simplified Chinese"}


async def _program(ctx: Ctx, scope: ScopeRef | None) -> AcademicsProgram | None:
    if scope is not None:
        try:
            return await academics.get_program_row(ctx, scope.program_id)
        except AppError:
            return None
    rows = (
        await ctx.db.scalars(
            select(AcademicsProgram).where(AcademicsProgram.user_id == ctx.user_id).limit(2)
        )
    ).all()
    return rows[0] if len(rows) == 1 else None


async def _scope_line(ctx: Ctx, program: AcademicsProgram | None, scope: ScopeRef | None) -> str:
    if program is None:
        return "no particular Program (ask or list programs when it matters)."
    parts = [f'Program "{program.name}" (program_id {program.id})']
    if scope is not None and scope.term_id:
        try:
            term = await academics.get_term_row(ctx, scope.term_id)
            parts.append(f'term "{term.name}" (term_id {term.id})')
        except AppError:
            pass
    if scope is not None and scope.course_id:
        try:
            course = await academics.get_course_row(ctx, scope.course_id)
            label = f"{course.code} {course.title}" if course.code else course.title
            parts.append(f'course "{label}" (course_id {course.id})')
        except AppError:
            pass
    if scope is None:
        parts.append("(their only Program; no page scope)")
    return ", ".join(parts) + "."


async def _term_line(ctx: Ctx, program: AcademicsProgram | None) -> str:
    if program is None:
        return "Current term: unknown."
    today = academics.program_today(ctx, program)
    term = rules.current_term(await academics.program_terms(ctx, program.id), today)
    if term is None:
        return "The Program has no terms yet."
    week = await academics.term_week_of(ctx, term, today)
    if isinstance(week, rules.BreakSpan):
        when = f"during {week.name}"
    elif week is None:
        when = "outside its dates"
    else:
        when = f"teaching week {week}"
    return (
        f'Current term: "{term.name}" (term_id {term.id}, {term.start_date} to '
        f"{term.end_date}), today is {when}."
    )


async def system_prompt(ctx: Ctx, scope: ScopeRef | None) -> str:
    program = await _program(ctx, scope)
    tz = ZoneInfo(program.timezone) if program is not None else ZoneInfo("UTC")
    now: datetime = ctx.now.astimezone(tz)
    return _TEMPLATE.substitute(
        language=_LANGUAGES.get(ctx.locale, "English"),
        now=now.strftime("%A %Y-%m-%d %H:%M"),
        timezone=str(tz),
        term_line=await _term_line(ctx, program),
        scope_line=await _scope_line(ctx, program, scope),
        untrusted=UNTRUSTED_NOTICE,
    )
