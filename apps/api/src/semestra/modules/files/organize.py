"""Organizing a course's files into type folders, when the user asks (M07 §8).

The files not yet sorted (at the top level, or in the general "Course materials" folder) get a
type: by the rules where they tell, else by the model, which also reads the start of their text.
A job works out where each would go and keeps it as the course's plan (`files_organize_plans`,
one per course) until the user applies or discards it. Nothing moves before that, and a file the
user has moved since the plan is left where they put it.
"""

from collections import defaultdict
from typing import Any, cast

from pydantic import BaseModel, Field
from sqlalchemy import delete, select

from semestra.core.capability import Http, capability
from semestra.core.context import Ctx
from semestra.core.events import events
from semestra.core.jobs import CoreJob, JobCtx, JobOut, enqueue, job_handler
from semestra.modules.academics import service as academics
from semestra.modules.files import service, sorting
from semestra.modules.files.models import (
    FilesDocumentPage,
    FilesItem,
    FilesOrganizePlan,
    FilesTypeFolder,
)
from semestra.modules.files.schemas import Deleted
from semestra.modules.files.sorting import Clues, MaterialType

KIND = "files.organize"
UPDATED = "files.organization.updated"
# The start of a file's text the model reads.
EXCERPT_CHARS = 400

TypeName = sorting.TypeName


class OrganizeInput(BaseModel):
    course_id: str = Field(description="The course whose files to organize.")


class OrganizeDone(BaseModel):
    """The job's result: where the plan is."""

    course_id: str
    program_id: str


class PlannedMove(BaseModel):
    item_id: str
    type: TypeName
    # The folder it goes in; None: made when the move is applied.
    folder_id: str | None
    folder_name: str
    # Where it is now (None: the top level).
    from_folder_id: str | None


class OrganizePlan(BaseModel):
    moves: list[PlannedMove]
    # Files looked at and left where they are.
    left: int


class OrganizeState(BaseModel):
    """The course's organizing: its job (while reading, or when it failed; None once the job
    record is gone), and its plan once read. Both None: nothing waits."""

    job: JobOut | None
    plan: OrganizePlan | None


class OrganizeApplyInput(BaseModel):
    course_id: str = Field(description="The course whose plan to apply.")
    item_ids: list[str] = Field(
        max_length=5000, description="The files of the plan the user kept; the rest stay."
    )


class OrganizeApplied(BaseModel):
    moved: int


class PendingOrganize(BaseModel):
    course_id: str
    # Files the plan would still move.
    count: int


class PendingOrganizeList(BaseModel):
    items: list[PendingOrganize]


class ProgramInput(BaseModel):
    program_id: str = Field(description="The Program whose courses to look at.")


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


async def _updated(ctx: Ctx, course_id: str, program_id: str) -> None:
    await events.publish(ctx, UPDATED, {"course_id": course_id, "program_id": program_id})


@job_handler(KIND, stages=[("reading", 1), ("sorting", 3)], max_attempts=1)
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
                type=cast(TypeName, kind),
                folder_id=folder_id,
                folder_name=folder_name,
                from_folder_id=row.folder_id,
            )
        )
    return moves


@capability(
    name="files.organization.start",
    summary="Work out how to sort a course's unsorted files into type folders.",
    description="""Starts a job that gives each file at the top level or in "Course materials" a
type (lectures, past exams...) and the folder it would go in, and keeps that as the course's plan
(replacing one not yet applied). Nothing is moved: the user reviews the plan
(`files.organization.get`) and applies it (`files.organization.apply`).""",
    effect="write",
    http=Http("POST", "/courses/{course_id}/files:organize"),
    expose=("http",),
    tags=("files",),
)
async def organization_start(ctx: Ctx, inp: OrganizeInput) -> JobOut:
    course = await academics.get_course_row(ctx, inp.course_id)
    job = await enqueue(ctx, KIND, inp, dedupe_key=f"{KIND}:{inp.course_id}")
    saved = await _plan_row(ctx, course.id)
    if saved is None:
        ctx.db.add(FilesOrganizePlan(user_id=ctx.user_id, course_id=course.id, job_id=job.id))
    elif saved.job_id != job.id:
        saved.job_id, saved.moves, saved.left = job.id, None, 0
    await _updated(ctx, course.id, course.program_id)
    return JobOut.of(job)


@capability(
    name="files.organization.get",
    summary="Where a course's organizing stands.",
    description="""The course's organizing: its job while it reads (or when it failed), and the
plan once read, with the files the user has moved or deleted since left out.""",
    effect="read",
    http=Http("GET", "/courses/{course_id}/files:organize"),
    expose=("http",),
    tags=("files",),
)
async def organization_get(ctx: Ctx, inp: OrganizeInput) -> OrganizeState:
    await academics.get_course_row(ctx, inp.course_id)
    saved = await _plan_row(ctx, inp.course_id)
    if saved is None:
        return OrganizeState(job=None, plan=None)
    if saved.moves is not None:
        moves = await _live_moves(ctx, inp.course_id, saved)
        return OrganizeState(job=None, plan=OrganizePlan(moves=moves, left=saved.left))
    job = await ctx.db.scalar(
        select(CoreJob).where(CoreJob.id == saved.job_id, CoreJob.user_id == ctx.user_id)
    )
    return OrganizeState(job=JobOut.of(job) if job is not None else None, plan=None)


@capability(
    name="files.organization.list",
    summary="The courses of a Program whose organizing waits for review.",
    description="""Each course with a read plan not yet applied or discarded, and how many files
it would still move.""",
    effect="read",
    http=Http("GET", "/programs/{program_id}/file-organizations"),
    expose=("http",),
    tags=("files",),
)
async def organization_list(ctx: Ctx, inp: ProgramInput) -> PendingOrganizeList:
    await academics.get_program_row(ctx, inp.program_id)
    saved = list(
        await ctx.db.scalars(
            select(FilesOrganizePlan).where(
                FilesOrganizePlan.user_id == ctx.user_id, FilesOrganizePlan.moves.is_not(None)
            )
        )
    )
    courses = {
        c.id
        for c in await academics.courses_by_id(ctx, [s.course_id for s in saved])
        if c.program_id == inp.program_id
    }
    items = [
        PendingOrganize(course_id=s.course_id, count=len(await _live_moves(ctx, s.course_id, s)))
        for s in saved
        if s.course_id in courses
    ]
    return PendingOrganizeList(items=items)


@capability(
    name="files.organization.apply",
    summary="Move a course's files into their type folders, as its plan says.",
    description="""Applies the course's plan to the files the user kept: each goes in its type's
folder, made when the course has none. Files moved or deleted since the plan stay as they are.
The plan is done with afterwards.""",
    effect="write",
    http=Http("POST", "/courses/{course_id}/files:organize-apply"),
    expose=("http",),
    tags=("files",),
)
async def organization_apply(ctx: Ctx, inp: OrganizeApplyInput) -> OrganizeApplied:
    course = await academics.get_course_row(ctx, inp.course_id)
    saved = await _plan_row(ctx, course.id)
    kept = set(inp.item_ids)
    by_type: dict[MaterialType, list[str]] = defaultdict(list)
    if saved is not None and saved.moves is not None:
        for move in await _live_moves(ctx, course.id, saved):
            if move.item_id in kept:
                by_type[move.type].append(move.item_id)
    known = await sorting.type_folders(ctx, course.id)
    moved = 0
    for kind, item_ids in by_type.items():
        folder_id = await sorting.make_folder(ctx, course.id, kind, known)
        moved += await service.move_entries(ctx, course.id, item_ids, [], folder_id)
    await _discard(ctx, course.id, course.program_id)
    return OrganizeApplied(moved=moved)


@capability(
    name="files.organization.discard",
    summary="Discard a course's organizing plan without moving anything.",
    description="The plan is done with; the files stay where they are.",
    effect="write",
    http=Http("DELETE", "/courses/{course_id}/files:organize"),
    expose=("http",),
    tags=("files",),
)
async def organization_discard(ctx: Ctx, inp: OrganizeInput) -> Deleted:
    course = await academics.get_course_row(ctx, inp.course_id)
    await _discard(ctx, course.id, course.program_id)
    return Deleted()


async def _discard(ctx: Ctx, course_id: str, program_id: str) -> None:
    await ctx.db.execute(
        delete(FilesOrganizePlan).where(
            FilesOrganizePlan.user_id == ctx.user_id, FilesOrganizePlan.course_id == course_id
        )
    )
    await _updated(ctx, course_id, program_id)
