"""The assistant's confirmation cards for LMS writes (M12 §3.5): which course on the LMS, which
assignments, which connection, by name.

Names come only from the 5-minute read cache that the assistant's own reads filled
(`lms.course.list`, `lms.assignment.list`): a card never waits on the platform. On a miss the
card says how many instead of which; the write itself still checks everything when it runs.
Imports count what they will actually create (`imports.new_courses` / `new_assignments`).
"""

from contextlib import suppress
from typing import Any

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules.academics import service as academics
from semestra.modules.lms import imports, reads, service
from semestra.modules.lms.schemas.io import (
    AssignmentsImportInput,
    BindingSetInput,
    CourseRef,
    CoursesImportInput,
    ExternalCourse,
    FileSaveInput,
    LinkSetInput,
    LinkUpdateInput,
    ProgramRef,
)

# Lists on a card show this many names; `count` says how many there are in all.
SHOWN = 10


def _external(code: str | None, name: str | None, term: str | None) -> str:
    return " · ".join(p for p in (code, name, term) if p)


async def _course(ctx: Ctx, course_id: str) -> str:
    row = await academics.get_course_row(ctx, course_id)
    return f"{row.code} {row.title}" if row.code else row.title


async def _cached_courses(ctx: Ctx, program_id: str) -> tuple[dict[str, ExternalCourse], bool]:
    """The Program's LMS courses the cache holds, and whether that is all of them (the listing
    with past courses, which an import reads) or only the current ones."""
    for include_past in (True, False):
        with suppress(AppError, service.NotCached), service.cache_only():
            listing = await service.external_courses(ctx, program_id, include_past=include_past)
            return {c.external_id: c for c in listing.items}, include_past
    return {}, False


async def external_course_labels(ctx: Ctx, program_id: str, ids: list[str]) -> dict[str, str]:
    """Courses on the Program's LMS as "code · name · term"."""
    listed, _ = await _cached_courses(ctx, program_id)
    return {i: _external(c.code, c.name, c.term) for i in ids if (c := listed.get(i))}


async def _cached_assignments(ctx: Ctx, course_id: str) -> dict[str, dict[str, Any]] | None:
    with suppress(AppError, service.NotCached), service.cache_only():
        data, _ = await reads.raw_assignments(ctx, course_id, refresh=False)
        return {str(a["external_id"]): a for a in data}
    return None


async def assignment_labels(ctx: Ctx, course_id: str, ids: list[str]) -> dict[str, str]:
    listed = await _cached_assignments(ctx, course_id) or {}
    return {i: str(listed[i]["name"]) for i in ids if i in listed}


async def _file_name(ctx: Ctx, course_id: str, file_id: str) -> str | None:
    with suppress(AppError, service.NotCached), service.cache_only():
        return (await reads.file(ctx, course_id, file_id, refresh=False)).name
    return None


async def file_labels(ctx: Ctx, course_id: str, ids: list[str]) -> dict[str, str]:
    return {i: name for i in ids if (name := await _file_name(ctx, course_id, i)) is not None}


def _counted(field: str, names: list[str], total: int) -> dict[str, Any]:
    """The first names and how many in all; just the number when no name could be read."""
    if not names:
        return {"field": field, "after": total}
    return {"field": field, "after": names[:SHOWN], "count": total}


async def _connection(ctx: Ctx, connection_id: str | None) -> str | None:
    if connection_id is None:
        return None
    with suppress(AppError):
        return (await service.get_connection_row(ctx, connection_id)).display_name
    return None


async def _linked(ctx: Ctx, course_id: str) -> str | None:
    link = await service.link_row(ctx, course_id)
    if link is None:
        return None
    return _external(link.external_code, link.external_name, link.external_term) or None


async def preview_link_set(ctx: Ctx, inp: LinkSetInput) -> dict[str, Any]:
    course = await academics.get_course_row(ctx, inp.course_id)
    found = await external_course_labels(ctx, course.program_id, [inp.external_course_id])
    changes: list[dict[str, Any]] = []
    after = found.get(inp.external_course_id)
    if after is not None:
        change: dict[str, Any] = {"field": "lms_course", "after": after}
        before = await _linked(ctx, inp.course_id)
        if before is not None and before != after:
            change["before"] = before
        changes.append(change)
    binding = await service.binding_row(ctx, course.program_id)
    if connection := await _connection(ctx, binding.connection_id if binding else None):
        changes.append({"field": "connection", "after": connection})
    changes.append({"field": "sync_enabled", "after": inp.sync_enabled})
    return {"target": await _course(ctx, inp.course_id), "changes": changes}


async def preview_link_update(ctx: Ctx, inp: LinkUpdateInput) -> dict[str, Any]:
    link = await service.link_row(ctx, inp.course_id)
    change: dict[str, Any] = {"field": "sync_enabled", "after": inp.sync_enabled}
    if link is not None:
        change["before"] = link.sync_enabled
    target = " · ".join(
        p for p in (await _course(ctx, inp.course_id), await _linked(ctx, inp.course_id)) if p
    )
    return {"target": target, "changes": [change]}


async def preview_link_delete(ctx: Ctx, inp: CourseRef) -> dict[str, Any]:
    changes: list[dict[str, Any]] = []
    if (before := await _linked(ctx, inp.course_id)) is not None:
        changes.append({"field": "lms_course", "before": before, "after": None})
    return {"target": await _course(ctx, inp.course_id), "changes": changes}


async def preview_binding_set(ctx: Ctx, inp: BindingSetInput) -> dict[str, Any]:
    program = await academics.get_program_row(ctx, inp.program_id)
    binding = await service.binding_row(ctx, inp.program_id)
    change: dict[str, Any] = {
        "field": "connection",
        "after": await _connection(ctx, inp.connection_id),
    }
    if binding is not None and binding.connection_id != inp.connection_id:
        change["before"] = await _connection(ctx, binding.connection_id)
    return {"target": program.name, "changes": [change]}


async def preview_binding_clear(ctx: Ctx, inp: ProgramRef) -> dict[str, Any]:
    program = await academics.get_program_row(ctx, inp.program_id)
    binding = await service.binding_row(ctx, inp.program_id)
    changes: list[dict[str, Any]] = []
    if binding is not None:
        before = await _connection(ctx, binding.connection_id)
        changes.append({"field": "connection", "before": before, "after": None})
    return {"target": program.name, "changes": changes}


async def preview_course_import(ctx: Ctx, inp: CoursesImportInput) -> dict[str, Any]:
    program = await academics.get_program_row(ctx, inp.program_id)
    ids = list(dict.fromkeys(inp.external_course_ids))
    listed, complete = await _cached_courses(ctx, inp.program_id)
    names = [_external(c.code, c.name, c.term) for c in imports.new_courses(listed, ids)]
    # Courses missing from a listing of current ones only may be past ones: counted, unnamed.
    unknown = 0 if complete else sum(1 for i in ids if i not in listed)
    target = program.name
    if inp.term_id is not None:
        with suppress(AppError):
            target = f"{(await academics.get_term_row(ctx, inp.term_id)).name} · {program.name}"
    return {"target": target, "changes": [_counted("lms_courses", names, len(names) + unknown)]}


async def preview_assignment_import(ctx: Ctx, inp: AssignmentsImportInput) -> dict[str, Any]:
    target = await _course(ctx, inp.course_id)
    link = await service.link_row(ctx, inp.course_id)
    done = await reads.imported_targets(ctx, link.id) if link is not None else {}
    ids = list(dict.fromkeys(inp.external_ids))
    listed = await _cached_assignments(ctx, inp.course_id)
    if listed is None:
        names, total = [], sum(1 for i in ids if i not in done)
    else:
        names = [str(a["name"]) for a in imports.new_assignments(listed, ids, done)]
        total = len(names)
    return {
        "target": target,
        "changes": [
            _counted("lms_assignments", names, total),
            {"field": "as_kind", "after": inp.as_kind},
        ],
    }


async def preview_file_save(ctx: Ctx, inp: FileSaveInput) -> dict[str, Any]:
    from semestra.modules.files import service as files

    changes: list[dict[str, Any]] = []
    if (name := await _file_name(ctx, inp.course_id, inp.file_id)) is not None:
        changes.append({"field": "lms_file", "after": name})
    folder = None
    if inp.folder_id is not None:
        with suppress(AppError):
            folder = (await files.get_folder(ctx, inp.folder_id)).name
    changes.append({"field": "folder", "after": folder})
    return {"target": await _course(ctx, inp.course_id), "changes": changes}


async def preview_apply_updates(ctx: Ctx, inp: CourseRef) -> dict[str, Any]:
    changes: list[dict[str, Any]] = []
    with suppress(AppError, service.NotCached), service.cache_only():
        updates = await imports.check_updates(ctx, inp.course_id)
        names = [u.name for u in updates.items]
        changes.append(_counted("lms_updates", names, len(names)))
    return {"target": await _course(ctx, inp.course_id), "changes": changes}
