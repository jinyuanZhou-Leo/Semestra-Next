"""M13 capabilities: HTTP only, never offered to the assistant or MCP clients (M13 §6)."""

from pydantic import BaseModel

from semestra.core.capability import Http, NoInput, capability
from semestra.core.context import Ctx
from semestra.core.jobs import JobOut
from semestra.modules.portability import service
from semestra.modules.portability.schemas import (
    AccountDeleteInput,
    DataCounts,
    ExportList,
    ExportOut,
    ExportStartInput,
    ImportOut,
    ImportRef,
    ImportStartInput,
)

HTTP_ONLY = ("http",)
TAGS = ("portability",)


class Discarded(BaseModel):
    id: str


@capability(
    name="portability.data_count.get",
    summary="Count the user's data: rows per table, for the data settings overview.",
    description="Only tables a backup covers. Not for agents.",
    effect="read",
    http=Http("GET", "/me/data-counts"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def counts_get(ctx: Ctx, inp: NoInput) -> DataCounts:
    del inp
    return await service.data_counts(ctx)


@capability(
    name="portability.export.start",
    summary="Start exporting the user's data to a backup file.",
    description="Runs as a background job; the file can be downloaded for 24 hours.",
    effect="write",
    http=Http("POST", "/me/exports"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def export_start(ctx: Ctx, inp: ExportStartInput) -> ExportOut:
    return await service.start_export(ctx, inp.include_files)


@capability(
    name="portability.export.list",
    summary="List the user's recent exports and whether they can be downloaded.",
    description="Newest first; expired exports are left out.",
    effect="read",
    http=Http("GET", "/me/exports"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def export_list(ctx: Ctx, inp: NoInput) -> ExportList:
    return ExportList(items=await service.list_exports(ctx))


@capability(
    name="portability.import.get",
    summary="Get an uploaded backup: its preview, and the import's state and report.",
    description="Not for agents.",
    effect="read",
    http=Http("GET", "/me/imports/{id}"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def import_get(ctx: Ctx, inp: ImportRef) -> ImportOut:
    return await service.get_import(ctx, inp.id)


@capability(
    name="portability.import.start",
    summary="Import an uploaded backup, merging it or replacing the current data.",
    description="Runs as a background job in one transaction. Not for agents.",
    effect="destructive",
    http=Http("POST", "/me/imports/{id}:start"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def import_start(ctx: Ctx, inp: ImportStartInput) -> ImportOut:
    return await service.start_import(ctx, inp)


@capability(
    name="portability.import.discard",
    summary="Discard an uploaded backup without importing it.",
    description="Not for agents.",
    effect="write",
    http=Http("DELETE", "/me/imports/{id}"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def import_discard(ctx: Ctx, inp: ImportRef) -> Discarded:
    await service.discard_import(ctx, inp.id)
    return Discarded(id=inp.id)


@capability(
    name="account.delete",
    summary="Delete the user's account and all of their data.",
    description="""Irreversible. Signs out everywhere at once; the data is deleted by a
background job. Not for agents.""",
    effect="destructive",
    http=Http("POST", "/me:delete"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def account_delete(ctx: Ctx, inp: AccountDeleteInput) -> JobOut:
    return await service.delete_account(ctx, inp)
