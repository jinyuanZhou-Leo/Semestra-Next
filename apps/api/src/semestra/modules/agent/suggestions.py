"""Suggested questions above Sem's input box (M12 §6.1).

The facts come from the user's data: what the calendar holds for today and the next days
(deadlines and tasks from every calendar source, today's classes) and each course's gradebook.
Each fact has a stable key; the client words it from `code` and `params`. With the setting
`assistant.ai_suggestions` on and a small model available, the small model rewrites the facts of
the Program's current term, adding a few questions in the spirit of recent conversations, at most
once every 12 hours per Program (`agent_suggestions`). A rewritten question is shown only while
its fact still holds; a new fact shows in the client's words until the next rewrite.
"""

from dataclasses import dataclass, field
from datetime import timedelta
from typing import Literal
from zoneinfo import ZoneInfo

import structlog
from sqlalchemy import select
from starlette.datastructures import State

from semestra.core.context import Ctx, run_after_commit
from semestra.core.errors import AppError
from semestra.core.events import events
from semestra.modules import ai
from semestra.modules.academics import rules as academic_rules
from semestra.modules.academics import service as academics
from semestra.modules.academics.models import AcademicsProgram
from semestra.modules.agent.models import AgentSession, AgentSuggestions
from semestra.modules.agent.runtime import agent_ctx
from semestra.modules.agent.schemas import (
    AgentScope,
    Suggestion,
    SuggestionCode,
    SuggestionList,
    SuggestionWording,
)
from semestra.modules.agent.settings import AssistantSettings
from semestra.modules.ai import Message
from semestra.modules.grading.service import program_courses, scored_counts
from semestra.modules.schedule import sources as calendar
from semestra.modules.settings import service as settings_service

log = structlog.get_logger()

LIMIT = 3
REFRESH = timedelta(hours=12)  # at most twice a day
MAX_FACTS = 12  # what the small model sees
MAX_HISTORY = 10  # recent conversation titles it sees
MAX_TEXT = 80

# Lower first; within a rank, sooner first.
_RANK: dict[SuggestionCode, int] = {
    "overdue": 0,
    "due_today": 1,
    "due_tomorrow": 2,
    "classes_today": 3,
    "due_soon": 4,
    "import_syllabus": 5,
    "grade_target": 6,
}
_GENERIC_BY_LEVEL: dict[str, tuple[SuggestionCode, ...]] = {
    "program": ("week_deadlines", "gpa"),
    "term": ("week_deadlines", "term_gpa"),
    "course": ("week_deadlines",),
}

# How a fact reads to the small model.
_DESCRIBE: dict[SuggestionCode, str] = {
    "overdue": "overdue: {title}",
    "due_today": "due today: {title}",
    "due_tomorrow": "due tomorrow: {title}",
    "due_soon": "due on {date}: {title}",
    "classes_today": "{count} more class(es) today",
    "import_syllabus": "{course} has no assessments yet (its syllabus could be imported)",
    "grade_target": "{course} has some grades in and more to come (score needed for a target)",
}


@dataclass(frozen=True)
class Fact:
    key: str
    code: SuggestionCode
    params: dict[str, str] = field(default_factory=dict[str, str])
    course_id: str | None = None
    order: str = ""  # sorts within a rank (an ISO time)


@dataclass(frozen=True)
class _Scope:
    program_id: str
    term_id: str | None
    course_ids: frozenset[str]
    labels: dict[str, str]
    level: Literal["program", "term", "course"]

    def covers(self, course_id: str | None) -> bool:
        """A Program covers all its items; a term its courses' and those of no course (a
        personal task); a course its own."""
        if self.level == "program":
            return True
        return course_id in self.course_ids if course_id else self.level == "term"


async def _scope(ctx: Ctx, program_id: str, term_id: str | None, course_id: str | None) -> _Scope:
    """The courses a scope covers: one course, a term's, or the current term's for a Program."""
    program = await academics.get_program_row(ctx, program_id)
    level = "course" if course_id is not None else "term" if term_id is not None else "program"
    if level == "program":
        term = academic_rules.current_term(
            await academics.program_terms(ctx, program.id), academics.program_today(ctx, program)
        )
        term_id = term.id if term else None
    courses = (
        [c for c in await program_courses(ctx, program.id) if c.id == course_id]
        if course_id is not None
        else await program_courses(ctx, program.id, term_id)
        if term_id is not None
        else []
    )
    return _Scope(
        program_id=program.id,
        term_id=term_id,
        course_ids=frozenset(c.id for c in courses),
        labels={c.id: c.alias or c.code or c.title for c in courses},
        level=level,
    )


async def facts(ctx: Ctx, scope: _Scope) -> list[Fact]:
    """What is worth asking about in the scope now, most pressing first."""
    program = await academics.get_program_row(ctx, scope.program_id)
    tz = ZoneInfo(program.timezone)
    today = await calendar.today(ctx, program.id)

    out: list[Fact] = []
    seen: set[str] = set()
    for o in [*today.tasks, *today.upcoming]:
        if o.id in seen or not scope.covers(o.course_id):
            continue
        seen.add(o.id)
        due = o.start_at.astimezone(tz).date()
        code: SuggestionCode = (
            "overdue"
            if o.status == "overdue"
            else "due_today"
            if due <= today.day
            else "due_tomorrow"
            if due == today.day + timedelta(days=1)
            else "due_soon"
        )
        params = {"title": o.title, "date": due.isoformat()}
        out.append(Fact(o.id, code, params, o.course_id, o.start_at.isoformat()))
    classes = [
        o
        for o in today.items
        if o.kind == "class"
        and o.status != "cancelled"
        and scope.covers(o.course_id)
        and (o.end_at or o.start_at) > ctx.now
    ]
    if classes:
        course = classes[0].course_id if scope.level == "course" else None
        out.append(
            Fact(
                f"classes_today:{today.day.isoformat()}",
                "classes_today",
                {"count": str(len(classes))},
                course,
            )
        )
    counts = await scored_counts(ctx, sorted(scope.course_ids))
    for course_id, label in sorted(scope.labels.items(), key=lambda kv: kv[1]):
        scored, unscored = counts.get(course_id, (0, 0))
        params = {"course": label}
        if scored + unscored == 0:
            out.append(Fact(f"import_syllabus:{course_id}", "import_syllabus", params, course_id))
        elif scored and unscored:
            out.append(Fact(f"grade_target:{course_id}", "grade_target", params, course_id))
    out.sort(key=lambda f: (_RANK[f.code], f.order))
    return out


def pick(found: list[Fact], worded: list[dict[str, str | None]], scope: _Scope) -> list[Suggestion]:
    """Up to three: the most pressing facts of different kinds (in the small model's words when
    it wrote about them), one question from recent conversations when there is one, then the
    general questions."""
    texts = {w["key"]: w["text"] for w in worded if w.get("key")}
    history = [w for w in worded if not w.get("key") and scope.covers(w.get("course_id"))]
    out: list[Suggestion] = []
    kinds: set[str] = set()
    for f in found:
        if f.code in kinds:
            continue
        kinds.add(f.code)
        out.append(
            Suggestion(
                key=f.key,
                code=f.code,
                params=f.params,
                course_id=f.course_id,
                text=texts.get(f.key),
            )
        )
    if history and len(out) >= LIMIT:
        out = out[: LIMIT - 1]
    for i, w in enumerate(history[: LIMIT - len(out)]):
        out.append(
            Suggestion(
                key=f"history:{i}", code="history", course_id=w.get("course_id"), text=w["text"]
            )
        )
    generic = _GENERIC_BY_LEVEL[scope.level]
    for code in generic[: max(0, LIMIT - len(out))]:
        out.append(Suggestion(key=f"generic:{code}", code=code))
    return out[:LIMIT]


async def _ai_on(ctx: Ctx) -> bool:
    resolved = await settings_service.get_values(ctx, "assistant", "account", None)
    if not AssistantSettings.model_validate(resolved.values).ai_suggestions:
        return False
    return await ai.available(ctx, "title")


async def _row(ctx: Ctx, program_id: str) -> AgentSuggestions | None:
    return await ctx.db.scalar(
        select(AgentSuggestions).where(
            AgentSuggestions.user_id == ctx.user_id, AgentSuggestions.program_id == program_id
        )
    )


async def list_suggestions(ctx: Ctx, inp: AgentScope) -> SuggestionList:
    scope = await _scope(ctx, inp.program_id, inp.term_id, inp.course_id)
    found = await facts(ctx, scope)
    worded: list[dict[str, str | None]] = []
    if await _ai_on(ctx):
        row = await _row(ctx, scope.program_id)
        if row is not None and row.locale == ctx.locale:
            worded = row.items
        if row is None or row.locale != ctx.locale or ctx.now - row.generated_at >= REFRESH:
            ctx.state.agent.background(
                _rewrite(ctx.state, ctx.user_id, scope.program_id, ctx.locale),
                key=f"suggestions:{ctx.user_id}:{scope.program_id}",
            )
    return SuggestionList(items=pick(found, worded, scope))


def _prompt(
    locale: str, found: list[Fact], labels: dict[str, str], titles: list[str]
) -> list[Message]:
    language = "Simplified Chinese" if locale == "zh-CN" else "English"
    lines = []
    for i, f in enumerate(found, 1):
        course = f" (course {labels[f.course_id]})" if f.course_id in labels else ""
        lines.append(f"[{i}] {_DESCRIBE[f.code].format(**f.params)}{course}")
    system = (
        "You suggest questions a university student could ask Sem, their study assistant, to "
        f"start a conversation. Write in {language}, in the student's voice, each at most 40 "
        "characters (Chinese) or 60 characters (English), with no quotes around the question.\n"
        "- For each numbered fact, write one question or request about it. Name the course "
        "or item as given; do not invent dates, numbers or details.\n"
        "- Then add up to 3 questions on topics the student is likely to come back to, judging "
        "from the titles of their recent conversations (fact null; course only if one is clearly "
        "meant). Skip this when the titles show nothing worth repeating.\n"
        f"{ai.UNTRUSTED_NOTICE}"
    )
    user = "\n\n".join(
        [
            "Courses: " + (", ".join(sorted(labels.values())) or "none"),
            ai.wrap_untrusted("\n".join(lines) or "none", "facts"),
            ai.wrap_untrusted("\n".join(titles) or "none", "recent conversation titles"),
        ]
    )
    return [Message.system(system), Message.user(user)]


def _worded(
    out: SuggestionWording, found: list[Fact], labels: dict[str, str]
) -> list[dict[str, str | None]]:
    by_label = {label: course_id for course_id, label in labels.items()}
    items: list[dict[str, str | None]] = []
    used: set[str] = set()
    for q in out.questions:
        text = " ".join(q.text.split()).strip("\"'“”「」")
        if not text or len(text) > MAX_TEXT:
            continue
        if q.fact is not None:
            if not 1 <= q.fact <= len(found):
                continue
            f = found[q.fact - 1]
            if f.key in used:
                continue
            used.add(f.key)
            items.append({"key": f.key, "course_id": f.course_id, "text": text})
        elif sum(1 for i in items if i["key"] is None) < LIMIT:
            course_id = by_label.get(q.course or "")
            items.append({"key": None, "course_id": course_id, "text": text})
    return items


async def _rewrite(state: State, user_id: str, program_id: str, locale: str) -> None:
    """Has the small model word the current term's facts in the language the client asked in (a
    user following the browser has no stored one) and stores the result. A failure keeps the
    previous wording, if in that language, until the next attempt 12 hours later."""
    items: list[dict[str, str | None]] | None = None
    async with agent_ctx(state, user_id, scope=None) as ctx:
        scope = await _scope(ctx, program_id, None, None)
        found = (await facts(ctx, scope))[:MAX_FACTS]
        titles = list(
            await ctx.db.scalars(
                select(AgentSession.title)
                .where(
                    AgentSession.user_id == user_id,
                    AgentSession.program_id == program_id,
                    AgentSession.temporary.is_(False),
                    AgentSession.title.is_not(None),
                )
                .order_by(AgentSession.updated_at.desc())
                .limit(MAX_HISTORY)
            )
        )
        messages = _prompt(locale, found, scope.labels, [t for t in titles if t])
        await ctx.db.commit()  # no transaction open during the call
        try:
            items = _worded(await state.agent.suggestion_model(ctx, messages), found, scope.labels)
        except AppError as exc:
            log.info("agent_suggestions_failed", code=exc.code)
    async with agent_ctx(state, user_id, scope=None) as ctx:
        row = await _row(ctx, program_id)
        if row is None:
            if await ctx.db.get(AcademicsProgram, program_id) is None:
                return  # deleted meanwhile
            row = AgentSuggestions(user_id=user_id, program_id=program_id, locale=locale, items=[])
            ctx.db.add(row)
        if items is None and row.locale != locale:
            items = []
        row.generated_at = ctx.now
        row.locale = locale
        if items is not None:
            row.items = items
        await events.publish(ctx, "agent.suggestions.updated", {"program_id": program_id})
        await ctx.db.commit()
        await run_after_commit(ctx)
