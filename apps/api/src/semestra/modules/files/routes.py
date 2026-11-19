"""Upload, download and page images (M07 §5): routes that are not capabilities."""

import json
import re
import stat
import zlib
from collections.abc import AsyncIterable, AsyncIterator
from datetime import datetime
from functools import cache
from pathlib import Path as FsPath
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, Path, Query, Request, UploadFile
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import select
from stream_zip import ZIP_64, Method, async_stream_zip

from semestra.core.context import DEFAULT_LOCALE, SUPPORTED_LOCALES, Ctx, get_ctx, run_after_commit
from semestra.core.errors import AppError, ErrorResponse, not_found
from semestra.core.storage import CHUNK_SIZE, get_storage
from semestra.modules.academics import service as academics
from semestra.modules.files import content as files_content
from semestra.modules.files import entries, items, service
from semestra.modules.files.models import FilesDocumentPage
from semestra.modules.files.parse.detect import INLINE_SAFE
from semestra.modules.files.schemas import UploadResult
from semestra.modules.files.upload import MAX_FILES_PER_REQUEST

router = APIRouter(tags=["files"])
CurrentCtx = Annotated[Ctx, Depends(get_ctx)]
_RANGE = re.compile(r"bytes=(\d*)-(\d*)")
_TEXTS = FsPath(__file__).resolve().parent / "texts"


async def _read(file: UploadFile) -> AsyncIterator[bytes]:
    while chunk := await file.read(CHUNK_SIZE):
        yield chunk


@router.post(
    "/courses/{course_id}/files",
    operation_id="filesUpload",
    response_model=UploadResult,
    responses={"default": {"model": ErrorResponse}},
    summary="Upload one or more files into a course.",
)
async def upload(
    course_id: Annotated[str, Path(description="Course id")],
    files: Annotated[list[UploadFile], File(description="The files to upload")],
    ctx: CurrentCtx,
    folder_id: Annotated[str | None, Form(description="Folder to put them in")] = None,
) -> UploadResult:
    """All or nothing: if one file is refused (too large, over quota) none is kept."""
    if not files or len(files) > MAX_FILES_PER_REQUEST:
        raise AppError("common.validation", 422, errors=[{"loc": ["files"], "code": "count"}])
    folder = folder_id or None
    await items.check_upload_target(ctx, course_id, folder)
    staged: list[items.StagedFile] = []
    try:
        # Every file is in storage before the first row is written, so the database's write
        # lock is held only for the inserts, not while the bytes arrive.
        for file in files:
            reserved = sum(f.stored.size for f in staged)
            staged.append(
                await items.stage_file(
                    ctx, filename=file.filename, stream=_read(file), reserved=reserved
                )
            )
        rows = await items.add_staged_files(ctx, course_id, folder, staged)
        result = UploadResult(items=await service.item_outs(ctx, rows))
        await ctx.db.commit()
    except BaseException:
        await ctx.db.rollback()
        for file in staged:
            await get_storage(ctx).delete(file.stored.key)
        raise
    await run_after_commit(ctx)
    return result


def _content_disposition(disposition: str, name: str) -> str:
    ascii_name = re.sub(r'[^\x20-\x7e]|["\\]', "_", name) or "file"
    return f"{disposition}; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(name, safe='')}"


def _byte_range(header: str | None, size: int) -> tuple[int, int] | None:
    """`(start, end)` inclusive for a single `bytes=` range; None means the whole file."""
    if not header:
        return None
    match = _RANGE.fullmatch(header.strip())
    if match is None or (not match[1] and not match[2]):
        return None
    if not match[1]:  # the last N bytes
        length = int(match[2])
        if length == 0 or size == 0:
            raise AppError("common.validation", 416, errors=[{"loc": ["range"], "code": "range"}])
        return max(0, size - length), size - 1
    start = int(match[1])
    end = min(int(match[2]), size - 1) if match[2] else size - 1
    if start >= size or end < start:
        raise AppError("common.validation", 416, errors=[{"loc": ["range"], "code": "range"}])
    return start, end


@router.get(
    "/files/{item_id}/content",
    operation_id="filesContent",
    response_class=StreamingResponse,
    responses={200: {"content": {"application/octet-stream": {}}}, 206: {}, 304: {}},
    summary="Download or preview a file; supports Range requests and If-None-Match.",
)
async def content(
    item_id: Annotated[str, Path(description="File id")],
    request: Request,
    ctx: CurrentCtx,
    disposition: Annotated[
        str,
        Query(pattern="^(inline|attachment)$", description="inline previews, attachment downloads"),
    ] = "attachment",
) -> Response:
    item = await service.get_item(ctx, item_id)
    if not files_content.has_content(item):
        raise not_found()
    mime = item.mime_type or "application/octet-stream"
    # Anything a browser could run (HTML, SVG, ...) is only ever offered as a download.
    shown = "inline" if disposition == "inline" and mime in INLINE_SAFE else "attachment"
    span = _byte_range(request.headers.get("range"), item.size_bytes)
    headers = {
        "Content-Disposition": _content_disposition(
            shown, entries.download_name(item.display_name, mime)
        ),
        "Accept-Ranges": "bytes",
        "ETag": f'"{files_content.version(item)}"',
        "Cache-Control": "private, no-cache",
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "same-site",
    }
    # Text is shown sandboxed. Browsers refuse to run their PDF viewer in a sandboxed document,
    # and a PDF or image cannot run script of its own, so those only lose the sandbox.
    if mime == "application/pdf":
        pass
    elif mime.startswith("image/"):
        headers["Content-Security-Policy"] = "default-src 'none'"
    else:
        headers["Content-Security-Policy"] = "sandbox; default-src 'none'"
    if not item.storage_key:
        # Read from its source (`content.py`): whole, its length known only as it arrives.
        headers.pop("Accept-Ranges")
        if _matches(request, headers["ETag"]):
            return _not_modified(headers)
        stream = await files_content.open_content(ctx, item)
        await ctx.db.commit()  # what the source wrote on the way (renewed credentials)
        return StreamingResponse(stream, media_type=mime, headers=headers)
    if not span and _matches(request, headers["ETag"]):
        return _not_modified(headers)
    start, end = span if span else (0, max(item.size_bytes - 1, 0))
    length = end - start + 1 if item.size_bytes else 0
    headers["Content-Length"] = str(length)
    if span:
        headers["Content-Range"] = f"bytes {start}-{end}/{item.size_bytes}"
    stream = get_storage(ctx).open(item.storage_key, start=start, length=length)
    return StreamingResponse(
        stream, status_code=206 if span else 200, media_type=mime, headers=headers
    )


# What fits in an address (a Cloudflare tunnel takes up to 16 KB): files and folders by id.
MAX_DOWNLOAD_ENTRIES = 300
_DEFLATE_FAST = lambda: zlib.compressobj(level=1, wbits=-zlib.MAX_WBITS)  # noqa: E731


async def _nothing() -> AsyncIterator[bytes]:
    return
    yield


async def _once(data: bytes) -> AsyncIterator[bytes]:
    yield data


@cache
def _texts(locale: str) -> dict[str, str]:
    """The words of the list a download leaves in the archive (`texts/<locale>.json`): a file the
    user keeps, so rendered here in their language like an email (M00 §3.11)."""
    if locale not in SUPPORTED_LOCALES:
        locale = DEFAULT_LOCALE
    return json.loads((_TEXTS / f"{locale}.json").read_text(encoding="utf-8"))


@router.get(
    "/courses/{course_id}/files:download",
    operation_id="filesDownloadMany",
    response_class=StreamingResponse,
    responses={200: {"content": {"application/zip": {}}}, "default": {"model": ErrorResponse}},
    summary="Download several files and folders of a course as one zip archive.",
)
async def download_many(
    course_id: Annotated[str, Path(description="Course id")],
    ctx: CurrentCtx,
    item_ids: Annotated[
        list[str], Query(max_length=MAX_DOWNLOAD_ENTRIES, description="Files to put in it")
    ] = [],  # noqa: B006 (FastAPI copies query defaults)
    folder_ids: Annotated[
        list[str],
        Query(max_length=MAX_DOWNLOAD_ENTRIES, description="Folders to put in it, whole"),
    ] = [],  # noqa: B006
) -> Response:
    """Links are left out. The archive is written while it is sent: each file is opened (read
    from its source, if it is kept there) when its turn comes. One that cannot be read then (gone
    from its source, the source unreachable) is left out and named in a list at the end of the
    archive, in the user's language; when none can be read the answer is
    `files.download_unavailable` instead of an archive without them. A file that fails halfway
    breaks the download off, so no archive that looks whole is left behind."""
    course = await academics.get_course_row(ctx, course_id)
    picked = await entries.download_entries(ctx, course_id, item_ids, folder_ids)
    if not picked:
        raise not_found()
    state, user_id, now = ctx.state, ctx.user_id, ctx.now.replace(tzinfo=None)
    members = [
        (path, row.id, row.updated_at.replace(tzinfo=None)) if row else (path, None, now)
        for path, row in picked
    ]
    missing: list[str] = []

    async def open_(path: str, item_id: str) -> AsyncIterator[bytes] | None:
        try:
            return await files_content.open_detached(state, user_id, item_id)
        except AppError:
            missing.append(path)
            return None

    # Files are opened until one can be read before the answer starts, so that a download of
    # nothing but unreadable files can fail with an error.
    first: tuple[int, AsyncIterator[bytes]] | None = None
    for i, (path, item_id, _) in enumerate(members):
        if item_id is not None and (stream := await open_(path, item_id)) is not None:
            first = (i, stream)
            break
    if first is None and missing:
        raise AppError("files.download_unavailable", 502)
    texts = _texts(ctx.locale)
    title, intro = texts["missing_list_name"], texts["missing_list_intro"]
    taken = {path.lower() for path, _, _ in members}
    stem, n = title.removesuffix(".txt"), 1
    while title.lower() in taken:
        n += 1
        title = f"{stem} ({n}).txt"

    async def files() -> AsyncIterator[tuple[str, datetime, int, Method, AsyncIterable[bytes]]]:
        for i, (path, item_id, modified) in enumerate(members):
            if item_id is None:
                yield path, modified, stat.S_IFDIR | 0o755, ZIP_64, _nothing()
                continue
            if first is None or i < first[0]:
                continue  # could not be opened above (in `missing` already)
            stream = first[1] if i == first[0] else await open_(path, item_id)
            if stream is not None:
                yield path, modified, 0o644, ZIP_64, stream
        if missing:
            text = intro + "\n\n" + "".join(f"{path}\n" for path in missing)
            yield title, now, 0o644, ZIP_64, _once(text.encode())

    name = f"{course.code or course.title}.zip"
    headers = {
        "Content-Disposition": _content_disposition("attachment", name),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
    }
    return StreamingResponse(
        async_stream_zip(files(), get_compressobj=_DEFLATE_FAST),
        media_type="application/zip",
        headers=headers,
    )


@router.get(
    "/files/{item_id}/pages/{page}.png",
    operation_id="filesPageImage",
    response_class=StreamingResponse,
    responses={200: {"content": {"image/png": {}}}, 304: {}},
    summary="A small image of one page of a processed file.",
)
async def page_image(
    item_id: Annotated[str, Path(description="File id")],
    page: Annotated[int, Path(ge=1, description="Page number, starting at 1")],
    request: Request,
    ctx: CurrentCtx,
) -> Response:
    item = await service.get_item(ctx, item_id)
    if item.active_document_id is None:
        raise not_found()
    key = await ctx.db.scalar(
        select(FilesDocumentPage.image_storage_key).where(
            FilesDocumentPage.document_id == item.active_document_id,
            FilesDocumentPage.page_no == page,
        )
    )
    if not key:
        raise not_found()
    # Tied to the document: after a reprocess the same URL gives the new page, so the browser
    # revalidates instead of keeping the old picture for an hour.
    headers = {
        "ETag": f'"{item.active_document_id}-{page}"',
        "Cache-Control": "private, no-cache",
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "same-site",
    }
    if _matches(request, headers["ETag"]):
        return _not_modified(headers)
    return StreamingResponse(get_storage(ctx).open(key), media_type="image/png", headers=headers)


def _matches(request: Request, etag: str) -> bool:
    wanted = request.headers.get("if-none-match")
    if not wanted:
        return False
    return wanted.strip() == "*" or etag in (
        t.strip().removeprefix("W/") for t in wanted.split(",")
    )


def _not_modified(headers: dict[str, str]) -> Response:
    keep = ("ETag", "Cache-Control", "Content-Disposition")
    return Response(status_code=304, headers={k: v for k, v in headers.items() if k in keep})
