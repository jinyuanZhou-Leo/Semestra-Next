"""The storage course files use (M07 §5): the module's share of the user's quota and its
breakdown by course and file type."""

from sqlalchemy import func, select

from semestra.core.context import Ctx
from semestra.core.storage import storage_usage_provider
from semestra.core.storage import usage as core_usage
from semestra.modules.academics import service as academics
from semestra.modules.files import service
from semestra.modules.files.models import FilesIndexState, FilesItem
from semestra.modules.files.schemas import (
    CourseUsage,
    FilesUsageBreakdown,
    FilesUsageGet,
    FileType,
    TypeUsage,
)


@storage_usage_provider("files")
async def files_usage_bytes(ctx: Ctx) -> int:
    total = await ctx.db.scalar(
        select(func.coalesce(func.sum(FilesItem.size_bytes), 0)).where(
            FilesItem.user_id == ctx.user_id,
            FilesItem.kind == "file",
            FilesItem.storage_key.is_not(None),
        )
    )
    return int(total or 0)


async def usage(ctx: Ctx) -> FilesUsageGet:

    total = await core_usage(ctx)
    return FilesUsageGet(
        used_bytes=total.used_bytes,
        files_bytes=total.by_module.get("files", 0),
        quota_bytes=total.quota_bytes,
        max_upload_bytes=ctx.settings.files_max_upload_bytes,
        vector_files=await ctx.db.scalar(
            select(func.count())
            .select_from(FilesIndexState)
            .where(
                FilesIndexState.user_id == ctx.user_id,
                FilesIndexState.vector_document_id.is_not(None),
            )
        )
        or 0,
    )


async def usage_breakdown(ctx: Ctx) -> FilesUsageBreakdown:
    rows = (
        await ctx.db.execute(
            select(
                FilesItem.course_id,
                FilesItem.mime_type,
                func.count(),
                func.coalesce(func.sum(FilesItem.size_bytes), 0),
            )
            .where(
                FilesItem.user_id == ctx.user_id,
                FilesItem.kind == "file",
                FilesItem.storage_key.is_not(None),
            )
            .group_by(FilesItem.course_id, FilesItem.mime_type)
        )
    ).all()
    per_course: dict[str, list[int]] = {}
    per_type: dict[FileType, list[int]] = {}
    for course_id, mime, files, size in rows:
        for totals in (
            per_course.setdefault(course_id, [0, 0]),
            per_type.setdefault(service.file_type(mime), [0, 0]),
        ):
            totals[0] += files
            totals[1] += size
    by_course: list[CourseUsage] = []
    courses = await academics.courses_by_id(ctx, list(per_course))
    for program_id in sorted({c.program_id for c in courses}):
        program = await academics.get_program_row(ctx, program_id)
        own = [c for c in courses if c.program_id == program_id]
        for course in await academics.courses_out(ctx, program, own):
            files, size = per_course[course.id]
            by_course.append(
                CourseUsage(
                    course_id=course.id,
                    program_id=program_id,
                    program_name=program.name,
                    name=course.alias or course.code or course.title,
                    color=course.resolved_color,
                    files=files,
                    bytes=size,
                )
            )
    return FilesUsageBreakdown(
        by_course=sorted(by_course, key=lambda c: (-c.bytes, c.name)),
        by_type=sorted(
            (TypeUsage(type=t, files=f, bytes=b) for t, (f, b) in per_type.items()),
            key=lambda t: -t.bytes,
        ),
    )
