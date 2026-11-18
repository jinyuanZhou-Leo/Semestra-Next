"""Folders that stand for places on a source (M07 §8): a source module (M09's sync of course
materials) puts each item in the folder of its place on the source, a module, a folder of the
files area or the page that links it, given from the top as (id on the source, name) pairs
(`folder_at`).

The folders are made on first need (or the course's own folder of that name is used), and
remembered by the ids of their place (`files_source_folders`), not its names: renamed on the
source, a place keeps its folder, which follows the new name unless the user renamed it; renamed
or moved by the user, it keeps being used. The user's choices win: once they deleted one, its
place's new items go to the folder above it, and nothing is made again under it.
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

# A level of a place: its id on the source and its name there.
Segment = tuple[str, str]


def clean_place(place: Sequence[Sequence[str]]) -> list[Segment]:
    """The levels a place makes folders for: slashes in names turned to dashes, levels without a
    name left out, at most `MAX_FOLDER_DEPTH` (the deeper ones are left out)."""
    levels = [
        (str(key), cleaned[:MAX_NAME].strip())
        for key, name in place
        if (cleaned := _UNSAFE.sub("", name.replace("/", "-").replace("\\", "-")).strip())
    ]
    return levels[:MAX_FOLDER_DEPTH]


def place_names(place: Sequence[Sequence[str]]) -> list[str]:
    return [name for _, name in clean_place(place)]


def _key(levels: Sequence[Segment]) -> str:
    return json.dumps([key for key, _ in levels], ensure_ascii=False)


class SourceFolders:
    """A course's remembered folders of one source, for one run of its sync."""

    def __init__(self, ctx: Ctx, course_id: str, source_kind: str, source_name: str) -> None:
        self.ctx, self.course_id = ctx, course_id
        self.source_kind, self.source_name = source_kind, source_name
        self._rows: dict[str, FilesSourceFolder] | None = None
        self._found: dict[str, str] = {}
        self._looked: dict[str, tuple[str | None, bool]] = {}
        self._named: set[str] = set()

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

    async def existing(self, place: Sequence[Sequence[str]]) -> tuple[str | None, bool]:
        """The folder the place's items would go in now, without making any (None: the top
        level), and whether `folder_at` would make none (False: some are still to make)."""
        levels = clean_place(place)
        key = _key(levels)
        if key not in self._looked:
            self._looked[key] = await self._walk(levels, make=False)
        return self._looked[key]

    async def folder_at(self, place: Sequence[Sequence[str]]) -> str | None:
        """The folder of the place, made where missing (None: the top level)."""
        self._looked.clear()
        return (await self._walk(clean_place(place), make=True))[0]

    async def follow_names(self, place: Sequence[Sequence[str]]) -> None:
        """The place's folders made before take the names the source has for them now (see
        `_follow_name`); none is made."""
        known = await self._known()
        levels = clean_place(place)
        for depth in range(1, len(levels) + 1):
            key = _key(levels[:depth])
            if key in self._named:
                continue
            self._named.add(key)
            row = known.get(key)
            if row is None or row.folder_id is None:
                return
            folder = await folders.find_folder(self.ctx, self.course_id, row.folder_id)
            if folder is None:
                return
            await self._follow_name(row, folder, levels[depth - 1][1])

    async def _walk(self, levels: list[Segment], *, make: bool) -> tuple[str | None, bool]:
        known = await self._known()
        parent: str | None = None
        for depth in range(1, len(levels) + 1):
            key, name = _key(levels[:depth]), levels[depth - 1][1]
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
                if make:
                    await self._follow_name(row, there, name)
                parent = row.folder_id
                if make and parent is not None:
                    self._found[key] = parent
                continue
            folder = await _child_named(self.ctx, self.course_id, parent, name)
            if folder is None:
                if not make:
                    return parent, False
                try:
                    made = await folders.create_folder(self.ctx, self.course_id, name, parent)
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
                    name=name,
                    source_name=self.source_name,
                    folder_id=folder_id,
                )
                self.ctx.db.add(row)
                known[key] = row
                self._found[key] = folder_id
            parent = folder_id
        return parent, True

    async def _follow_name(self, row: FilesSourceFolder, folder: FilesFolder, name: str) -> None:
        """The place was renamed on the source: its folder takes the new name, unless the user
        renamed it (or another folder there has that name)."""
        if name == row.name or folder.name != row.name:
            return
        try:
            await folders.update_folder(self.ctx, folder.id, {"name"}, name, None)
        except AppError as exc:
            if exc.code != "common.conflict":
                raise
            return
        row.name = name


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
