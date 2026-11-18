"""Folders that stand for places on a source (M07 §8): a source module (M09's sync of course
materials) puts each item in the folder of its place on the source, a module, a folder of the
files area or the page that links it, given as folder names from the top (`folder_at`).

The folders are made on first need (or the course's own folder of that name is used), and
remembered by their place (`files_source_folders`): renamed or moved by the user, they keep being
used. The user's choices win: once they deleted one, its place's new items go to the folder
above it, and nothing is made again under it.
"""

import json
import re
from collections.abc import Sequence

from sqlalchemy import func, select

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules.files import folders
from semestra.modules.files.models import FilesFolder, FilesSourceFolder
from semestra.modules.files.schemas import MAX_FOLDER_DEPTH

# Longest folder name made from a source's.
MAX_NAME = 120
_UNSAFE = re.compile(r"[\x00-\x1f\x7f]")


def clean_path(path: Sequence[str]) -> list[str]:
    """The folder names a place makes: slashes turned to dashes, blank names left out, at most
    `MAX_FOLDER_DEPTH` levels (the deeper ones are kept in the last)."""
    names = [
        cleaned[:MAX_NAME].strip()
        for name in path
        if (cleaned := _UNSAFE.sub("", name.replace("/", "-").replace("\\", "-")).strip())
    ]
    return names[:MAX_FOLDER_DEPTH]


def path_key(path: Sequence[str]) -> str:
    return json.dumps(list(path), ensure_ascii=False)


class SourceFolders:
    """A course's remembered folders of one source, for one run of its sync."""

    def __init__(self, ctx: Ctx, course_id: str, source_kind: str, source_name: str) -> None:
        self.ctx, self.course_id = ctx, course_id
        self.source_kind, self.source_name = source_kind, source_name
        self._rows: dict[str, FilesSourceFolder] | None = None
        self._found: dict[str, str] = {}

    async def _known(self) -> dict[str, FilesSourceFolder]:
        if self._rows is None:
            rows = await self.ctx.db.scalars(
                select(FilesSourceFolder).where(
                    FilesSourceFolder.user_id == self.ctx.user_id,
                    FilesSourceFolder.course_id == self.course_id,
                    FilesSourceFolder.source_kind == self.source_kind,
                )
            )
            self._rows = {r.path: r for r in rows}
        return self._rows

    async def existing(self, path: Sequence[str]) -> tuple[str | None, bool]:
        """The folder the place's items would go in now, without making any (None: the top
        level), and whether `folder_at` would make none (False: some are still to make)."""
        return await self._walk(clean_path(path), make=False)

    async def folder_at(self, path: Sequence[str]) -> str | None:
        """The folder of the place, made where missing (None: the top level)."""
        return (await self._walk(clean_path(path), make=True))[0]

    async def _walk(self, names: list[str], *, make: bool) -> tuple[str | None, bool]:
        known = await self._known()
        parent: str | None = None
        for depth in range(1, len(names) + 1):
            key = path_key(names[:depth])
            if (cached := self._found.get(key)) is not None:
                parent = cached
                continue
            row = known.get(key)
            if row is not None:
                there = row.folder_id is not None and (
                    await folders.find_folder(self.ctx, self.course_id, row.folder_id)
                )
                if not there:
                    return parent, True  # the user deleted it: its items go to the folder above
                parent = row.folder_id
                if make and parent is not None:
                    self._found[key] = parent
                continue
            folder = await _child_named(self.ctx, self.course_id, parent, names[depth - 1])
            if folder is None:
                if not make:
                    return parent, False
                try:
                    made = await folders.create_folder(
                        self.ctx, self.course_id, names[depth - 1], parent
                    )
                except AppError as exc:
                    if exc.code != "files.folder_depth":
                        raise
                    return parent, True  # the user moved the folder above too deep
                folder_id = made.id
            else:
                folder_id = folder.id
            if make:
                row = FilesSourceFolder(
                    user_id=self.ctx.user_id,
                    course_id=self.course_id,
                    source_kind=self.source_kind,
                    path=key,
                    source_name=self.source_name,
                    folder_id=folder_id,
                )
                self.ctx.db.add(row)
                known[key] = row
                self._found[key] = folder_id
            parent = folder_id
        return parent, True


async def _child_named(
    ctx: Ctx, course_id: str, parent_id: str | None, name: str
) -> FilesFolder | None:
    return await ctx.db.scalar(
        select(FilesFolder).where(
            FilesFolder.user_id == ctx.user_id,
            FilesFolder.course_id == course_id,
            FilesFolder.parent_id == parent_id
            if parent_id is not None
            else FilesFolder.parent_id.is_(None),
            func.lower(FilesFolder.name) == name.lower(),
        )
    )
