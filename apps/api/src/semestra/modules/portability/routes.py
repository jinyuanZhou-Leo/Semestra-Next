"""Backup upload and download (M13 §6): files, not JSON, so plain routes."""

from typing import Annotated

from fastapi import APIRouter, Depends, UploadFile
from fastapi.responses import StreamingResponse

from semestra.core.context import Ctx, get_ctx, run_after_commit
from semestra.modules.portability import service
from semestra.modules.portability.schemas import ImportOut

router = APIRouter(tags=["portability"])


@router.post(
    "/me/imports",
    operation_id="portabilityImportUpload",
    response_model=ImportOut,
    summary="Upload a backup file and get its preview.",
)
async def import_upload(file: UploadFile, ctx: Annotated[Ctx, Depends(get_ctx)]) -> ImportOut:
    out = await service.upload(ctx, file)
    await ctx.db.commit()
    await run_after_commit(ctx)
    return out


@router.get(
    "/me/exports/{export_id}/download",
    operation_id="portabilityExportDownload",
    response_class=StreamingResponse,
    responses={200: {"content": {"application/zip": {}}}},
)
async def export_download(
    export_id: str, ctx: Annotated[Ctx, Depends(get_ctx)]
) -> StreamingResponse:
    stream, filename, size = await service.export_download(ctx, export_id)
    return StreamingResponse(
        stream,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(size),
            "Cache-Control": "no-store",
        },
    )
