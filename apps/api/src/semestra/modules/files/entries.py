"""Several entries at once, the file page's selection (M07 §4): moving, deleting and
downloading files and folders of one course."""

import mimetypes
from collections.abc import Sequence
from typing import Any

from sqlalchemy import delete, select

from semestra.core.context import Ctx
from semestra.core.errors import not_found
from semestra.core.events import events
from semestra.modules.academics import service as academics
from semestra.modules.files import content, folders, service
from semestra.modules.files.models import FilesFolder, FilesItem
from semestra.modules.files.schemas import EntriesDeleteInput


async def _course_items(ctx: Ctx, course_id: str, item_ids: Sequence[str]) -> list[FilesItem]:
    """The course's items with these ids; any id that is not one of them is not found."""
    ids = list(dict.fromkeys(item_ids))
    if not ids:
        return []
    rows = list(
        (
            await ctx.db.scalars(
                select(FilesItem).where(
                    FilesItem.user_id == ctx.user_id,
                    FilesItem.course_id == course_id,
                    FilesItem.id.in_(ids),
                )
            )
        ).all()
    )
    found = {r.id for r in rows}
    for item_id in ids:
        if item_id not in found:
            raise not_found("item", item_id)
    return rows


async def move_entries(
    ctx: Ctx,
    course_id: str,
    item_ids: Sequence[str],
    folder_ids: Sequence[str],
    to_folder_id: str | None,
) -> int:
    """Moves files and folders of one course into `to_folder_id` (None = its top level). All in
    the request's transaction: if one cannot move (a name taken, too deep), none do."""
    await academics.get_course_row(ctx, course_id)
    await folders.check_in_course(ctx, course_id, to_folder_id)
    items = await _course_items(ctx, course_id, item_ids)
    folder_ids = list(dict.fromkeys(folder_ids))
    for folder_id in folder_ids:
        await service.get_folder(ctx, folder_id, course_id)
        await folders.update_folder(ctx, folder_id, {"parent_id"}, None, to_folder_id)
    for row in items:
        row.folder_id = to_folder_id
        row.updated_at = ctx.now
    await ctx.db.flush()
    for row in items:
        await events.publish(
            ctx, "files.item.updated", {"item_id": row.id, "course_id": row.course_id}
        )
    return len(items) + len(folder_ids)


async def _entries_to_delete(
    ctx: Ctx, course_id: str, item_ids: Sequence[str], folder_ids: Sequence[str]
) -> tuple[list[FilesFolder], set[str], list[FilesItem]]:
    """(the chosen folders, every folder that goes, every item that goes): a chosen folder takes
    its subfolders and files with it, even ones that were chosen as well."""
    await academics.get_course_row(ctx, course_id)
    all_folders = await folders.course_folders(ctx, course_id)
    by_id = {f.id: f for f in all_folders}
    chosen: list[FilesFolder] = []
    for folder_id in dict.fromkeys(folder_ids):
        if folder_id not in by_id:
            raise not_found("folder", folder_id)
        chosen.append(by_id[folder_id])
    tree: set[str] = set()
    for folder in chosen:
        tree |= {folder.id} | folders.descendants(folder.id, all_folders)
    items = await _course_items(ctx, course_id, item_ids)
    if tree:
        items += list(
            (
                await ctx.db.scalars(
                    select(FilesItem).where(
                        FilesItem.user_id == ctx.user_id, FilesItem.folder_id.in_(tree)
                    )
                )
            ).all()
        )
    unique = list({row.id: row for row in items}.values())
    return chosen, tree, unique


async def preview_entries_delete(ctx: Ctx, inp: EntriesDeleteInput) -> dict[str, Any]:
    chosen, tree, items = await _entries_to_delete(ctx, inp.course_id, inp.item_ids, inp.folder_ids)
    names = sorted((i.display_name for i in items), key=str.lower)
    changes: list[dict[str, Any]] = []
    if names:
        changes.append({"field": "files", "before": names[:10], "after": None, "count": len(names)})
    if tree:
        changes.append({"field": "folders", "before": len(tree), "after": None})
    picked = set(inp.item_ids)
    targets = [f.name for f in chosen] + [i.display_name for i in items if i.id in picked]
    target = ", ".join(targets[:3]) + (" …" if len(targets) > 3 else "")
    return {"target": target, "changes": changes}


async def delete_entries(
    ctx: Ctx, course_id: str, item_ids: Sequence[str], folder_ids: Sequence[str]
) -> None:
    """Deletes files and folders (with everything in them) of one course, all or none."""
    chosen, tree, items = await _entries_to_delete(ctx, course_id, item_ids, folder_ids)
    await service.purge_items(ctx, items)
    if tree:
        await ctx.db.execute(delete(FilesFolder).where(FilesFolder.id.in_(tree)))
    for folder in chosen:
        await events.publish(
            ctx, "files.folder.deleted", {"folder_id": folder.id, "course_id": course_id}
        )


async def download_entries(
    ctx: Ctx, course_id: str, item_ids: Sequence[str], folder_ids: Sequence[str]
) -> list[tuple[str, FilesItem | None]]:
    """What to put in one download, each with its path in it: a chosen file at the top and a
    chosen folder under its name, with its subfolders and files (a folder is an entry of its own,
    None, so an empty one is kept too). Links have no bytes and are left out; names that repeat
    get a number."""
    await academics.get_course_row(ctx, course_id)
    all_folders = await folders.course_folders(ctx, course_id)
    by_id = {f.id: f for f in all_folders}
    picked: list[tuple[str, FilesItem]] = [
        ("", row) for row in await _course_items(ctx, course_id, item_ids)
    ]
    out: list[tuple[str, FilesItem | None]] = []
    for folder_id in dict.fromkeys(folder_ids):
        top = by_id.get(folder_id)
        if top is None:
            raise not_found("folder", folder_id)
        tree = {top.id} | folders.descendants(top.id, all_folders)

        def path(fid: str, top: FilesFolder = top) -> str:
            parts: list[str] = []
            step: FilesFolder | None = by_id[fid]
            while step is not None:
                parts.append(step.name)
                step = by_id.get(step.parent_id or "") if step.id != top.id else None
            return "/".join(reversed(parts)) + "/"

        rows = await ctx.db.scalars(
            select(FilesItem).where(FilesItem.user_id == ctx.user_id, FilesItem.folder_id.in_(tree))
        )
        out += sorted((path(fid), None) for fid in tree)
        picked += [(path(r.folder_id or top.id), r) for r in rows]
    taken: set[str] = set()
    seen: set[str] = set()
    for folder, row in picked:
        if row.id in seen or not content.has_content(row):
            continue
        seen.add(row.id)
        name = download_name(row.display_name, row.mime_type)
        stem, dot, ext = name.rpartition(".") if "." in name else (name, "", "")
        candidate, n = folder + name, 1
        while candidate.lower() in taken:
            n += 1
            candidate = f"{folder}{stem} ({n}){dot}{ext}"
        taken.add(candidate.lower())
        out.append((candidate, row))
    return out


def download_name(name: str, mime: str | None) -> str:
    """The shown name, with the extension of its type when it has none (an LMS page is named by
    its title), so the downloaded file opens."""
    if "." in name or not mime or mime == "application/octet-stream":
        return name
    return name + (mimetypes.guess_extension(mime) or "")
