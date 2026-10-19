"""The system prompt (M12 §3.4), ordered for prompt-cache reuse: most stable first.

1. `STATIC_PROMPT` (`prompts/system.md`): fixed instructions, no variables at all.
2. Tool definitions (sent by the adapter; core and meta tools in a fixed order, tools loaded on
   demand only appended, see `tools.bound_tools`).
3. `work_context`: the user's name, where the assistant works (Program or term), today's date
   and current term, the reply language. Stable for a whole day unless the user switches the scope.
4. The history. Each user message carries a `[Sent …]` note made from its own stored time, so
   earlier messages never change (nothing is persisted; see `history.build`).

The time of day never appears in 1-3: a minute-precise "now" there would invalidate the whole
cached prefix every minute.
"""

from dataclasses import dataclass
from datetime import datetime, tzinfo
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

STATIC_PROMPT = Template(
    (Path(__file__).parent / "prompts" / "system.md").read_text(encoding="utf-8")
).substitute(untrusted=UNTRUSTED_NOTICE)
_LANGUAGES = {"en": "English", "zh-CN": "Simplified Chinese"}


@dataclass(frozen=True)
class WorkContext:
    text: str
    timezone: tzinfo


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
    # Conversations started before scopes stopped at the term may still name a course.
    if scope is not None and scope.course_id:
        try:
            course = await academics.get_course_row(ctx, scope.course_id)
            label = f"{course.code} {course.title}" if course.code else course.title
            parts.append(f'course "{label}" (course_id {course.id})')
        except AppError:
            pass
    if scope is None:
        parts.append("(their only Program)")
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


async def work_context(ctx: Ctx, scope: ScopeRef | None) -> WorkContext:
    """Part 3 of the prompt: changes only with the name, the scope, the day or the interface
    language."""
    program = await _program(ctx, scope)
    tz = ZoneInfo(program.timezone) if program is not None else ZoneInfo("UTC")
    today = ctx.now.astimezone(tz)
    name = ctx.user.display_name.strip() if ctx.user is not None else ""
    text = "\n".join(
        [
            "# Context",
            *([f'- The user\'s name: "{name}".'] if name else []),
            f"- You work in: {await _scope_line(ctx, program, scope)}",
            f"- Today: {today.strftime('%A %Y-%m-%d')} ({tz}).",
            f"- {await _term_line(ctx, program)}",
            f"- Answer in the user's interface language: {_LANGUAGES.get(ctx.locale, 'English')}.",
        ]
    )
    return WorkContext(text, tz)


def sent_note(at: datetime, tz: tzinfo) -> str:
    """The note on a user message: when it was written, in the Program's time zone."""
    return f"[Sent {at.astimezone(tz).strftime('%a %Y-%m-%d %H:%M')}]"
