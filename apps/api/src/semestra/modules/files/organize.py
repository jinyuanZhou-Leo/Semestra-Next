"""Organizing a course's files into type folders, when the user asks (M07 §8).

The files not yet sorted (at the top level, or in the general "Course materials" folder) get a
type: by the rules where they tell, else by the model, which also reads the start of their text.
A job works out where each would go; the user reviews that and applies what they keep. Nothing
moves before that, and a file the job leaves where it is is never moved.
"""

from collections import defaultdict
from typing import cast

from pydantic import BaseModel, Field
from sqlalchemy import select

from semestra.core.capability import Http, capability
from semestra.core.context import Ctx
from semestra.core.errors import not_found
from semestra.core.jobs import CoreJob, JobCtx, JobOut, enqueue, job_handler
from semestra.modules.academics import service as academics
from semestra.modules.files import service, sorting
from semestra.modules.files.models import FilesDocumentPage, FilesItem
from semestra.modules.files.sorting import Clues, MaterialType

KIND = "files.organize"
# The start of a file's text the model reads.
EXCERPT_CHARS = 400

TypeName = sorting.TypeName


class OrganizeInput(BaseModel):
    course_id: str = Field(description="The course whose files to organize.")


class OrganizeRef(BaseModel):
    course_id: str = Field(description="The course the job organizes.")
    job_id: str = Field(description="The job `files.organization.start` returned.")


class PlannedMove(BaseModel):
    item_id: str
    type: TypeName
    # The folder it goes in; None: made when the move is applied.
    folder_id: str | None
    folder_name: str


class OrganizePlan(BaseModel):
    course_id: str
    program_id: str
    moves: list[PlannedMove]
    # Files looked at and left where they are.
    left: int


class OrganizeMove(BaseModel):
    item_id: str = Field(description="A file of the course.")
    type: TypeName = Field(description="The type whose folder it goes in.")


class OrganizeApplyInput(BaseModel):
    course_id: str = Field(description="The course whose files to move.")
    moves: list[OrganizeMove] = Field(max_length=1000, description="The moves the user kept.")


class OrganizeApplied(BaseModel):
    moved: int


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


@job_handler(KIND, stages=[("sorting", 1)], max_attempts=1)
async def plan(ctx: JobCtx, payload: OrganizeInput) -> OrganizePlan:
    course = await academics.get_course_row(ctx, payload.course_id)
    known = await sorting.type_folders(ctx, course.id)
    general = known.get("general")
    unsorted = {None, general.folder_id if general is not None else None}
    rows = [
        r
        for r in await ctx.db.scalars(
            select(FilesItem).where(
                FilesItem.user_id == ctx.user_id, FilesItem.course_id == course.id
            )
        )
        if r.folder_id in unsorted
    ]
    await ctx.stage("sorting")
    types: dict[str, MaterialType] = {}
    leftovers: dict[str, Clues] = {}
    for row in rows:
        clues = Clues(title=row.display_name, mime=row.mime_type, url=row.url)
        kind = sorting.classify(clues)
        if kind == "general":
            excerpt = await _excerpt(ctx, row)
            leftovers[row.id] = Clues(row.display_name, row.mime_type, row.url, excerpt=excerpt)
        else:
            types[row.id] = kind
    types |= await sorting.classify_leftovers(ctx, leftovers) or {}

    moves: list[PlannedMove] = []
    for row in rows:
        kind = types.get(row.id, "general")
        if kind in ("info", "general"):
            continue  # a syllabus stays at the top; what has no type stays where it is
        folder = await sorting.existing_folder(ctx, course.id, kind, known)
        if folder is not None and folder.id == row.folder_id:
            continue
        moves.append(
            PlannedMove(
                item_id=row.id,
                type=cast(TypeName, kind),
                folder_id=folder.id if folder is not None else None,
                folder_name=folder.name if folder else sorting.folder_name(kind, ctx.locale),
            )
        )
    return OrganizePlan(
        course_id=course.id, program_id=course.program_id, moves=moves, left=len(rows) - len(moves)
    )


@capability(
    name="files.organization.start",
    summary="Work out how to sort a course's unsorted files into type folders.",
    description="""Starts a job that gives each file at the top level or in "Course materials" a
type (lectures, past exams...) and the folder it would go in. Nothing is moved: the user reviews
the plan (`files.organization.get`) and applies it (`files.organization.apply`).""",
    effect="write",
    http=Http("POST", "/courses/{course_id}/files:organize"),
    expose=("http",),
    tags=("files",),
)
async def organization_start(ctx: Ctx, inp: OrganizeInput) -> JobOut:
    await academics.get_course_row(ctx, inp.course_id)
    job = await enqueue(ctx, KIND, inp, dedupe_key=f"{KIND}:{inp.course_id}")
    return JobOut.of(job)


@capability(
    name="files.organization.get",
    summary="The plan an organizing job worked out.",
    description="""Where each file would go, once the job of `files.organization.start` has
finished.""",
    effect="read",
    http=Http("GET", "/courses/{course_id}/files:organize/{job_id}"),
    expose=("http",),
    tags=("files",),
)
async def organization_get(ctx: Ctx, inp: OrganizeRef) -> OrganizePlan:
    job = await ctx.db.scalar(
        select(CoreJob).where(
            CoreJob.id == inp.job_id, CoreJob.user_id == ctx.user_id, CoreJob.kind == KIND
        )
    )
    if job is None or job.result is None or job.payload.get("course_id") != inp.course_id:
        raise not_found("job", inp.job_id)
    return OrganizePlan.model_validate(job.result)


@capability(
    name="files.organization.apply",
    summary="Move a course's files into their type folders.",
    description="""Applies the moves of a plan the user kept: each file goes in its type's
folder, which is made when the course has none. Files gone since the plan are skipped.""",
    effect="write",
    http=Http("POST", "/courses/{course_id}/files:organize-apply"),
    expose=("http",),
    tags=("files",),
)
async def organization_apply(ctx: Ctx, inp: OrganizeApplyInput) -> OrganizeApplied:
    await academics.get_course_row(ctx, inp.course_id)
    present = {r.id for r in await service.find_items(ctx, [m.item_id for m in inp.moves])}
    by_type: dict[MaterialType, list[str]] = defaultdict(list)
    for move in inp.moves:
        if move.item_id in present and move.type != "general":
            by_type[move.type].append(move.item_id)
    known = await sorting.type_folders(ctx, inp.course_id)
    moved = 0
    for kind, item_ids in by_type.items():
        folder_id = await sorting.make_folder(ctx, inp.course_id, kind, known)
        moved += await service.move_entries(ctx, inp.course_id, item_ids, [], folder_id)
    return OrganizeApplied(moved=moved)
