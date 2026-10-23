"""Programs, terms and courses (M02). Capabilities stay thin and call into here."""

from collections import defaultdict
from collections.abc import Awaitable, Callable, Generator, Iterable, Sequence
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import date
from itertools import pairwise
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import delete, func, select

from semestra.core.context import Ctx
from semestra.core.db import new_id
from semestra.core.errors import AppError, not_found
from semestra.core.events import events
from semestra.modules.academics import rules
from semestra.modules.academics.models import (
    AcademicsCourse,
    AcademicsCourseTerm,
    AcademicsProgram,
    AcademicsTerm,
)
from semestra.modules.academics.schemas import (
    Break,
    BreakIn,
    BreakRef,
    CalendarInfo,
    ColorRef,
    Course,
    CourseCandidate,
    CourseCandidates,
    CourseFields,
    CourseListInput,
    CoursePage,
    CourseRef,
    CourseSetTermsInput,
    CourseUpdateInput,
    Program,
    ProgramCreateInput,
    ProgramRef,
    ProgramUpdateInput,
    Term,
    TermCreateInput,
    TermCreateResult,
    TermDeletePreview,
    TermDeleteResult,
    TermRef,
    TermUpdateInput,
    TermWeek,
)
from semestra.modules.settings import service as settings_service

# --- loading --------------------------------------------------------------------------------


async def default_program_id(ctx: Ctx) -> str | None:
    """The Program an agent call without `program_id` means: the one the user is in, else their
    only one."""
    if ctx.scope is not None:
        return ctx.scope.program_id
    ids = (
        await ctx.db.scalars(
            select(AcademicsProgram.id).where(AcademicsProgram.user_id == ctx.user_id).limit(2)
        )
    ).all()
    return ids[0] if len(ids) == 1 else None


# --- read-only memo -------------------------------------------------------------------------

_memo: ContextVar[dict[Any, Any] | None] = ContextVar("academics_memo", default=None)


@contextmanager
def read_memo() -> Generator[None]:
    """Within the block, terms, course lists and the week start are read once and reused.
    Only for read-only work that asks for them again and again (the calendar's sources, grade
    summaries): nothing written inside the block would show."""
    if _memo.get() is not None:  # nested: the outer block's memo stays
        yield
        return
    token = _memo.set({})
    try:
        yield
    finally:
        _memo.reset(token)


async def _memoized[T](key: Any, load: Callable[[], Awaitable[T]]) -> T:
    memo = _memo.get()
    if memo is None:
        return await load()
    if key not in memo:
        memo[key] = await load()
    return memo[key]


async def get_program_row(ctx: Ctx, program_id: str) -> AcademicsProgram:
    row = await ctx.db.get(AcademicsProgram, program_id)
    if row is None or row.user_id != ctx.user_id:
        raise not_found("program", program_id)
    return row


async def get_term_row(ctx: Ctx, term_id: str) -> AcademicsTerm:
    row = await ctx.db.get(AcademicsTerm, term_id)
    if row is None or row.user_id != ctx.user_id:
        raise not_found("term", term_id)
    return row


async def get_course_row(ctx: Ctx, course_id: str) -> AcademicsCourse:
    row = await ctx.db.get(AcademicsCourse, course_id)
    if row is None or row.user_id != ctx.user_id:
        raise not_found("course", course_id)
    return row


# Targets for the assistant's confirmation cards of deletes (M12 §3.5): what goes, by name.


# Lists on a card show this many names; `count` says how many there are in all.
_SHOWN = 10


def _course_names(rows: Sequence[AcademicsCourse]) -> list[str]:
    return [r.code or r.title for r in sorted(rows, key=lambda r: (r.code or r.title).lower())]


async def courses_by_id(ctx: Ctx, ids: Sequence[str]) -> list[AcademicsCourse]:
    """The ctx user's courses with these ids, in one query (missing ones are left out)."""
    if not ids:
        return []
    return list(
        await ctx.db.scalars(
            select(AcademicsCourse).where(
                AcademicsCourse.user_id == ctx.user_id, AcademicsCourse.id.in_(ids)
            )
        )
    )


async def preview_program_delete(ctx: Ctx, inp: ProgramRef) -> dict[str, Any]:
    program = await get_program_row(ctx, inp.program_id)
    terms = [t.name for t in await program_terms(ctx, program.id)]
    courses = _course_names(
        list(
            await ctx.db.scalars(
                select(AcademicsCourse).where(
                    AcademicsCourse.user_id == ctx.user_id,
                    AcademicsCourse.program_id == program.id,
                )
            )
        )
    )
    changes = [
        {"field": field, "before": names[:_SHOWN], "after": None, "count": len(names)}
        for field, names in (("terms", terms), ("courses", courses))
        if names
    ]
    return {"target": program.name, "changes": changes}


async def preview_term_delete(ctx: Ctx, inp: TermRef) -> dict[str, Any]:
    """Which courses go with the term, and which stay because they have other terms (the same
    split as `academics.term.preview_delete` and the delete itself)."""
    term = await get_term_row(ctx, inp.term_id)
    program = await get_program_row(ctx, term.program_id)
    only, kept = await _term_course_split(ctx, term)
    changes: list[dict[str, Any]] = []
    if deleted := _course_names(await courses_by_id(ctx, only)):
        changes.append(
            {"field": "courses", "before": deleted[:_SHOWN], "after": None, "count": len(deleted)}
        )
    if staying := _course_names(await courses_by_id(ctx, kept)):
        changes.append({"field": "kept_courses", "after": staying[:_SHOWN], "count": len(staying)})
    return {"target": f"{term.name} · {program.name}", "changes": changes}


async def preview_course_set_terms(ctx: Ctx, inp: CourseSetTermsInput) -> dict[str, Any]:
    """The course's terms before → after, by name and in the Program's order."""
    course = await get_course_row(ctx, inp.course_id)
    terms = await program_terms(ctx, course.program_id)
    current = (await _links(ctx, [course.id])).get(course.id, set())
    wanted = set(inp.term_ids)
    return {
        "target": course.code or course.title,
        "changes": [
            {
                "field": "terms",
                "before": [t.name for t in terms if t.id in current],
                "after": [t.name for t in terms if t.id in wanted],
            }
        ],
    }


async def preview_course_delete(ctx: Ctx, inp: CourseRef) -> dict[str, Any]:
    course = await get_course_row(ctx, inp.course_id)
    return {
        "target": f"{course.code} {course.title}" if course.code else course.title,
        "changes": [],
    }


async def program_terms(ctx: Ctx, program_id: str) -> list[AcademicsTerm]:
    """The Program's terms in chronological order."""
    return list(
        await _memoized(("terms", ctx.user_id, program_id), lambda: _program_terms(ctx, program_id))
    )


async def _program_terms(ctx: Ctx, program_id: str) -> list[AcademicsTerm]:
    rows = (
        await ctx.db.scalars(
            select(AcademicsTerm).where(
                AcademicsTerm.user_id == ctx.user_id, AcademicsTerm.program_id == program_id
            )
        )
    ).all()
    return sorted(rows, key=rules.term_sort_key)


async def _links(ctx: Ctx, course_ids: Iterable[str]) -> dict[str, set[str]]:
    ids = list(course_ids)
    if not ids:
        return {}
    rows = (
        await ctx.db.execute(
            select(AcademicsCourseTerm.course_id, AcademicsCourseTerm.term_id).where(
                AcademicsCourseTerm.user_id == ctx.user_id,
                AcademicsCourseTerm.course_id.in_(ids),
            )
        )
    ).all()
    links: dict[str, set[str]] = defaultdict(set)
    for course_id, term_id in rows:
        links[course_id].add(term_id)
    return links


async def _program_links(ctx: Ctx, program_id: str) -> dict[str, set[str]]:
    rows = (
        await ctx.db.execute(
            select(AcademicsCourseTerm.course_id, AcademicsCourseTerm.term_id)
            .join(AcademicsCourse, AcademicsCourse.id == AcademicsCourseTerm.course_id)
            .where(
                AcademicsCourseTerm.user_id == ctx.user_id,
                AcademicsCourse.program_id == program_id,
            )
        )
    ).all()
    links: dict[str, set[str]] = defaultdict(set)
    for course_id, term_id in rows:
        links[course_id].add(term_id)
    return links


def program_today(ctx: Ctx, program: AcademicsProgram) -> date:
    return ctx.now.astimezone(ZoneInfo(program.timezone)).date()


# --- output ---------------------------------------------------------------------------------


async def _program_out(ctx: Ctx, rows: Sequence[AcademicsProgram]) -> list[Program]:
    ids = [r.id for r in rows]
    term_counts: dict[str, int] = {}
    course_counts: dict[str, int] = {}
    if ids:
        for model, counts in ((AcademicsTerm, term_counts), (AcademicsCourse, course_counts)):
            result = await ctx.db.execute(
                select(model.program_id, func.count())
                .where(model.user_id == ctx.user_id, model.program_id.in_(ids))
                .group_by(model.program_id)
            )
            counts.update({pid: n for pid, n in result.all()})
    return [
        Program.model_validate(
            {
                **_columns(r),
                "term_count": term_counts.get(r.id, 0),
                "course_count": course_counts.get(r.id, 0),
            }
        )
        for r in rows
    ]


def _columns(row: Any) -> dict[str, Any]:
    return {c.key: getattr(row, c.key) for c in row.__table__.columns}


async def program_out(ctx: Ctx, row: AcademicsProgram) -> Program:
    return (await _program_out(ctx, [row]))[0]


async def _terms_out(
    ctx: Ctx, program: AcademicsProgram, rows: Sequence[AcademicsTerm]
) -> list[Term]:
    current = rules.current_term(await program_terms(ctx, program.id), program_today(ctx, program))
    counts: dict[str, int] = {}
    if rows:
        result = await ctx.db.execute(
            select(AcademicsCourseTerm.term_id, func.count())
            .where(
                AcademicsCourseTerm.user_id == ctx.user_id,
                AcademicsCourseTerm.term_id.in_([r.id for r in rows]),
            )
            .group_by(AcademicsCourseTerm.term_id)
        )
        counts = {tid: n for tid, n in result.all()}
    return [
        Term.model_validate(
            {
                **_columns(r),
                "is_current": current is not None and current.id == r.id,
                "course_count": counts.get(r.id, 0),
            }
        )
        for r in rows
    ]


async def term_out(ctx: Ctx, row: AcademicsTerm) -> Term:
    program = await get_program_row(ctx, row.program_id)
    return (await _terms_out(ctx, program, [row]))[0]


def _course_out(
    row: AcademicsCourse,
    program: AcademicsProgram,
    term_ids: set[str],
    order: list[str],
) -> Course:
    ordered = [t for t in order if t in term_ids]
    return Course.model_validate(
        {
            **_columns(row),
            "resolved_color": rules.resolve_course_color(
                row.color, row.subject_code, program.subject_colors, row.id
            ),
            "subject_color": rules.resolve_course_color(
                None, row.subject_code, program.subject_colors, row.id
            ),
            "term_ids": ordered,
            "end_term_id": ordered[-1] if ordered else "",
        }
    )


async def courses_out(
    ctx: Ctx, program: AcademicsProgram, rows: Sequence[AcademicsCourse]
) -> list[Course]:
    order = [t.id for t in await program_terms(ctx, program.id)]
    links = await _links(ctx, [r.id for r in rows])
    return [_course_out(r, program, links.get(r.id, set()), order) for r in rows]


async def course_out(ctx: Ctx, row: AcademicsCourse) -> Course:
    program = await get_program_row(ctx, row.program_id)
    return (await courses_out(ctx, program, [row]))[0]


# --- programs -------------------------------------------------------------------------------


async def list_programs(ctx: Ctx) -> list[Program]:
    rows = (
        await ctx.db.scalars(
            select(AcademicsProgram)
            .where(AcademicsProgram.user_id == ctx.user_id)
            .order_by(AcademicsProgram.sort_order, AcademicsProgram.created_at, AcademicsProgram.id)
        )
    ).all()
    return await _program_out(ctx, rows)


async def create_program(ctx: Ctx, inp: ProgramCreateInput) -> Program:
    last = await ctx.db.scalar(
        select(func.max(AcademicsProgram.sort_order)).where(AcademicsProgram.user_id == ctx.user_id)
    )
    row = AcademicsProgram(
        id=new_id(),
        user_id=ctx.user_id,
        name=inp.name,
        institution=inp.institution,
        timezone=inp.timezone,
        default_course_credits=inp.default_course_credits,
        credit_requirement=inp.credit_requirement,
        subject_colors={},
        sort_order=(last + 1) if last is not None else 0,
        created_at=ctx.now,
        updated_at=ctx.now,
    )
    ctx.db.add(row)
    await ctx.db.flush()
    await events.publish(
        ctx, "academics.program.created", {"program_id": row.id, "setup": inp.setup}
    )
    return await program_out(ctx, row)


_NULLABLE_PROGRAM = {"institution", "credit_requirement"}


async def update_program(ctx: Ctx, inp: ProgramUpdateInput) -> Program:
    row = await get_program_row(ctx, inp.program_id)
    changed = _apply(row, inp, _NULLABLE_PROGRAM, exclude={"program_id"})
    if changed:
        row.updated_at = ctx.now
        await ctx.db.flush()
        await events.publish(
            ctx, "academics.program.updated", {"program_id": row.id, "fields": changed}
        )
    return await program_out(ctx, row)


def _apply(row: Any, inp: Any, nullable: set[str], *, exclude: set[str]) -> list[str]:
    """PATCH semantics: copy the sent fields; null only where allowed. Returns changed fields."""
    sent = inp.model_fields_set - exclude
    bad = sorted(f for f in sent if getattr(inp, f) is None and f not in nullable)
    if bad:
        raise AppError(
            "common.validation", 422, errors=[{"loc": [f], "code": "none_not_allowed"} for f in bad]
        )
    changed: list[str] = []
    for field in sorted(sent):
        value = getattr(inp, field)
        if hasattr(value, "model_dump"):
            value = value.model_dump(mode="json")
        elif isinstance(value, list):
            value = [v.model_dump(mode="json") if hasattr(v, "model_dump") else v for v in value]
        if getattr(row, field) != value:
            setattr(row, field, value)
            changed.append(field)
    return changed


async def set_subject_color(ctx: Ctx, program_id: str, subject: str, color: ColorRef) -> Program:
    row = await get_program_row(ctx, program_id)
    subject = subject.strip().upper()
    row.subject_colors = {**row.subject_colors, subject: color.model_dump(mode="json")}
    row.updated_at = ctx.now
    await ctx.db.flush()
    await events.publish(
        ctx, "academics.program.updated", {"program_id": row.id, "fields": ["subject_colors"]}
    )
    return await program_out(ctx, row)


def ensure_subject_color(program: AcademicsProgram, subject: str) -> None:
    """A subject seen for the first time gets the least used palette slot; existing subjects
    keep their color whatever happens to their courses (M02 §2)."""
    if subject and subject not in program.subject_colors:
        slot = rules.next_palette_slot(program.subject_colors)
        program.subject_colors = {**program.subject_colors, subject: {"palette": slot}}


async def delete_program(ctx: Ctx, program_id: str) -> None:
    """Deletes the Program with every term and course. Other modules clean up in the same
    transaction (`*.deleting`); every deleted term and course is announced after commit
    (`*.deleted`), so scoped data such as settings goes too (M11 §9)."""
    row = await get_program_row(ctx, program_id)
    terms = await program_terms(ctx, program_id)
    links = await _program_links(ctx, program_id)
    courses = (
        await ctx.db.scalars(
            select(AcademicsCourse.id).where(
                AcademicsCourse.user_id == ctx.user_id, AcademicsCourse.program_id == program_id
            )
        )
    ).all()
    order = [t.id for t in terms]
    for course_id in courses:
        await _announce_course_deleting(ctx, course_id, program_id, links.get(course_id), order)
    for term in terms:
        data = {"term_id": term.id, "program_id": program_id}
        await events.publish_in_transaction(ctx, "academics.term.deleting", data)
        await events.publish(ctx, "academics.term.deleted", data)
    data = {"program_id": program_id}
    await events.publish_in_transaction(ctx, "academics.program.deleting", data)
    # Rows go by ON DELETE CASCADE; delete them explicitly anyway so the ORM session agrees.
    await ctx.db.execute(delete(AcademicsCourse).where(AcademicsCourse.program_id == program_id))
    await ctx.db.execute(delete(AcademicsTerm).where(AcademicsTerm.program_id == program_id))
    await ctx.db.delete(row)
    await ctx.db.flush()
    await events.publish(ctx, "academics.program.deleted", data)


async def _announce_course_deleting(
    ctx: Ctx, course_id: str, program_id: str, term_ids: set[str] | None, order: list[str]
) -> None:
    data = {
        "course_id": course_id,
        "program_id": program_id,
        "term_ids": [t for t in order if t in (term_ids or set())],
    }
    await events.publish_in_transaction(ctx, "academics.course.deleting", data)
    await events.publish(ctx, "academics.course.deleted", data)


# --- terms ----------------------------------------------------------------------------------


def _breaks(start: date, end: date, items: Sequence[BreakIn | Break]) -> list[dict[str, Any]]:
    """Validates the term's dates and breaks; returns them as stored (with ids)."""
    if start > end:
        raise AppError("academics.term_date_range_invalid", 422)
    spans = sorted(items, key=lambda b: (b.start_date, b.end_date))
    for b in spans:
        if b.start_date > b.end_date or b.start_date < start or b.end_date > end:
            raise AppError("academics.break_out_of_range", 422, name=b.name)
    for prev, nxt in pairwise(spans):
        if nxt.start_date <= prev.end_date:
            raise AppError("academics.breaks_overlap", 422, names=[prev.name, nxt.name])
    return [
        {
            "id": b.id or new_id(),
            "name": b.name,
            "start_date": b.start_date.isoformat(),
            "end_date": b.end_date.isoformat(),
        }
        for b in spans
    ]


async def check_adjacency(ctx: Ctx, program_id: str) -> None:
    """Every multi-term course must still cover neighbouring terms (e.g. after a term was
    inserted between two terms of a year-long course, or its dates moved)."""
    order = [t.id for t in await program_terms(ctx, program_id)]
    bad = sorted(
        course_id
        for course_id, term_ids in (await _program_links(ctx, program_id)).items()
        if len(term_ids) > 1 and not rules.is_consecutive(order, term_ids)
    )
    if bad:
        raise AppError("academics.course_terms_not_adjacent", 422, course_ids=bad)


async def list_terms(ctx: Ctx, program_id: str) -> list[Term]:
    program = await get_program_row(ctx, program_id)
    return await _terms_out(ctx, program, await program_terms(ctx, program_id))


async def create_term(ctx: Ctx, inp: TermCreateInput) -> TermCreateResult:
    program = await get_program_row(ctx, inp.program_id)
    term = AcademicsTerm(
        id=new_id(),
        user_id=ctx.user_id,
        program_id=program.id,
        name=inp.name,
        start_date=inp.start_date,
        end_date=inp.end_date,
        breaks=_breaks(inp.start_date, inp.end_date, inp.breaks),
        count_break_weeks=inp.count_break_weeks,
        created_at=ctx.now,
        updated_at=ctx.now,
    )
    ctx.db.add(term)
    await ctx.db.flush()

    continued: list[str] = []
    for course_id in dict.fromkeys(inp.continue_course_ids):
        course = await get_course_row(ctx, course_id)
        if course.program_id != program.id:
            raise AppError("academics.course_terms_cross_program", 422, course_ids=[course_id])
        await _link(ctx, course, {term.id}, set())
        continued.append(course_id)
    created = [await create_course(ctx, program, draft, [term.id]) for draft in inp.courses]
    await check_adjacency(ctx, program.id)
    await events.publish(
        ctx, "academics.term.created", {"term_id": term.id, "program_id": program.id}
    )
    return TermCreateResult(
        term=(await _terms_out(ctx, program, [term]))[0],
        course_ids=[c.id for c in created],
        continued_course_ids=continued,
    )


async def update_term(ctx: Ctx, inp: TermUpdateInput) -> Term:
    term = await get_term_row(ctx, inp.term_id)
    sent = inp.model_fields_set - {"term_id"}
    bad = sorted(f for f in sent if getattr(inp, f) is None)
    if bad:
        raise AppError(
            "common.validation", 422, errors=[{"loc": [f], "code": "none_not_allowed"} for f in bad]
        )
    start = inp.start_date or term.start_date
    end = inp.end_date or term.end_date
    # Existing breaks are validated again: moved dates must still contain them.
    breaks = (
        inp.breaks if inp.breaks is not None else [Break.model_validate(b) for b in term.breaks]
    )
    values: dict[str, Any] = {
        "name": inp.name or term.name,
        "start_date": start,
        "end_date": end,
        "breaks": _breaks(start, end, breaks),
        "count_break_weeks": (
            inp.count_break_weeks if inp.count_break_weeks is not None else term.count_break_weeks
        ),
    }
    changed = [field for field, value in values.items() if getattr(term, field) != value]
    for field in changed:
        setattr(term, field, values[field])
    if changed:
        term.updated_at = ctx.now
        await ctx.db.flush()
        if {"start_date", "end_date"} & set(changed):
            await check_adjacency(ctx, term.program_id)
        await events.publish(
            ctx,
            "academics.term.updated",
            {"term_id": term.id, "program_id": term.program_id, "fields": changed},
        )
    return await term_out(ctx, term)


async def _term_course_split(ctx: Ctx, term: AcademicsTerm) -> tuple[list[str], list[str]]:
    """(courses only in this term, multi-term courses that keep their other terms)."""
    course_ids = (
        await ctx.db.scalars(
            select(AcademicsCourseTerm.course_id).where(
                AcademicsCourseTerm.user_id == ctx.user_id, AcademicsCourseTerm.term_id == term.id
            )
        )
    ).all()
    links = await _links(ctx, course_ids)
    only = sorted(c for c in course_ids if links.get(c, set()) <= {term.id})
    kept = sorted(c for c in course_ids if c not in only)
    return only, kept


async def delete_preview(ctx: Ctx, term_id: str) -> TermDeletePreview:
    term = await get_term_row(ctx, term_id)
    only, kept = await _term_course_split(ctx, term)
    return TermDeletePreview(
        deleted_course_count=len(only),
        kept_course_count=len(kept),
        deleted_course_ids=only,
        kept_course_ids=kept,
    )


async def delete_term(ctx: Ctx, term_id: str) -> TermDeleteResult:
    term = await get_term_row(ctx, term_id)
    only, kept = await _term_course_split(ctx, term)
    order = [t.id for t in await program_terms(ctx, term.program_id)]
    links = await _links(ctx, [*only, *kept])
    for course_id in only:
        await _announce_course_deleting(
            ctx, course_id, term.program_id, links.get(course_id), order
        )
    for course_id in kept:
        remaining = links.get(course_id, set()) - {term.id}
        await events.publish(
            ctx,
            "academics.course.terms_changed",
            {
                "course_id": course_id,
                "program_id": term.program_id,
                "term_ids": [t for t in order if t in remaining],
                "added": [],
                "removed": [term.id],
            },
        )
    data = {"term_id": term.id, "program_id": term.program_id}
    await events.publish_in_transaction(ctx, "academics.term.deleting", data)
    if only:
        await ctx.db.execute(delete(AcademicsCourse).where(AcademicsCourse.id.in_(only)))
    await ctx.db.execute(delete(AcademicsCourseTerm).where(AcademicsCourseTerm.term_id == term.id))
    await ctx.db.delete(term)
    await ctx.db.flush()
    await events.publish(ctx, "academics.term.deleted", data)
    return TermDeleteResult(deleted_course_count=len(only), kept_course_count=len(kept))


async def week_start(ctx: Ctx) -> rules.WeekStart:
    """The user's first day of the week; 0 follows the language (zh: Monday, en: Sunday)."""
    return await _memoized(("week_start", ctx.user_id), lambda: _week_start(ctx))


async def _week_start(ctx: Ctx) -> rules.WeekStart:
    prefs = await settings_service.get_preferences(ctx)
    if prefs.week_start in (1, 7):
        return prefs.week_start  # pyright: ignore[reportReturnType]
    return 1 if (prefs.locale or ctx.locale).startswith("zh") else 7


def _spans(term: AcademicsTerm) -> list[rules.BreakSpan]:
    return [
        rules.BreakSpan(
            b["id"],
            b["name"],
            date.fromisoformat(b["start_date"]),
            date.fromisoformat(b["end_date"]),
        )
        for b in term.breaks
    ]


async def weeks_of(ctx: Ctx, term: AcademicsTerm) -> list[rules.Week]:
    return rules.term_weeks(
        term.start_date, term.end_date, _spans(term), term.count_break_weeks, await week_start(ctx)
    )


async def term_week_of(ctx: Ctx, term: AcademicsTerm, day: date) -> int | rules.BreakSpan | None:
    """Week number of `day` in the term (M02 §3), for other modules such as the schedule; None
    outside the term's own dates (its first and last calendar weeks reach past them)."""
    if not term.start_date <= day <= term.end_date:
        return None
    return rules.term_week_of(await weeks_of(ctx, term), day)


async def calendar_info(ctx: Ctx, term_id: str) -> CalendarInfo:
    term = await get_term_row(ctx, term_id)
    program = await get_program_row(ctx, term.program_id)
    start = await week_start(ctx)
    weeks = rules.term_weeks(
        term.start_date, term.end_date, _spans(term), term.count_break_weeks, start
    )
    today = program_today(ctx, program)
    today_week = next(
        (
            i
            for i, w in enumerate(weeks)
            if w.start_date <= today <= w.end_date and term.start_date <= today <= term.end_date
        ),
        None,
    )
    return CalendarInfo(
        term_id=term.id,
        timezone=program.timezone,
        week_start=start,
        weeks=[
            TermWeek(
                start_date=w.start_date,
                end_date=w.end_date,
                number=w.number,
                break_info=BreakRef(id=w.break_.id, name=w.break_.name) if w.break_ else None,
            )
            for w in weeks
        ],
        today=today,
        today_week=today_week,
    )


# --- courses --------------------------------------------------------------------------------


async def _validated_terms(
    ctx: Ctx, program_id: str, term_ids: Sequence[str], course_id: str | None = None
) -> list[str]:
    """The course's terms in chronological order, after checking the rules of M02 §2."""
    wanted = list(dict.fromkeys(term_ids))
    if not wanted:
        raise AppError("academics.course_requires_term", 422)
    rows = (
        await ctx.db.scalars(
            select(AcademicsTerm).where(
                AcademicsTerm.user_id == ctx.user_id, AcademicsTerm.id.in_(wanted)
            )
        )
    ).all()
    if len(rows) != len(wanted):
        raise not_found()
    if any(r.program_id != program_id for r in rows):
        raise AppError(
            "academics.course_terms_cross_program", 422, course_ids=[course_id] if course_id else []
        )
    order = [t.id for t in await program_terms(ctx, program_id)]
    if not rules.is_consecutive(order, wanted):
        raise AppError(
            "academics.course_terms_not_adjacent", 422, course_ids=[course_id] if course_id else []
        )
    return [t for t in order if t in set(wanted)]


async def create_course(
    ctx: Ctx, program: AcademicsProgram, fields: CourseFields, term_ids: Sequence[str]
) -> AcademicsCourse:
    ordered = await _validated_terms(ctx, program.id, term_ids)
    subject = (
        fields.subject_code.strip().upper()
        if fields.subject_code is not None
        else rules.parse_subject_code(fields.code)
    )
    ensure_subject_color(program, subject)
    course = AcademicsCourse(
        id=new_id(),
        user_id=ctx.user_id,
        program_id=program.id,
        code=(fields.code or "").strip() or None,
        title=fields.title.strip(),
        alias=(fields.alias or "").strip() or None,
        subject_code=subject,
        color=fields.color.model_dump(mode="json") if fields.color else None,
        credits=fields.credits if fields.credits is not None else program.default_course_credits,
        include_in_gpa=fields.include_in_gpa,
        instructors=[i.model_dump(mode="json") for i in fields.instructors],
        description=fields.description,
        website_url=fields.website_url,
        planned_terms=max(fields.planned_terms, len(ordered)),
        sort_order=0,
        created_at=ctx.now,
        updated_at=ctx.now,
    )
    ctx.db.add(course)
    await ctx.db.flush()
    ctx.db.add_all(
        AcademicsCourseTerm(course_id=course.id, term_id=t, user_id=ctx.user_id) for t in ordered
    )
    await ctx.db.flush()
    await events.publish(
        ctx,
        "academics.course.created",
        {"course_id": course.id, "program_id": program.id, "term_ids": ordered},
    )
    return course


async def create_courses(
    ctx: Ctx, program_id: str, items: Sequence[tuple[CourseFields, Sequence[str]]]
) -> list[Course]:
    program = await get_program_row(ctx, program_id)
    rows = [await create_course(ctx, program, fields, term_ids) for fields, term_ids in items]
    return await courses_out(ctx, program, rows)


def _default_key(c: AcademicsCourse) -> tuple[int, str, str, str]:
    """The one course order everywhere: sort_order, then code, then title."""
    return (c.sort_order, rules.normalize(c.code) or "~", rules.normalize(c.title), c.id)


async def _courses_in_term(ctx: Ctx, term_id: str) -> list[AcademicsCourse]:
    """The term's courses in the default order (the same everywhere they are listed)."""
    rows = (
        await ctx.db.scalars(
            select(AcademicsCourse)
            .join(AcademicsCourseTerm, AcademicsCourseTerm.course_id == AcademicsCourse.id)
            .where(
                AcademicsCourseTerm.user_id == ctx.user_id, AcademicsCourseTerm.term_id == term_id
            )
        )
    ).all()
    return sorted(rows, key=_default_key)


async def list_courses(ctx: Ctx, inp: CourseListInput) -> CoursePage:
    return await _memoized(
        ("courses", ctx.user_id, inp.model_dump_json()), lambda: _list_courses(ctx, inp)
    )


async def _list_courses(ctx: Ctx, inp: CourseListInput) -> CoursePage:
    program = await get_program_row(ctx, inp.program_id)
    if inp.term_id is not None:
        term = await get_term_row(ctx, inp.term_id)
        if term.program_id != program.id:
            raise not_found()
        rows = await _courses_in_term(ctx, term.id)
    else:
        rows = sorted(
            (
                await ctx.db.scalars(
                    select(AcademicsCourse).where(
                        AcademicsCourse.user_id == ctx.user_id,
                        AcademicsCourse.program_id == program.id,
                    )
                )
            ).all(),
            key=_default_key,
        )
    if inp.subject_code:
        rows = [r for r in rows if r.subject_code == inp.subject_code.strip().upper()]
    if inp.search:
        rows = [r for r in rows if rules.matches(inp.search, r.code, r.title, r.alias)]
    offset = int(inp.cursor) if inp.cursor and inp.cursor.isdigit() else 0
    page = rows[offset : offset + inp.limit]
    more = offset + inp.limit < len(rows)
    return CoursePage(
        items=await courses_out(ctx, program, page),
        next_cursor=str(offset + inp.limit) if more else None,
    )


async def find_courses(
    ctx: Ctx, query: str, program_id: str | None, limit: int
) -> CourseCandidates:
    program_id = program_id or (ctx.scope.program_id if ctx.scope else None)
    stmt = select(AcademicsCourse).where(AcademicsCourse.user_id == ctx.user_id)
    if program_id is not None:
        await get_program_row(ctx, program_id)
        stmt = stmt.where(AcademicsCourse.program_id == program_id)
    rows = (await ctx.db.scalars(stmt)).all()
    scored = [(rules.match_score(query, r.code, r.alias, r.title), r) for r in rows]
    best = sorted(
        ((s, r) for s, r in scored if s >= 0.35),
        key=lambda pair: (-pair[0], rules.normalize(pair[1].code), pair[1].id),
    )[:limit]
    links = await _links(ctx, [r.id for _, r in best])
    orders: dict[str, list[str]] = {}
    for _, r in best:
        if r.program_id not in orders:
            orders[r.program_id] = [t.id for t in await program_terms(ctx, r.program_id)]
    return CourseCandidates(
        items=[
            CourseCandidate(
                course_id=r.id,
                program_id=r.program_id,
                code=r.code,
                title=r.title,
                alias=r.alias,
                term_ids=[t for t in orders[r.program_id] if t in links.get(r.id, set())],
                score=s,
            )
            for s, r in best
        ]
    )


_NULLABLE_COURSE = {"code", "alias", "color", "description", "website_url"}


async def update_course(ctx: Ctx, inp: CourseUpdateInput) -> Course:
    course = await get_course_row(ctx, inp.course_id)
    program = await get_program_row(ctx, course.program_id)
    old_code = course.code
    sent = inp.model_fields_set
    if "code" in sent:
        inp.code = (inp.code or "").strip() or None
    if "title" in sent and inp.title is not None:
        inp.title = inp.title.strip()
    if "subject_code" in sent and inp.subject_code is not None:
        inp.subject_code = inp.subject_code.strip().upper()
    changed = _apply(course, inp, _NULLABLE_COURSE, exclude={"course_id"})
    # A subject that was parsed from the old code follows the new code.
    if (
        "code" in changed
        and "subject_code" not in sent
        and course.subject_code == rules.parse_subject_code(old_code)
    ):
        subject = rules.parse_subject_code(course.code)
        if subject != course.subject_code:
            course.subject_code = subject
            changed.append("subject_code")
    if "planned_terms" in changed:
        count = len((await _links(ctx, [course.id])).get(course.id, set()))
        course.planned_terms = max(course.planned_terms, count)
    if changed:
        ensure_subject_color(program, course.subject_code)
        course.updated_at = ctx.now
        await ctx.db.flush()
        await events.publish(
            ctx,
            "academics.course.updated",
            {"course_id": course.id, "program_id": course.program_id, "fields": sorted(changed)},
        )
    return (await courses_out(ctx, program, [course]))[0]


async def _link(ctx: Ctx, course: AcademicsCourse, added: set[str], removed: set[str]) -> None:
    if removed:
        await ctx.db.execute(
            delete(AcademicsCourseTerm).where(
                AcademicsCourseTerm.course_id == course.id,
                AcademicsCourseTerm.term_id.in_(removed),
            )
        )
    ctx.db.add_all(
        AcademicsCourseTerm(course_id=course.id, term_id=t, user_id=ctx.user_id) for t in added
    )
    await ctx.db.flush()
    order = [t.id for t in await program_terms(ctx, course.program_id)]
    linked = (await _links(ctx, [course.id])).get(course.id, set())
    if not rules.is_consecutive(order, linked):
        raise AppError("academics.course_terms_not_adjacent", 422, course_ids=[course.id])
    course.planned_terms = max(course.planned_terms, len(linked))
    course.updated_at = ctx.now
    await events.publish(
        ctx,
        "academics.course.terms_changed",
        {
            "course_id": course.id,
            "program_id": course.program_id,
            "term_ids": [t for t in order if t in linked],
            "added": [t for t in order if t in added],
            "removed": sorted(removed),
        },
    )


async def set_course_terms(ctx: Ctx, course_id: str, term_ids: Sequence[str]) -> Course:
    course = await get_course_row(ctx, course_id)
    wanted = set(await _validated_terms(ctx, course.program_id, term_ids, course.id))
    current = (await _links(ctx, [course.id])).get(course.id, set())
    if wanted != current:
        await _link(ctx, course, wanted - current, current - wanted)
    return await course_out(ctx, course)


async def delete_course(ctx: Ctx, course_id: str) -> None:
    course = await get_course_row(ctx, course_id)
    order = [t.id for t in await program_terms(ctx, course.program_id)]
    links = await _links(ctx, [course.id])
    await _announce_course_deleting(ctx, course.id, course.program_id, links.get(course.id), order)
    await ctx.db.delete(course)
    await ctx.db.flush()
