"""Names of LMS connections and of what is on the LMS, for the assistant's chat (`core.labels`).
LMS items are named from the cached lists (`lms.course.list`, `lms.assignment.list`, ...)."""

from typing import Any

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.core.labels import owned_names, resolver
from semestra.modules.academics import service as academics
from semestra.modules.lms import previews
from semestra.modules.lms.models import LmsConnection

resolver("connection", module="lms")(owned_names(LmsConnection, lambda row: row.display_name))


async def _program(ctx: Ctx, args: dict[str, Any]) -> str | None:
    program_id = args.get("program_id")
    if isinstance(program_id, str):
        return program_id
    course_id = args.get("course_id")
    if isinstance(course_id, str):
        try:
            return (await academics.get_course_row(ctx, course_id)).program_id
        except AppError:
            return None
    return None


@resolver("external_course", module="lms")
async def external_course(ctx: Ctx, ids: list[str], args: dict[str, Any]) -> dict[str, str]:
    program_id = await _program(ctx, args)
    if program_id is None:
        return {}
    return await previews.external_course_labels(ctx, program_id, ids)


@resolver("external", module="lms.assignment")
async def assignment(ctx: Ctx, ids: list[str], args: dict[str, Any]) -> dict[str, str]:
    course_id = args.get("course_id")
    if not isinstance(course_id, str):
        return {}
    return await previews.assignment_labels(ctx, course_id, ids)


@resolver("file", module="lms")
async def file(ctx: Ctx, ids: list[str], args: dict[str, Any]) -> dict[str, str]:
    course_id = args.get("course_id")
    if not isinstance(course_id, str):
        return {}
    return await previews.file_labels(ctx, course_id, ids)
