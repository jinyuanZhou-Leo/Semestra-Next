"""Class sections of a course in a term (LEC0101): type, code, instructor and the weeks that all of
the section's weekly times run in (M04 §2)."""

from collections import Counter
from collections.abc import Sequence
from typing import Any

from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.db import new_id
from semestra.core.errors import AppError, not_found
from semestra.modules.academics import service as academics
from semestra.modules.academics.schemas import Course
from semestra.modules.schedule.event_types import check_type_code, type_rows
from semestra.modules.schedule.meetings import (
    announce_sections,
    check_meeting,
    check_section_weeks,
    course_with_term,
    delete_meetings,
    delete_sections,
    drop_stale_exceptions,
    meetings_of,
    new_meeting_row,
    section_label,
    section_row,
    sections_out,
)
from semestra.modules.schedule.models import ScheduleMeeting, ScheduleSection
from semestra.modules.schedule.schemas import (
    NewSection,
    Section,
    SectionCreateManyResult,
    SectionRef,
    SectionSaveInput,
    SectionUpdateInput,
    SectionWeeks,
)

_WEEK_FIELDS = ("recurrence", "anchor_week", "start_week", "end_week", "skip_breaks")
# Fields whose change moves the section's dates.
_DATE_FIELDS = {"term_id", *_WEEK_FIELDS}


async def _sorted(ctx: Ctx, program_id: str, rows: Sequence[ScheduleSection]) -> list[Section]:
    """By term, then the Program's type order, then section code."""
    terms = {t.id: i for i, t in enumerate(await academics.program_terms(ctx, program_id))}
    types = {t.code: t.position for t in await type_rows(ctx, program_id)}
    ordered = sorted(
        rows,
        key=lambda r: (
            terms.get(r.term_id, len(terms)),
            types.get(r.type_code, len(types)),
            r.type_code,
            r.section_code,
            r.created_at,
        ),
    )
    return await sections_out(ctx, ordered)


async def list_sections(ctx: Ctx, course_id: str, term_id: str | None) -> list[Section]:
    course = await academics.get_course_row(ctx, course_id)
    q = select(ScheduleSection).where(
        ScheduleSection.user_id == ctx.user_id, ScheduleSection.course_id == course.id
    )
    if term_id is not None:
        q = q.where(ScheduleSection.term_id == term_id)
    return await _sorted(ctx, course.program_id, (await ctx.db.scalars(q)).all())


async def list_term_sections(ctx: Ctx, term_id: str) -> list[Section]:
    """Every section of the term's courses (the term timetable)."""
    term = await academics.get_term_row(ctx, term_id)
    rows = (
        await ctx.db.scalars(
            select(ScheduleSection).where(
                ScheduleSection.user_id == ctx.user_id, ScheduleSection.term_id == term.id
            )
        )
    ).all()
    return await _sorted(ctx, term.program_id, rows)


def _weeks_values(weeks: SectionWeeks) -> dict[str, Any]:
    values = weeks.model_dump()
    if values["anchor_week"] is None or values["recurrence"] == "weekly":
        values["anchor_week"] = values["start_week"]
    if values["end_week"] is not None and values["end_week"] < values["start_week"]:
        raise AppError("schedule.week_range_invalid", 422)
    return values


def _apply_weeks(row: ScheduleSection, weeks: SectionWeeks) -> list[str]:
    """Sets the weeks; returns the fields that changed."""
    values = _weeks_values(weeks)
    changed = [k for k, v in values.items() if getattr(row, k) != v]
    for key in changed:
        setattr(row, key, values[key])
    check_section_weeks(row)
    return changed


async def _new_section(ctx: Ctx, course_id: str, **values: Any) -> ScheduleSection:
    """A new section, written at once: its meetings point at it."""
    row = ScheduleSection(
        id=new_id(),
        user_id=ctx.user_id,
        course_id=course_id,
        created_at=ctx.now,
        updated_at=ctx.now,
        **values,
    )
    ctx.db.add(row)
    await ctx.db.flush()
    return row


async def _check_code_free(
    ctx: Ctx, course_id: str, term_id: str, type_code: str, code: str, own_id: str | None
) -> None:
    """A section code names one section of the course in a term."""
    if not code:
        return
    with ctx.db.no_autoflush:  # the edited row may already hold the taken code
        other = await ctx.db.scalar(
            select(ScheduleSection.id).where(
                ScheduleSection.user_id == ctx.user_id,
                ScheduleSection.course_id == course_id,
                ScheduleSection.term_id == term_id,
                ScheduleSection.type_code == type_code,
                ScheduleSection.section_code == code,
                ScheduleSection.id != (own_id or ""),
            )
        )
    if other is not None:
        raise AppError("schedule.section_exists", 409, section_code=code)


def _weeks_key(values: dict[str, Any]) -> tuple[Any, ...]:
    """Weeks compared as the classes they give (a weekly section has no anchor week)."""
    return tuple(
        None if k == "anchor_week" and values["recurrence"] != "biweekly" else values[k]
        for k in _WEEK_FIELDS
    )


def _same_weeks(row: ScheduleSection, values: dict[str, Any]) -> bool:
    return _weeks_key({k: getattr(row, k) for k in _WEEK_FIELDS}) == _weeks_key(values)


def _code_of(row: ScheduleSection) -> tuple[str, str, str, str, str]:
    return row.course_id, row.term_id, row.type_code, row.section_code, row.id


async def _course_section(ctx: Ctx, course: Course, section_id: str) -> ScheduleSection:
    row = await section_row(ctx, section_id)
    if row.course_id != course.id:
        raise not_found("section", section_id)
    return row


async def create_sections(
    ctx: Ctx, course_id: str, items: Sequence[NewSection]
) -> SectionCreateManyResult:
    """Sections with their times (see `SectionCreateManyInput`)."""
    course = await academics.course_out(ctx, await academics.get_course_row(ctx, course_id))
    types = {t.code for t in await type_rows(ctx, course.program_id)}
    rows = (
        await ctx.db.scalars(
            select(ScheduleSection).where(
                ScheduleSection.user_id == ctx.user_id, ScheduleSection.course_id == course.id
            )
        )
    ).all()
    by_id = {r.id: r for r in rows}
    by_code = {(r.term_id, r.type_code, r.section_code): r for r in rows if r.section_code}
    by_source = {
        (m.source_kind, m.source_ref): m
        for m in (
            await ctx.db.scalars(
                select(ScheduleMeeting).where(
                    ScheduleMeeting.user_id == ctx.user_id,
                    ScheduleMeeting.section_id.in_(list(by_id)),
                    ScheduleMeeting.source_ref.is_not(None),
                )
            )
        ).all()
    }
    members = {sid: {m.id for m in ms} for sid, ms in (await meetings_of(ctx, list(by_id))).items()}
    written: dict[str, ScheduleSection] = {}
    new_sections: list[str] = []
    stale: dict[str, set[str]] = {}  # section id -> meetings whose dates may have moved
    created: list[str] = []
    updated: list[str] = []
    left: set[str] = set()  # sections a moved meeting left

    def fits(section: ScheduleSection, weeks: dict[str, Any] | None, known: set[str]) -> bool:
        """The times can go into the section: same weeks, or they are all of its times (a
        repeated import of the whole section, whose weeks then change)."""
        return weeks is None or _same_weeks(section, weeks) or members[section.id] <= known

    def matched(item: NewSection) -> set[str]:
        return {
            by_source[(nm.source_kind, nm.source_ref)].id
            for nm in item.meetings
            if nm.source_ref is not None and (nm.source_kind, nm.source_ref) in by_source
        }

    # One reference names one time: two in a call would silently write one over the other.
    refs = Counter(
        (nm.source_kind, nm.source_ref)
        for item in items
        for nm in item.meetings
        if nm.source_ref is not None
    )
    if duplicate := next((ref for ref, n in refs.items() if n > 1), None):
        raise AppError("schedule.duplicate_source_ref", 422, source_ref=duplicate[1])

    # Times sent in this call for one code with the same weeks count together, so a repeated
    # import of a whole section can send each of its times as its own item.
    together: dict[tuple[Any, ...], set[str]] = {}
    for item in items:
        if item.weeks is not None and item.section_code:
            key = (item.term_id, item.type_code, item.section_code)
            key += _weeks_key(_weeks_values(item.weeks))
            together.setdefault(key, set()).update(matched(item))

    for i, item in enumerate(items):
        if item.term_id not in course.term_ids:
            raise AppError("schedule.term_not_in_course", 422, index=i)
        if item.type_code not in types:
            raise AppError(
                "common.validation",
                422,
                errors=[{"loc": ["sections", i, "type_code"], "code": "unknown_type"}],
            )
        weeks = _weeks_values(item.weeks) if item.weeks is not None else None
        known = matched(item)
        if weeks is not None and item.section_code:
            known |= together[(item.term_id, item.type_code, item.section_code, *_weeks_key(weeks))]
        # A section code names one set of weeks: times of that code that run in other weeks
        # are a section of their own, without the code (it stays on them as their title), so
        # neither the section's other times nor these change their classes (M04 §9).
        code = item.section_code
        section = by_code.get((item.term_id, item.type_code, code)) if code else None
        if section is not None and not fits(section, weeks, known):
            section, code = None, ""
        if section is None and not code:
            # A section without a code is found again by its imported times.
            section = next(
                (
                    by_id[sid]
                    for sid in dict.fromkeys(
                        m.section_id for m in by_source.values() if m.id in known
                    )
                    if (by_id[sid].term_id, by_id[sid].type_code, by_id[sid].section_code)
                    == (item.term_id, item.type_code, "")
                    and fits(by_id[sid], weeks, known)
                ),
                None,
            )
        if section is None:
            section = await _new_section(
                ctx,
                course.id,
                **item.model_dump(include={"term_id", "type_code", "instructor"}),
                section_code=code,
                **(weeks or _weeks_values(SectionWeeks())),
            )
            by_id[section.id] = section
            members[section.id] = set()
            if code:
                by_code[(item.term_id, item.type_code, code)] = section
            new_sections.append(section.id)
        else:
            if "instructor" in item.model_fields_set and section.instructor != item.instructor:
                section.instructor = item.instructor
                section.updated_at = ctx.now
            if item.weeks is not None and _apply_weeks(section, item.weeks):
                section.updated_at = ctx.now
                stale.setdefault(section.id, set()).add("*")
        written[section.id] = section
        for nm in item.meetings:
            values = nm.model_dump(exclude={"enabled"})
            if code != item.section_code and not values["title"]:
                values["title"] = item.section_code
            row = by_source.get((nm.source_kind, nm.source_ref)) if nm.source_ref else None
            if row is None:
                row = new_meeting_row(ctx, section, **values, enabled=nm.enabled)
                members[section.id].add(row.id)
                if nm.source_ref is not None:
                    by_source[(nm.source_kind, nm.source_ref)] = row
                created.append(row.id)
                continue
            # A repeated import changes what the importer sent; whether the user shows the time
            # stays theirs unless the importer says otherwise.
            if "enabled" in nm.model_fields_set:
                values["enabled"] = nm.enabled
            if row.section_id != section.id:
                left.add(row.section_id)
                members[row.section_id].discard(row.id)
                members[section.id].add(row.id)
                values["section_id"] = section.id
            changed = [k for k, v in values.items() if getattr(row, k) != v]
            for k in changed:
                setattr(row, k, values[k])
            check_meeting(row)
            if changed:
                row.updated_at = ctx.now
                stale.setdefault(section.id, set()).add(row.id)
            if row.id not in created and row.id not in updated:
                updated.append(row.id)
    await ctx.db.flush()
    meetings = await meetings_of(ctx, [*written, *left])
    for section_id, ids in stale.items():
        own = meetings[section_id]
        await drop_stale_exceptions(
            ctx, written[section_id], own if "*" in ids else [m for m in own if m.id in ids]
        )
    emptied = [s for s in left - set(written) if not meetings[s]]
    await delete_sections(ctx, emptied)
    await ctx.db.flush()
    await announce_sections(
        ctx,
        course,
        created=new_sections,
        updated=[
            s
            for s in dict.fromkeys([*written, *left])
            if s not in new_sections and s not in emptied
        ],
        deleted=emptied,
    )
    return SectionCreateManyResult(
        items=await sections_out(ctx, list(written.values())),
        created_ids=created,
        updated_ids=updated,
    )


_NULLABLE_SECTION = {"instructor", "end_week"}


async def update_section(ctx: Ctx, inp: SectionUpdateInput) -> Section:
    row = await section_row(ctx, inp.section_id)
    sent = inp.model_fields_set - {"section_id"}
    if "anchor_week" in sent and inp.anchor_week is None:
        # As on create: no anchor means the first week (weekly sections ignore it).
        inp = inp.model_copy(update={"anchor_week": inp.start_week or row.start_week})
    bad = sorted(f for f in sent if getattr(inp, f) is None and f not in _NULLABLE_SECTION)
    if bad:
        raise AppError(
            "common.validation", 422, errors=[{"loc": [f], "code": "none_not_allowed"} for f in bad]
        )
    course = await course_with_term(ctx, row.course_id, inp.term_id or row.term_id)
    if "type_code" in sent:
        await check_type_code(ctx, course.program_id, inp.type_code)
    changed = sorted(f for f in sent if getattr(row, f) != getattr(inp, f))
    for field in changed:
        setattr(row, field, getattr(inp, field))
    if "start_week" in changed and "anchor_week" not in sent and row.recurrence == "biweekly":
        row.anchor_week = max(row.anchor_week, row.start_week)
    check_section_weeks(row)
    await _check_code_free(ctx, *_code_of(row))
    if changed:
        if _DATE_FIELDS & set(changed):
            await drop_stale_exceptions(ctx, row, (await meetings_of(ctx, [row.id]))[row.id])
        row.updated_at = ctx.now
        await ctx.db.flush()
        await announce_sections(ctx, course, updated=[row.id])
    return (await sections_out(ctx, [row]))[0]


async def delete_section(ctx: Ctx, section_id: str) -> None:
    row = await section_row(ctx, section_id)
    course = await academics.get_course_row(ctx, row.course_id)
    await delete_sections(ctx, [row.id])
    await ctx.db.flush()
    await announce_sections(ctx, course, deleted=[row.id])


async def preview_section_delete(ctx: Ctx, inp: SectionRef) -> dict[str, Any]:
    row = await section_row(ctx, inp.section_id)
    return {"target": await section_label(ctx, row), "changes": []}


async def save_section(ctx: Ctx, inp: SectionSaveInput) -> Section:
    """One transaction for a section edited as a whole (see `SectionSaveInput`)."""
    course = await course_with_term(ctx, inp.course_id, inp.term_id)
    await check_type_code(ctx, course.program_id, inp.type_code)
    fields = inp.model_dump(include={"term_id", "type_code", "section_code", "instructor"})
    if inp.section_id is None:
        await _check_code_free(
            ctx, course.id, inp.term_id, inp.type_code, inp.section_code, own_id=None
        )
        row = await _new_section(ctx, course.id, **fields, **_weeks_values(inp.weeks))
        changed = list(fields)
        existing: list[ScheduleMeeting] = []
    else:
        row = await _course_section(ctx, course, inp.section_id)
        changed = [k for k, v in fields.items() if getattr(row, k) != v]
        for key in changed:
            setattr(row, key, fields[key])
        existing = (await meetings_of(ctx, [row.id]))[row.id]
    changed += _apply_weeks(row, inp.weeks)
    await _check_code_free(ctx, *_code_of(row))
    by_id = {m.id: m for m in existing}
    # New times are off when the whole section is.
    enabled = not existing or any(m.enabled for m in existing)
    kept: list[ScheduleMeeting] = []
    moved: list[ScheduleMeeting] = []
    for t in inp.times:
        values = t.model_dump(exclude={"meeting_id"})
        if t.meeting_id is None:
            kept.append(new_meeting_row(ctx, row, **values, enabled=enabled))
            changed.append("times")
            continue
        meeting = by_id.get(t.meeting_id)
        if meeting is None:
            raise not_found("meeting", t.meeting_id)
        diff = [k for k, v in values.items() if getattr(meeting, k) != v]
        for key in diff:
            setattr(meeting, key, values[key])
        check_meeting(meeting)
        if diff:
            meeting.updated_at = ctx.now
            changed.append("times")
        if "weekday" in diff:
            moved.append(meeting)
        kept.append(meeting)
    keep_ids = {m.id for m in kept}
    removed = [m.id for m in existing if m.id not in keep_ids]
    if removed:
        changed.append("times")
    await delete_meetings(ctx, removed)
    if inp.section_id is not None:
        stale = [m for m in kept if m.id in by_id]
        await drop_stale_exceptions(ctx, row, stale if _DATE_FIELDS & set(changed) else moved)
    if changed:
        row.updated_at = ctx.now
    await ctx.db.flush()
    if inp.section_id is None:
        await announce_sections(ctx, course, created=[row.id])
    elif changed:
        await announce_sections(ctx, course, updated=[row.id])
    return (await sections_out(ctx, [row]))[0]
