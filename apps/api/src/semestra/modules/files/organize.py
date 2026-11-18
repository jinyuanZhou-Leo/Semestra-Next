"""Organizing a course's files into type folders, when the user asks (M07 §8).

The files not yet sorted (at the top level, or in the general "Course materials" folder) get a
type: by the rules where they tell, else by the model, which also reads the start of their text.
A job works out where each would go and keeps it as the course's plan (`files_organize_plans`,
one per course) until the user applies or discards it. Nothing moves before that, and a file the
user has moved since the plan is left where they put it.
"""

import asyncio
import time
from collections import defaultdict
from typing import Any, cast

from sqlalchemy import delete, select

from semestra.core.context import Ctx, run_as_system
from semestra.core.events import events
from semestra.core.jobs import TERMINAL, CoreJob, JobCtx, JobOut, enqueue, job_handler
from semestra.modules.academics import service as academics
from semestra.modules.files import service, sorting
from semestra.modules.files.models import (
    FilesDocumentPage,
    FilesItem,
    FilesOrganizePlan,
    FilesTypeFolder,
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
    TypeName,
)
from semestra.modules.files.sorting import Clues, MaterialType

KIND = "files.organize"
UPDATED = "files.organization.updated"
# The start of a file's text the model reads.
EXCERPT_CHARS = 400
# How often a wait for the plan (`state`'s `wait_seconds`) looks again.
WAIT_POLL_SECONDS = 0.5
# File names the assistant's confirmation card shows per folder; the rest are counted.
SHOWN = 10


async def unsorted_folders(
    ctx: Ctx, course_id: str, known: dict[MaterialType, FilesTypeFolder]
) -> set[str | None]:
    """Where the files not yet sorted are: the top level and "Course materials"."""
    general = await sorting.existing_folder(ctx, course_id, "general", known)
    return {None, general.id if general is not None else None}


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
    known = await sorting.type_folders(ctx, course.id)
    unsorted = await unsorted_folders(ctx, course.id, known)
    rows = [
        r
        for r in await ctx.db.scalars(
            select(FilesItem).where(
                FilesItem.user_id == ctx.user_id, FilesItem.course_id == course.id
            )
        )
        if r.folder_id in unsorted
    ]
    types: dict[str, MaterialType] = {}
    leftovers: dict[str, Clues] = {}
    for n, row in enumerate(rows):
        await ctx.stage("reading", current=n, total=len(rows))
        clues = Clues(title=row.display_name, mime=row.mime_type, url=row.url)
        kind = sorting.classify(clues)
        if kind == "general":
            excerpt = await _excerpt(ctx, row)
            leftovers[row.id] = Clues(row.display_name, row.mime_type, row.url, excerpt=excerpt)
        else:
            types[row.id] = kind

    async def batch(done: int, total: int) -> None:
        await ctx.stage("sorting", current=done, total=total)

    # The provider's errors fail the job: the user asked, so they are told (and can check the
    # provider). Without a model set up, only the rules sort.
    types |= await sorting.classify_leftovers(ctx, leftovers, on_batch=batch) or {}

    moves: list[dict[str, Any]] = []
    for row in rows:
        kind = types.get(row.id, "general")
        if kind in ("info", "general"):
            continue  # a syllabus stays at the top; what has no type stays where it is
        folder = await sorting.existing_folder(ctx, course.id, kind, known)
        if folder is not None and folder.id == row.folder_id:
            continue
        moves.append({"item_id": row.id, "type": kind, "from_folder_id": row.folder_id})
    saved = await _plan_row(ctx, course.id)
    if saved is not None and saved.job_id == ctx.job_id:
        saved.moves, saved.left = moves, len(rows) - len(moves)
        await _updated(ctx, course.id, course.program_id)
    return OrganizeDone(course_id=course.id, program_id=course.program_id)


async def _live_moves(ctx: Ctx, course_id: str, saved: FilesOrganizePlan) -> list[PlannedMove]:
    """The plan's moves still to make: its files that are still where they were, each with the
    folder it would go in now."""
    stored = saved.moves or []
    rows = {r.id: r for r in await service.find_items(ctx, [m["item_id"] for m in stored])}
    known = await sorting.type_folders(ctx, course_id)
    folders: dict[str, tuple[str | None, str]] = {}
    moves: list[PlannedMove] = []
    for move in stored:
        row = rows.get(move["item_id"])
        if row is None or row.course_id != course_id or row.folder_id != move["from_folder_id"]:
            continue  # deleted, or the user has moved it since
        kind = cast(MaterialType, move["type"])
        if kind not in folders:
            folder = await sorting.existing_folder(ctx, course_id, kind, known)
            folders[kind] = (
                (folder.id, folder.name)
                if folder is not None
                else (None, sorting.folder_name(kind, ctx.locale))
            )
        folder_id, folder_name = folders[kind]
        if folder_id is not None and folder_id == row.folder_id:
            continue
        moves.append(
            PlannedMove(
                item_id=row.id,
                name=row.display_name,
                type=cast(TypeName, kind),
                folder_id=folder_id,
                folder_name=folder_name,
                from_folder_id=row.folder_id,
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
        moves = await _live_moves(ctx, course_id, saved)
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


async def preview_apply(ctx: Ctx, inp: OrganizeApplyInput) -> dict[str, Any]:
    """The assistant's confirmation card (M12 §3.5): each folder with the files going in it,
    as `apply` would move them."""
    course = await academics.get_course_row(ctx, inp.course_id)
    saved = await _plan_row(ctx, course.id)
    kept = set(inp.item_ids)
    by_folder: dict[str, list[str]] = defaultdict(list)
    if saved is not None and saved.moves is not None:
        for move in await _live_moves(ctx, course.id, saved):
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
    """Moves the plan's files the user kept into their type folders; the plan is done with."""
    course = await academics.get_course_row(ctx, course_id)
    saved = await _plan_row(ctx, course.id)
    kept = set(item_ids)
    by_type: dict[MaterialType, list[str]] = defaultdict(list)
    if saved is not None and saved.moves is not None:
        for move in await _live_moves(ctx, course.id, saved):
            if move.item_id in kept:
                by_type[move.type].append(move.item_id)
    known = await sorting.type_folders(ctx, course.id)
    moved = 0
    for kind, ids in by_type.items():
        folder_id = await sorting.folder_for(ctx, course.id, kind, known, if_deleted="remake")
        moved += await service.move_entries(ctx, course.id, ids, [], folder_id)
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
