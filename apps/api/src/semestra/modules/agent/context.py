"""The system prompt (M12 §3.4), ordered for prompt-cache reuse: most stable first.

1. `STATIC_PROMPT` (`prompts/system.md` with the shared `prompts/rules.md`): fixed instructions,
   no variables at all.
2. Tool definitions (core tools and `search_tools`/`load_capability`/`read_tool_result` in a fixed
   order; tools found later are only appended, see `tools.toolset` and `loop._tool_order`).
3. `work_context`: the user's name, where the assistant works (Program or term), today's date
   and current term (with its dates and breaks), the reply language. Stable for a whole day unless
   the user renames themselves, edits the term or switches the scope.
4. The history. Each user message carries a `[Sent …]` note made from its own stored time, so
   earlier messages never change (nothing is persisted; see `history.user_request`).

The time of day never appears in 1-3: a minute-precise "now" there would invalidate the whole
cached prefix every minute.
"""

import json
from dataclasses import dataclass
from datetime import datetime, tzinfo
from pathlib import Path
from string import Template
from zoneinfo import ZoneInfo

from semestra.core.context import Ctx, ScopeRef
from semestra.core.errors import AppError
from semestra.modules.academics import rules
from semestra.modules.academics import service as academics
from semestra.modules.academics.models import AcademicsProgram, AcademicsTerm
from semestra.modules.ai import UNTRUSTED_NOTICE

_PROMPTS = Path(__file__).parent / "prompts"


def prompt(name: str) -> str:
    return (_PROMPTS / f"{name}.md").read_text(encoding="utf-8").strip()


def instructions(name: str, untrusted: str = "") -> str:
    """A surface's fixed instructions (`prompts/<name>.md`) with the rules every surface shares
    (`prompts/rules.md`): Sem's system prompt, and what MCP clients get at initialization.
    `untrusted`: how this surface marks untrusted text, when it does. A surface's own rules
    (`prompts/<name>-rules.md`, when there is one) go where `$surface` stands."""
    rules = Template(prompt("rules")).substitute(untrusted=f" {untrusted}" if untrusted else "")
    own = _PROMPTS / f"{name}-rules.md"
    surface = prompt(f"{name}-rules") if own.exists() else ""
    return (
        Template(prompt(name)).safe_substitute(rules=rules, surface=surface, about=prompt("about"))
        + "\n"
    )


STATIC_PROMPT = instructions("system", UNTRUSTED_NOTICE)
_LANGUAGES = {"en": "English", "zh-CN": "Simplified Chinese"}


def _quoted(name: str) -> str:
    """A user-set name as one quoted line: whitespace collapsed, capped, quotes escaped, so it
    cannot start a new section of the prompt."""
    return json.dumps(" ".join(name.split())[:120], ensure_ascii=False)


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
    return await academics.only_program_row(ctx)


async def _scope_line(
    ctx: Ctx,
    program: AcademicsProgram | None,
    scope: ScopeRef | None,
    current: AcademicsTerm | None,
) -> str:
    if program is None:
        return "no particular Program (ask or list programs when it matters)."
    parts = [f"Program {_quoted(program.name)} (program_id {program.id})"]
    if scope is not None and scope.term_id:
        try:
            term = await academics.get_term_row(ctx, scope.term_id)
            # The current term's dates and breaks are on its own line below.
            about = "the current term" if current and term.id == current.id else _dates(term)
            parts.append(f"term {_quoted(term.name)} (term_id {term.id}, {about})")
        except AppError:
            pass
    if scope is None:
        parts.append("(their only Program)")
    return ", ".join(parts) + "."


async def _current_term(ctx: Ctx, program: AcademicsProgram | None) -> AcademicsTerm | None:
    if program is None:
        return None
    today = academics.program_today(ctx, program)
    return rules.current_term(await academics.program_terms(ctx, program.id), today)


async def _term_line(ctx: Ctx, program: AcademicsProgram | None, term: AcademicsTerm | None) -> str:
    if program is None:
        return "Current term: unknown."
    if term is None:
        return "The Program has no terms yet."
    week = await academics.term_week_of(ctx, term, academics.program_today(ctx, program))
    if isinstance(week, rules.BreakSpan):
        when = f"during {week.name}"
    elif week is None:
        when = "outside its dates"
    else:
        when = f"teaching week {week}"
    return (
        f"Current term: {_quoted(term.name)} (term_id {term.id}, {_dates(term)}), today is {when}."
    )


def _dates(term: AcademicsTerm) -> str:
    """The term's dates and its breaks (holidays, reading weeks): a few dates that change what
    any plan or date in the term means, so they are given rather than left to be looked up."""
    days = [
        f"{_quoted(b.name)} {b.start_date}"
        + (f" to {b.end_date}" if b.end_date != b.start_date else "")
        for b in academics.term_breaks(term)
    ]
    breaks = f"breaks: {', '.join(days)}" if days else "no breaks"
    return f"{term.start_date} to {term.end_date}; {breaks}"


async def work_context(ctx: Ctx, scope: ScopeRef | None) -> WorkContext:
    """Part 3 of the prompt: changes only with the name, the scope, the day or the interface
    language."""
    program = await _program(ctx, scope)
    tz = ZoneInfo(program.timezone) if program is not None else ZoneInfo("UTC")
    today = ctx.now.astimezone(tz)
    name = ctx.user.display_name.strip() if ctx.user is not None else ""
    current = await _current_term(ctx, program)
    text = "\n".join(
        [
            "# Context (read when this step started)",
            *([f"- The user's name: {_quoted(name)}."] if name else []),
            f"- You work in: {await _scope_line(ctx, program, scope, current)}",
            f"- Today: {today.strftime('%A %Y-%m-%d')} ({tz}).",
            f"- {await _term_line(ctx, program, current)}",
            f"- Answer in the user's interface language: {_LANGUAGES.get(ctx.locale, 'English')}.",
        ]
    )
    return WorkContext(text, tz)


def sent_note(at: datetime, tz: tzinfo) -> str:
    """The note on a user message: when it was written, in the Program's time zone."""
    return f"[Sent {at.astimezone(tz).strftime('%a %Y-%m-%d %H:%M')}]"
