"""Organizing a course's files, when the user asks (M07 §8).

Two kinds of moves are proposed: items of a source (M09's course materials) that sit where the
source once put them, away from their place on it, go back to that place (`sources.homes`: the
course materials used to be filed by type; works without a model), and the user's own files at
the top level go into the course's folder that fits them, or a new folder for a group of them
(`sorting.place_loose`, by the model). A job works out the moves and keeps them as the course's
plan (`files_organize_plans`, one per course) until the user applies or discards it. Nothing moves
before that, and a file the user has moved since the plan is left where they put it.
"""

import asyncio
import time
from collections import defaultdict
from typing import Any

from sqlalchemy import delete, select

from semestra.core.context import Ctx, run_as_system
from semestra.core.events import events
from semestra.core.jobs import TERMINAL, CoreJob, JobCtx, JobOut, enqueue, job_handler
from semestra.modules.academics import service as academics
from semestra.modules.files import entries, folders, service, sorting, sources
from semestra.modules.files.models import (
    FilesDocumentPage,
    FilesFolder,
    FilesItem,
    FilesOrganizePlan,
)
from semestra.modules.files.schemas import (
    OrganizeApplied,
    OrganizeApplyInput,
    OrganizeDone,
    OrganizeInput,
    OrganizePlan,
    OrganizeState,
    PendingOrganize,
    PendingOrganizeList,
    PlannedMove,
)
from semestra.modules.files.sorting import Clues
from semestra.modules.files.source_folders import SourceFolders, clean_path

KIND = "files.organize"
UPDATED = "files.organization.updated"
# The start of a file's text the model reads.
EXCERPT_CHARS = 400
# How often a wait for the plan (`state`'s `wait_seconds`) looks again.
WAIT_POLL_SECONDS = 0.5
# File names the assistant's confirmation card shows per folder; the rest are counted.
SHOWN = 10
# Between the folder names of a path, as the review shows it.
SEPARATOR = " / "


def folder_paths(all_folders: list[FilesFolder]) -> dict[str, list[str]]:
    """Each folder's names from the top."""
    by_id = {f.id: f for f in all_folders}

    def path(folder: FilesFolder) -> list[str]:
        names: list[str] = []
        seen: set[str] = set()
        current: FilesFolder | None = folder
        while current is not None and current.id not in seen:
            seen.add(current.id)
            names.insert(0, current.name)
            current = by_id.get(current.parent_id) if current.parent_id else None
        return names

    return {f.id: path(f) for f in all_folders}


async def _plan_row(ctx: Ctx, course_id: str) -> FilesOrganizePlan | None:
    return await ctx.db.scalar(
        select(FilesOrganizePlan).where(
            FilesOrganizePlan.user_id == ctx.user_id, FilesOrganizePlan.course_id == course_id
        )
    )


async def _excerpt(ctx: Ctx, row: FilesItem) -> str | None:
    if row.active_document_id is None:
        return None
    text = await ctx.db.scalar(
        select(FilesDocumentPage.markdown).where(
            FilesDocumentPage.document_id == row.active_document_id,
            FilesDocumentPage.page_no == 1,
        )
    )
    return " ".join((text or "").split())[:EXCERPT_CHARS] or None


async def _updated(
    ctx: Ctx, course_id: str, program_id: str, *, user_id: str | None = None
) -> None:
    data = {"course_id": course_id, "program_id": program_id}
    await events.publish(ctx, UPDATED, data, user_id=user_id)


async def _failed(ctx: Ctx, payload: OrganizeInput, job: CoreJob) -> None:
    """A failed reading shows on the organizing's status line until the user has seen it."""
    # In a ctx of its own: the handler's objects (its user too) went with its rolled-back
    # transaction.

    async def tell(own: Ctx) -> None:
        for course in await academics.courses_by_id(own, [payload.course_id]):
            await _updated(own, payload.course_id, course.program_id, user_id=job.user_id)

    await run_as_system(ctx.state, job.user_id, tell)


# Not in the status bar's job list: the organizing has a line of its own (reading, then waiting
# for review), so one line follows it from start to review.
@job_handler(
    KIND, stages=[("reading", 1), ("sorting", 3)], max_attempts=1, listed=False, on_failure=_failed
)
async def plan(ctx: JobCtx, payload: OrganizeInput) -> OrganizeDone:
    course = await academics.get_course_row(ctx, payload.course_id)
    rows = list(
        await ctx.db.scalars(
            select(FilesItem).where(
                FilesItem.user_id == ctx.user_id, FilesItem.course_id == course.id
            )
        )
    )
    moves: list[dict[str, Any]] = []
    # Back to their place on their source.
    by_id = {r.id: r for r in rows}
    for home in await sources.homes(ctx, course.id):
        row = by_id.get(home.item_id)
        if row is None:
            continue
        moves.append(
            {
                "item_id": row.id,
                "from_folder_id": row.folder_id,
                "source": home.source_kind,
                "source_name": home.source_name,
                "path": list(home.path),
            }
        )
    # The user's own files at the top level.
    loose = [r for r in rows if r.folder_id is None and r.source_ref is None]
    all_folders = await folders.course_folders(ctx, course.id)
    paths = folder_paths(all_folders)
    ids = [f.id for f in all_folders]
    clues: dict[str, Clues] = {}
    for n, row in enumerate(loose):
        await ctx.stage("reading", current=n, total=len(loose))
        clues[row.id] = Clues(
            row.display_name, row.mime_type, row.url, excerpt=await _excerpt(ctx, row)
        )

    async def batch(done: int, total: int) -> None:
        await ctx.stage("sorting", current=done, total=total)

    # The provider's errors fail the job: the user asked, so they are told (and can check the
    # provider). Without a model set up, only the moves back are proposed.
    places = await sorting.place_loose(
        ctx, [SEPARATOR.join(paths[i]) for i in ids], clues, on_batch=batch
    )
    for row in loose:
        place = (places or {}).get(row.id)
        if place is None:
            continue
        target: dict[str, Any] = (
            {"folder_id": ids[place.folder]} if place.folder is not None else {"new": place.new}
        )
        moves.append({"item_id": row.id, "from_folder_id": None, **target})
    saved = await _plan_row(ctx, course.id)
    if saved is not None and saved.job_id == ctx.job_id:
        saved.moves, saved.left = moves, len(loose) - sum(1 for m in moves if "source" not in m)
        await _updated(ctx, course.id, course.program_id)
    return OrganizeDone(course_id=course.id, program_id=course.program_id)


class _Targets:
    """Where the plan's moves go now, as the review shows them and `apply` makes them."""

    def __init__(self, ctx: Ctx, course_id: str, all_folders: list[FilesFolder]) -> None:
        self.ctx, self.course_id = ctx, course_id
        self.paths = folder_paths(all_folders)
        self.roots = {f.name.casefold(): f.id for f in all_folders if f.parent_id is None}
        self.sources: dict[str, SourceFolders] = {}

    def _source(self, move: dict[str, Any]) -> SourceFolders:
        kind = move["source"]
        if kind not in self.sources:
            self.sources[kind] = SourceFolders(
                self.ctx, self.course_id, kind, move.get("source_name") or kind
            )
        return self.sources[kind]

    async def shown(self, move: dict[str, Any]) -> tuple[str | None, list[str], bool] | None:
        """(folder id, its path, whether it is still to make); None: the folder is gone."""
        if "source" in move:
            path = clean_path(move.get("path") or [])
            folder_id, complete = await self._source(move).existing(path)
            if complete:
                return folder_id, self.paths.get(folder_id, []) if folder_id else [], False
            return None, path, True
        if "folder_id" in move:
            folder_id = move["folder_id"]
            return (folder_id, self.paths[folder_id], False) if folder_id in self.paths else None
        name = str(move.get("new") or "")
        if (existing := self.roots.get(name.casefold())) is not None:
            return existing, self.paths[existing], False
        return None, [name], True

    async def make(self, move: dict[str, Any]) -> str | None:
        if "source" in move:
            return await self._source(move).folder_at(move.get("path") or [])
        if "folder_id" in move:
            return move["folder_id"]
        name = str(move.get("new") or "")
        if (existing := self.roots.get(name.casefold())) is None:
            existing = (await folders.create_folder(self.ctx, self.course_id, name, None)).id
            self.roots[name.casefold()] = existing
        return existing


async def _live_moves(
    ctx: Ctx, course_id: str, saved: FilesOrganizePlan
) -> list[tuple[PlannedMove, dict[str, Any]]]:
    """The plan's moves still to make: its files that are still where they were, each with the
    folder it would go in now."""
    stored = saved.moves or []
    rows = {r.id: r for r in await service.find_items(ctx, [m["item_id"] for m in stored])}
    targets = _Targets(ctx, course_id, await folders.course_folders(ctx, course_id))
    moves: list[tuple[PlannedMove, dict[str, Any]]] = []
    for move in stored:
        row = rows.get(move["item_id"])
        if row is None or row.course_id != course_id or row.folder_id != move["from_folder_id"]:
            continue  # deleted, or the user has moved it since
        shown = await targets.shown(move)
        if shown is None:
            continue  # the folder it was to go in is gone
        folder_id, path, new = shown
        if not new and folder_id == row.folder_id:
            continue
        moves.append(
            (
                PlannedMove(
                    item_id=row.id,
                    name=row.display_name,
                    folder_id=folder_id,
                    folder_name=SEPARATOR.join(path),
                    new_folder=new,
                    from_folder_id=row.folder_id,
                    back=move.get("source_name") if "source" in move else None,
                ),
                move,
            )
        )
    return moves


async def start(ctx: Ctx, course_id: str) -> JobOut:
    """Queues working out the course's plan, replacing one not yet applied."""
    course = await academics.get_course_row(ctx, course_id)
    job = await enqueue(
        ctx, KIND, OrganizeInput(course_id=course_id), dedupe_key=f"{KIND}:{course_id}"
    )
    saved = await _plan_row(ctx, course.id)
    if saved is None:
        ctx.db.add(FilesOrganizePlan(user_id=ctx.user_id, course_id=course.id, job_id=job.id))
    elif saved.job_id != job.id:
        saved.job_id, saved.moves, saved.left = job.id, None, 0
    await _updated(ctx, course.id, course.program_id)
    return JobOut.of(job)


async def _wait(ctx: Ctx, course_id: str, seconds: int) -> None:
    """Holds the call until the plan is worked out (or its job ended), or `seconds` pass, so
    the assistant waits with one call. Reads through a session of its own: the caller's
    transaction may not see the job's commits."""
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        async with ctx.state.session_factory() as db:
            saved = await db.scalar(
                select(FilesOrganizePlan).where(
                    FilesOrganizePlan.user_id == ctx.user_id,
                    FilesOrganizePlan.course_id == course_id,
                )
            )
            if saved is None or saved.moves is not None:
                return
            status = await db.scalar(select(CoreJob.status).where(CoreJob.id == saved.job_id))
            if status is None or status in TERMINAL:
                return
        await asyncio.sleep(WAIT_POLL_SECONDS)


async def state(ctx: Ctx, course_id: str, wait_seconds: int = 0) -> OrganizeState:
    await academics.get_course_row(ctx, course_id)
    if wait_seconds:
        await _wait(ctx, course_id, wait_seconds)
    saved = await _plan_row(ctx, course_id)
    if saved is None:
        return OrganizeState(job=None, plan=None)
    if saved.moves is not None:
        moves = [m for m, _ in await _live_moves(ctx, course_id, saved)]
        return OrganizeState(job=None, plan=OrganizePlan(moves=moves, left=saved.left))
    job = await ctx.db.scalar(
        select(CoreJob).where(CoreJob.id == saved.job_id, CoreJob.user_id == ctx.user_id)
    )
    return OrganizeState(job=JobOut.of(job) if job is not None else None, plan=None)


async def pending(ctx: Ctx, program_id: str) -> PendingOrganizeList:
    await academics.get_program_row(ctx, program_id)
    saved = list(
        await ctx.db.scalars(
            select(FilesOrganizePlan).where(FilesOrganizePlan.user_id == ctx.user_id)
        )
    )
    courses = {
        c.id
        for c in await academics.courses_by_id(ctx, [s.course_id for s in saved])
        if c.program_id == program_id
    }
    reading = [s for s in saved if s.course_id in courses and s.moves is None]
    jobs = {
        j.id: j
        for j in await ctx.db.scalars(
            select(CoreJob).where(
                CoreJob.user_id == ctx.user_id, CoreJob.id.in_([s.job_id for s in reading])
            )
        )
    }
    items: list[PendingOrganize] = []
    for s in saved:
        if s.course_id not in courses:
            continue
        if s.moves is not None:
            count = len(await _live_moves(ctx, s.course_id, s))
            items.append(PendingOrganize(course_id=s.course_id, job=None, count=count))
        elif (job := jobs.get(s.job_id)) is not None:
            items.append(PendingOrganize(course_id=s.course_id, job=JobOut.of(job), count=None))
    return PendingOrganizeList(items=items)


async def preview_start(ctx: Ctx, inp: OrganizeInput) -> dict[str, Any]:
    """The assistant's confirmation card: a plan still waiting for the user's review is
    replaced, so the card names its files."""
    course = await academics.get_course_row(ctx, inp.course_id)
    saved = await _plan_row(ctx, course.id)
    changes: list[dict[str, Any]] = []
    if saved is not None and saved.moves is not None:
        names = [m.name for m, _ in await _live_moves(ctx, course.id, saved)]
        if names:
            changes.append(
                {
                    "field": "pending_plan",
                    "before": names[:SHOWN],
                    "after": None,
                    "count": len(names),
                }
            )
    return {
        "target": f"{course.code} {course.title}" if course.code else course.title,
        "changes": changes,
        "link": {"to": f"/p/{course.program_id}/c/{course.id}/files", "page": "files"},
    }


async def preview_apply(ctx: Ctx, inp: OrganizeApplyInput) -> dict[str, Any]:
    """The assistant's confirmation card (M12 §3.5): each folder with the files going in it,
    as `apply` would move them."""
    course = await academics.get_course_row(ctx, inp.course_id)
    saved = await _plan_row(ctx, course.id)
    kept = set(inp.item_ids)
    by_folder: dict[str, list[str]] = defaultdict(list)
    if saved is not None and saved.moves is not None:
        for move, _ in await _live_moves(ctx, course.id, saved):
            if move.item_id in kept:
                by_folder[move.folder_name].append(move.name)
    return {
        "target": f"{course.code} {course.title}" if course.code else course.title,
        "changes": [
            {"field": "folder", "label": folder, "after": names[:SHOWN], "count": len(names)}
            for folder, names in by_folder.items()
        ],
        "link": {"to": f"/p/{course.program_id}/c/{course.id}/files", "page": "files"},
    }


async def apply(ctx: Ctx, course_id: str, item_ids: list[str]) -> OrganizeApplied:
    """Moves the plan's files the user kept into their folders, making the ones still to make;
    the plan is done with."""
    course = await academics.get_course_row(ctx, course_id)
    saved = await _plan_row(ctx, course.id)
    kept = set(item_ids)
    live = await _live_moves(ctx, course.id, saved) if saved and saved.moves is not None else []
    targets = _Targets(ctx, course.id, await folders.course_folders(ctx, course.id))
    by_folder: dict[str | None, list[str]] = defaultdict(list)
    back: dict[str, dict[str, str | None]] = defaultdict(dict)
    for move, stored in live:
        if move.item_id in kept:
            folder_id = await targets.make(stored)
            by_folder[folder_id].append(move.item_id)
            if "source" in stored:
                back[stored["source"]][move.item_id] = folder_id
    moved = 0
    for folder_id, ids in by_folder.items():
        moved += await entries.move_entries(ctx, course.id, ids, [], folder_id)
    for kind, placed in back.items():
        await sources.moved_back(ctx, kind, placed)
    await _drop_plan(ctx, course.id, course.program_id)
    return OrganizeApplied(moved=moved)


async def discard(ctx: Ctx, course_id: str) -> None:
    course = await academics.get_course_row(ctx, course_id)
    await _drop_plan(ctx, course.id, course.program_id)


async def _drop_plan(ctx: Ctx, course_id: str, program_id: str) -> None:
    await ctx.db.execute(
        delete(FilesOrganizePlan).where(
            FilesOrganizePlan.user_id == ctx.user_id, FilesOrganizePlan.course_id == course_id
        )
    )
    await _updated(ctx, course_id, program_id)
