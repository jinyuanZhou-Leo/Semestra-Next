"""The assistant's confirmation cards for LMS writes (M12 §3.5): which course on the LMS, which
assignments, which connection, by name.

Names come from the 5-minute read cache that the assistant's own reads filled
(`lms.course.list`, `lms.assignment.list`). When the LMS cannot be reached the card shows
fewer details; the write itself still checks everything when it runs.
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


async def external_course_labels(ctx: Ctx, program_id: str, ids: list[str]) -> dict[str, str]:
    """Courses on the Program's LMS as "code · name · term", current ones first (the listing the
    assistant most likely read), then past ones for the ids still missing."""
    out: dict[str, str] = {}
    for include_past in (False, True):
        with suppress(AppError):
            listing = await service.external_courses(ctx, program_id, include_past=include_past)
            for c in listing.items:
                if c.external_id in ids:
                    out[c.external_id] = _external(c.code, c.name, c.term)
        if all(i in out for i in ids):
            break
    return out


def _listed(field: str, names: list[str]) -> dict[str, Any]:
    return {"field": field, "after": names[:SHOWN], "count": len(names)}


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
    found = await external_course_labels(ctx, inp.program_id, ids)
    names = [found[i] for i in ids if i in found]
    target = program.name
    if inp.term_id is not None:
        with suppress(AppError):
            target = f"{(await academics.get_term_row(ctx, inp.term_id)).name} · {program.name}"
    return {"target": target, "changes": [_listed("lms_courses", names)] if names else []}


async def preview_assignment_import(ctx: Ctx, inp: AssignmentsImportInput) -> dict[str, Any]:
    target = await _course(ctx, inp.course_id)
    changes: list[dict[str, Any]] = []
    with suppress(AppError):
        data, _ = await reads.raw_assignments(ctx, inp.course_id, refresh=False)
        by_id = {str(a["external_id"]): str(a["name"]) for a in data}
        names = [by_id[i] for i in dict.fromkeys(inp.external_ids) if i in by_id]
        if names:
            changes.append(_listed("lms_assignments", names))
    changes.append({"field": "as_kind", "after": inp.as_kind})
    linked = await _linked(ctx, inp.course_id)
    return {"target": f"{target} · {linked}" if linked else target, "changes": changes}


async def preview_file_save(ctx: Ctx, inp: FileSaveInput) -> dict[str, Any]:
    from semestra.modules.files import service as files

    changes: list[dict[str, Any]] = []
    with suppress(AppError):
        meta = await reads.file(ctx, inp.course_id, inp.file_id, refresh=False)
        changes.append({"field": "lms_file", "after": meta.name})
    folder = None
    if inp.folder_id is not None:
        with suppress(AppError):
            folder = (await files.get_folder(ctx, inp.folder_id)).name
    changes.append({"field": "folder", "after": folder})
    return {"target": await _course(ctx, inp.course_id), "changes": changes}


async def preview_apply_updates(ctx: Ctx, inp: CourseRef) -> dict[str, Any]:
    changes: list[dict[str, Any]] = []
    with suppress(AppError):
        updates = await imports.check_updates(ctx, inp.course_id)
        changes.append(_listed("lms_updates", [u.name for u in updates.items]))
    return {"target": await _course(ctx, inp.course_id), "changes": changes}
