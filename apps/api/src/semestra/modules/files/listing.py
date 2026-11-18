"""Listing course files (M07 §4): a course's folders and items, pinned files and file names
across a Program."""

from sqlalchemy import func, select

from semestra.core.context import Ctx
from semestra.core.errors import not_found
from semestra.modules.academics import service as academics
from semestra.modules.files import folders, service
from semestra.modules.files.models import FilesItem
from semestra.modules.files.schemas import (
    FileMatch,
    FileSearchInput,
    FilesItemList,
    FilesItemListInput,
    ItemOut,
)


async def list_files(ctx: Ctx, inp: FilesItemListInput) -> FilesItemList:
    await academics.get_course_row(ctx, inp.course_id)
    all_folders = await folders.course_folders(ctx, inp.course_id)
    if inp.folder_id is not None and inp.folder_id not in {f.id for f in all_folders}:
        raise not_found()
    stmt = select(FilesItem).where(
        FilesItem.user_id == ctx.user_id, FilesItem.course_id == inp.course_id
    )
    if not inp.recursive:
        stmt = stmt.where(
            FilesItem.folder_id == inp.folder_id
            if inp.folder_id is not None
            else FilesItem.folder_id.is_(None)
        )
    if inp.search:
        needle = inp.search.strip().lower().replace("\\", "\\\\").replace("%", "\\%")
        stmt = stmt.where(
            func.lower(FilesItem.display_name).like(f"%{needle.replace('_', '\\_')}%", escape="\\")
        )
    name = func.lower(FilesItem.display_name)
    key = {
        "name": name,
        "size": FilesItem.size_bytes,
        "updated": func.coalesce(FilesItem.source_modified_at, FilesItem.updated_at),
        "created": FilesItem.created_at,
        "type": func.coalesce(FilesItem.mime_type, "~"),
    }[inp.sort]
    stmt = stmt.order_by(key.desc() if inp.descending else key, name, FilesItem.id)
    offset = int(inp.cursor) if inp.cursor and inp.cursor.isdigit() else 0
    rows = list((await ctx.db.scalars(stmt.offset(offset).limit(inp.limit + 1))).all())
    more = len(rows) > inp.limit
    counts = await folders.folder_counts(ctx, inp.course_id)
    sources = await folders.source_names(ctx, inp.course_id)
    return FilesItemList(
        folders=[folders.folder_out(f, counts, sources) for f in all_folders],
        items=await service.item_outs(ctx, rows[: inp.limit]),
        next_cursor=str(offset + inp.limit) if more else None,
    )


async def pinned(ctx: Ctx, program_id: str) -> list[ItemOut]:
    await academics.get_program_row(ctx, program_id)
    course_ids = await service.program_course_ids(ctx, program_id)
    if not course_ids:
        return []
    rows = (
        await ctx.db.scalars(
            select(FilesItem)
            .where(
                FilesItem.user_id == ctx.user_id,
                FilesItem.pinned.is_(True),
                FilesItem.course_id.in_(course_ids),
            )
            .order_by(func.lower(FilesItem.display_name), FilesItem.id)
        )
    ).all()
    return await service.item_outs(ctx, rows)


async def search_names(ctx: Ctx, inp: FileSearchInput) -> list[FileMatch]:
    await academics.get_program_row(ctx, inp.program_id)
    course_ids = await service.program_course_ids(ctx, inp.program_id)
    if not course_ids:
        return []
    stmt = select(
        FilesItem.id,
        FilesItem.course_id,
        FilesItem.display_name,
        FilesItem.mime_type,
        FilesItem.updated_at,
    ).where(
        FilesItem.user_id == ctx.user_id,
        FilesItem.kind == "file",
        FilesItem.course_id.in_(course_ids),
    )
    if query := inp.query.strip().lower():
        stmt = stmt.where(func.lower(FilesItem.display_name).contains(query, autoescape=True))
    rows = await ctx.db.execute(
        stmt.order_by(FilesItem.updated_at.desc(), FilesItem.id).limit(inp.limit)
    )
    return [
        FileMatch(
            id=r.id,
            course_id=r.course_id,
            display_name=r.display_name,
            mime_type=r.mime_type,
            updated_at=r.updated_at,
        )
        for r in rows
    ]
