"""Course folders (M07 §2): the folder tree of a course, creating, renaming, moving and
deleting folders."""

from collections.abc import Iterable, Sequence
from typing import Any

from sqlalchemy import delete, func, select

from semestra.core.context import Ctx
from semestra.core.errors import AppError, not_found
from semestra.core.events import events
from semestra.modules.academics import service as academics
from semestra.modules.files import service
from semestra.modules.files.models import FilesFolder, FilesItem, FilesSourceFolder
from semestra.modules.files.schemas import MAX_FOLDER_DEPTH, FolderDeleteInput, FolderOut


async def course_folders(ctx: Ctx, course_id: str) -> list[FilesFolder]:
    return list(
        (
            await ctx.db.scalars(
                select(FilesFolder)
                .where(FilesFolder.user_id == ctx.user_id, FilesFolder.course_id == course_id)
                .order_by(func.lower(FilesFolder.name), FilesFolder.id)
            )
        ).all()
    )


def depth(folder: FilesFolder, by_id: dict[str, FilesFolder]) -> int:
    depth, seen = 1, {folder.id}
    while folder.parent_id and folder.parent_id in by_id and folder.parent_id not in seen:
        folder = by_id[folder.parent_id]
        seen.add(folder.id)
        depth += 1
    return depth


def descendants(folder_id: str, folders: Iterable[FilesFolder]) -> set[str]:
    children: dict[str | None, list[str]] = {}
    for f in folders:
        children.setdefault(f.parent_id, []).append(f.id)
    found: set[str] = set()
    stack = [folder_id]
    while stack:
        for child in children.get(stack.pop(), []):
            if child not in found:
                found.add(child)
                stack.append(child)
    return found


def subtree_height(folder_id: str, folders: Sequence[FilesFolder]) -> int:
    """Levels of the folder's own subtree, counting the folder itself."""
    children: dict[str | None, list[str]] = {}
    for f in folders:
        children.setdefault(f.parent_id, []).append(f.id)

    def height(fid: str) -> int:
        return 1 + max((height(c) for c in children.get(fid, [])), default=0)

    return height(folder_id)


def folder_out(
    row: FilesFolder, counts: dict[str, int], sources: dict[str, str] | None = None
) -> FolderOut:
    return FolderOut(
        id=row.id,
        course_id=row.course_id,
        parent_id=row.parent_id,
        name=row.name,
        item_count=counts.get(row.id, 0),
        source_name=(sources or {}).get(row.id),
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def source_names(ctx: Ctx, course_id: str) -> dict[str, str]:
    """The course's folders that stand for a place on a source, with the source's name."""
    rows = await ctx.db.execute(
        select(FilesSourceFolder.folder_id, FilesSourceFolder.source_name).where(
            FilesSourceFolder.user_id == ctx.user_id,
            FilesSourceFolder.course_id == course_id,
            FilesSourceFolder.folder_id.is_not(None),
        )
    )
    return {folder_id: name for folder_id, name in rows.all() if folder_id}


async def folder_counts(ctx: Ctx, course_id: str) -> dict[str, int]:
    rows = await ctx.db.execute(
        select(FilesItem.folder_id, func.count())
        .where(
            FilesItem.user_id == ctx.user_id,
            FilesItem.course_id == course_id,
            FilesItem.folder_id.is_not(None),
        )
        .group_by(FilesItem.folder_id)
    )
    return {fid: n for fid, n in rows.all() if fid}


async def check_in_course(ctx: Ctx, course_id: str, folder_id: str | None) -> None:
    """A folder of the course, if one is given (else not found)."""
    if folder_id is not None:
        await service.get_folder(ctx, folder_id, course_id)


async def find_folder(ctx: Ctx, course_id: str, folder_id: str) -> FilesFolder | None:
    return await ctx.db.scalar(
        select(FilesFolder).where(
            FilesFolder.id == folder_id,
            FilesFolder.user_id == ctx.user_id,
            FilesFolder.course_id == course_id,
        )
    )


async def folder_names(ctx: Ctx, folder_ids: Sequence[str]) -> dict[str, str]:
    """The names of the ctx user's folders with these ids (gone ones left out)."""
    if not folder_ids:
        return {}
    rows = await ctx.db.execute(
        select(FilesFolder.id, FilesFolder.name).where(
            FilesFolder.user_id == ctx.user_id, FilesFolder.id.in_(list(folder_ids))
        )
    )
    return {fid: name for fid, name in rows.all()}


async def _check_free_name(
    ctx: Ctx, course_id: str, parent_id: str | None, name: str, *, except_id: str | None = None
) -> None:
    stmt = select(FilesFolder.name).where(
        FilesFolder.user_id == ctx.user_id,
        FilesFolder.course_id == course_id,
        FilesFolder.parent_id == parent_id
        if parent_id is not None
        else FilesFolder.parent_id.is_(None),
        func.lower(FilesFolder.name) == name.lower(),
    )
    if except_id is not None:
        stmt = stmt.where(FilesFolder.id != except_id)
    if (taken := await ctx.db.scalar(stmt)) is not None:
        raise AppError("files.folder_name_taken", 409, name=taken)


async def create_folder(ctx: Ctx, course_id: str, name: str, parent_id: str | None) -> FolderOut:
    await academics.get_course_row(ctx, course_id)
    name = service.clean_name(name)
    folders = await course_folders(ctx, course_id)
    by_id = {f.id: f for f in folders}
    if parent_id is not None:
        parent = by_id.get(parent_id)
        if parent is None:
            raise not_found("folder", parent_id)
        if depth(parent, by_id) >= MAX_FOLDER_DEPTH:
            raise AppError("files.folder_depth", 422, max=MAX_FOLDER_DEPTH)
    await _check_free_name(ctx, course_id, parent_id, name)
    row = FilesFolder(
        user_id=ctx.user_id,
        course_id=course_id,
        parent_id=parent_id,
        name=name,
        created_at=ctx.now,
        updated_at=ctx.now,
    )
    ctx.db.add(row)
    await ctx.db.flush()
    await events.publish(ctx, "files.folder.created", {"folder_id": row.id, "course_id": course_id})
    return folder_out(row, {})


async def update_folder(
    ctx: Ctx,
    folder_id: str,
    fields: set[str],
    name: str | None,
    parent_id: str | None,
) -> FolderOut:
    if "name" in fields and name is None:
        service.refuse_none(["name"])
    row = await service.get_folder(ctx, folder_id)
    folders = await course_folders(ctx, row.course_id)
    by_id = {f.id: f for f in folders}
    new_name = service.clean_name(name) if "name" in fields and name is not None else row.name
    new_parent = parent_id if "parent_id" in fields else row.parent_id
    if new_parent != row.parent_id and new_parent is not None:
        target = by_id.get(new_parent)
        if target is None:
            raise not_found()
        if new_parent == row.id or new_parent in descendants(row.id, folders):
            raise AppError(
                "common.validation", 422, errors=[{"loc": ["parent_id"], "code": "cycle"}]
            )
        if depth(target, by_id) + subtree_height(row.id, folders) > MAX_FOLDER_DEPTH:
            raise AppError("files.folder_depth", 422, max=MAX_FOLDER_DEPTH)
    if new_name != row.name or new_parent != row.parent_id:
        await _check_free_name(ctx, row.course_id, new_parent, new_name, except_id=row.id)
    row.name, row.parent_id = new_name, new_parent
    row.updated_at = ctx.now
    await ctx.db.flush()
    await events.publish(
        ctx, "files.folder.updated", {"folder_id": row.id, "course_id": row.course_id}
    )
    return folder_out(
        row, await folder_counts(ctx, row.course_id), await source_names(ctx, row.course_id)
    )


async def _folder_contents(
    ctx: Ctx, row: FilesFolder, recursive: bool
) -> tuple[set[str], list[FilesItem]]:
    """(the folder and its subfolders, the files in any of them): what deleting it removes.
    Without `recursive` only an empty folder can go (the assistant's card is refused the same
    way, so it never shows files that a delete would keep)."""
    folders = await course_folders(ctx, row.course_id)
    tree = {row.id} | descendants(row.id, folders)
    items = list(
        (
            await ctx.db.scalars(
                select(FilesItem).where(
                    FilesItem.user_id == ctx.user_id, FilesItem.folder_id.in_(tree)
                )
            )
        ).all()
    )
    if (items or len(tree) > 1) and not recursive:
        raise AppError("files.folder_not_empty", 409)
    return tree, items


# Targets for the assistant's confirmation cards of deletes (M12 §3.5): what goes, by name.


async def preview_folder_delete(ctx: Ctx, inp: FolderDeleteInput) -> dict[str, Any]:
    """What goes with the folder: its files (by name) and subfolders."""
    row = await service.get_folder(ctx, inp.folder_id)
    tree, items = await _folder_contents(ctx, row, inp.recursive)
    names = sorted((i.display_name for i in items), key=str.lower)
    changes: list[dict[str, Any]] = []
    if names:
        changes.append({"field": "files", "before": names[:10], "after": None, "count": len(names)})
    if len(tree) > 1:
        changes.append({"field": "subfolders", "before": len(tree) - 1, "after": None})
    return {"target": row.name, "changes": changes}


async def check_folder_delete(ctx: Ctx, inp: FolderDeleteInput) -> None:
    await _folder_contents(ctx, await service.get_folder(ctx, inp.folder_id), inp.recursive)


async def delete_folder(ctx: Ctx, folder_id: str, recursive: bool) -> None:
    row = await service.get_folder(ctx, folder_id)
    tree, items = await _folder_contents(ctx, row, recursive)
    await service.purge_items(ctx, items)
    await ctx.db.execute(delete(FilesFolder).where(FilesFolder.id.in_(tree)))
    await events.publish(
        ctx, "files.folder.deleted", {"folder_id": row.id, "course_id": row.course_id}
    )
