"""Course-level reads (M09 §5): the platform-neutral interface the Canvas tab (M16) and the
agent use. Every read needs a linked course and the provider's feature; HTML is cleaned before
it is cached, so cache hits are clean too."""

from collections.abc import AsyncIterator
from datetime import datetime
from typing import Any

from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.modules.lms import cache, html, service
from semestra.modules.lms.models import LmsImportedRef
from semestra.modules.lms.schemas.dto import (
    FileMeta,
    FolderListing,
    LmsFeature,
    PageDetail,
    RichText,
    SubmissionDetail,
)
from semestra.modules.lms.schemas.io import (
    AnnouncementList,
    AssignmentList,
    CourseOverview,
    FileList,
    GradeList,
    ModuleItemList,
    ModuleList,
    PageList,
    QuizList,
)
from semestra.modules.lms.service import Bound


async def _read(
    ctx: Ctx,
    course_id: str,
    feature: LmsFeature,
    method: str,
    params: dict[str, Any],
    fetch: Any,
    *,
    refresh: bool,
) -> tuple[Any, bool, Bound, str]:
    link, b = await service.require_link(ctx, course_id)
    service.require_feature(b, feature)
    ext = link.external_course_id
    data, truncated = await service.cached(
        ctx, b, method, {"course": ext, **params}, lambda i: fetch(b, i, ext), refresh=refresh
    )
    return data, truncated, b, ext


def _cleaned(b: Bound, items: list[Any], field: str = "html") -> list[Any]:
    for item in items:
        setattr(item, field, b.clean(getattr(item, field)))
        _lock_text(item)
    return items


def _lock_text(item: Any) -> Any:
    """Lock explanations come as HTML fragments ("…the module <b>Week 2</b>…"): shown as text."""
    if getattr(item, "lock_explanation", None):
        item.lock_explanation = html.to_text(item.lock_explanation)
    return item


async def overview(ctx: Ctx, course_id: str, refresh: bool) -> CourseOverview:
    link, b = await service.require_link(ctx, course_id)
    ext = link.external_course_id

    async def fetch(i: Any) -> dict[str, Any]:
        course = await b.provider.get_course(i, b.cfg, b.creds, ext)
        nav = (
            await b.provider.navigation(i, b.cfg, b.creds, ext)
            if "navigation" in b.provider.features
            else []
        )
        return {
            "course": course.model_dump(mode="json"),
            "navigation": [t.model_dump(mode="json") for t in nav],
        }

    data, truncated = await service.cached(
        ctx, b, "overview", {"course": ext}, fetch, refresh=refresh
    )
    return CourseOverview.model_validate(
        {
            "link": service.link_out(link, b.row.provider),
            "provider": b.row.provider,
            "provider_name": b.provider.display_name,
            "features": sorted(b.provider.features),
            "course": data["course"],
            "navigation": data["navigation"],
            "default_view": data["course"].get("default_view"),
            "truncated": truncated,
        }
    )


async def announcements(
    ctx: Ctx, course_id: str, since: datetime | None, refresh: bool
) -> AnnouncementList:
    async def fetch(b: Bound, i: Any, ext: str) -> Any:
        items = await b.provider.announcements(i, b.cfg, b.creds, ext, since=since)
        return _cleaned(b, items)

    params = {"since": since.isoformat() if since else None}
    data, truncated, *_ = await _read(
        ctx, course_id, "announcements", "announcements", params, fetch, refresh=refresh
    )
    return AnnouncementList.model_validate({"items": data, "truncated": truncated})


async def imported_targets(ctx: Ctx, link_id: str) -> dict[str, list[dict[str, str]]]:
    refs = await ctx.db.scalars(
        select(LmsImportedRef).where(
            LmsImportedRef.link_id == link_id, LmsImportedRef.external_kind == "assignment"
        )
    )
    out: dict[str, list[dict[str, str]]] = {}
    for ref in refs:
        out.setdefault(ref.external_id, []).append({"kind": ref.target_kind, "id": ref.target_id})
    return out


async def raw_assignments(
    ctx: Ctx, course_id: str, refresh: bool
) -> tuple[list[dict[str, Any]], bool]:
    async def fetch(b: Bound, i: Any, ext: str) -> Any:
        return _cleaned(b, await b.provider.assignments(i, b.cfg, b.creds, ext))

    data, truncated, *_ = await _read(
        ctx, course_id, "assignments", "assignments", {}, fetch, refresh=refresh
    )
    return data, truncated


async def assignments(ctx: Ctx, course_id: str, refresh: bool) -> AssignmentList:
    data, truncated = await raw_assignments(ctx, course_id, refresh)
    link, _ = await service.require_link(ctx, course_id)
    targets = await imported_targets(ctx, link.id)
    items = [{**a, "imported_as": targets.get(a["external_id"], [])} for a in data]
    return AssignmentList.model_validate({"items": items, "truncated": truncated})


async def grades(ctx: Ctx, course_id: str, refresh: bool) -> GradeList:
    async def fetch(b: Bound, i: Any, ext: str) -> Any:
        return await b.provider.grades(i, b.cfg, b.creds, ext)

    data, truncated, *_ = await _read(
        ctx, course_id, "grades", "grades", {}, fetch, refresh=refresh
    )
    return GradeList.model_validate({"items": data, "truncated": truncated})


async def modules(ctx: Ctx, course_id: str, refresh: bool) -> ModuleList:
    async def fetch(b: Bound, i: Any, ext: str) -> Any:
        return await b.provider.modules(i, b.cfg, b.creds, ext)

    data, truncated, *_ = await _read(
        ctx, course_id, "modules", "modules", {}, fetch, refresh=refresh
    )
    return ModuleList.model_validate({"items": data, "truncated": truncated})


async def module_items(ctx: Ctx, course_id: str, module_id: str, refresh: bool) -> ModuleItemList:
    async def fetch(b: Bound, i: Any, ext: str) -> Any:
        return [
            _lock_text(item)
            for item in await b.provider.module_items(i, b.cfg, b.creds, ext, module_id)
        ]

    data, truncated, *_ = await _read(
        ctx, course_id, "modules", "module_items", {"module": module_id}, fetch, refresh=refresh
    )
    return ModuleItemList.model_validate({"items": data, "truncated": truncated})


async def pages(ctx: Ctx, course_id: str, refresh: bool) -> PageList:
    async def fetch(b: Bound, i: Any, ext: str) -> Any:
        return await b.provider.pages(i, b.cfg, b.creds, ext)

    data, truncated, *_ = await _read(ctx, course_id, "pages", "pages", {}, fetch, refresh=refresh)
    return PageList.model_validate({"items": data, "truncated": truncated})


async def page(ctx: Ctx, course_id: str, ref: str, refresh: bool) -> PageDetail:
    async def fetch(b: Bound, i: Any, ext: str) -> Any:
        detail = await b.provider.page(i, b.cfg, b.creds, ext, ref)
        detail.html = b.clean(detail.html)
        return _lock_text(detail)

    data, *_ = await _read(ctx, course_id, "pages", "page", {"ref": ref}, fetch, refresh=refresh)
    return PageDetail.model_validate(data)


async def quizzes(ctx: Ctx, course_id: str, refresh: bool) -> QuizList:
    async def fetch(b: Bound, i: Any, ext: str) -> Any:
        return _cleaned(b, await b.provider.quizzes(i, b.cfg, b.creds, ext))

    data, truncated, *_ = await _read(
        ctx, course_id, "quizzes", "quizzes", {}, fetch, refresh=refresh
    )
    return QuizList.model_validate({"items": data, "truncated": truncated})


async def syllabus(ctx: Ctx, course_id: str, refresh: bool) -> RichText:
    async def fetch(b: Bound, i: Any, ext: str) -> Any:
        text = await b.provider.syllabus(i, b.cfg, b.creds, ext)
        text.html = b.clean(text.html)
        return text

    data, *_ = await _read(ctx, course_id, "syllabus", "syllabus", {}, fetch, refresh=refresh)
    return RichText.model_validate(data)


async def file(ctx: Ctx, course_id: str, file_id: str, refresh: bool) -> FileMeta:
    async def fetch(b: Bound, i: Any, ext: str) -> Any:
        return await b.provider.file(i, b.cfg, b.creds, ext, file_id)

    data, *_ = await _read(
        ctx, course_id, "files", "file", {"file": file_id}, fetch, refresh=refresh
    )
    return FileMeta.model_validate(data)


async def open_file(
    ctx: Ctx, course_id: str, file_id: str
) -> tuple[FileMeta, AsyncIterator[bytes]]:
    """Metadata plus a byte stream that keeps its own HTTP client open until it is consumed or
    closed. Errors before the first byte (forbidden, blocked redirect) are raised here."""
    link, b = await service.require_link(ctx, course_id)
    service.require_feature(b, "files")
    ext = link.external_course_id
    meta, _ = await service.call(ctx, b, lambda i: b.provider.file(i, b.cfg, b.creds, ext, file_id))

    from semestra.core.http import safe_client
    from semestra.modules.lms.providers import Io

    client = safe_client(ctx.settings)
    stream = b.provider.open_file(
        Io(client=client, settings=ctx.settings), b.cfg, b.creds, ext, file_id
    )
    try:
        first = await anext(stream)
    except StopAsyncIteration:
        first = b""
    except BaseException:
        await client.aclose()
        raise

    async def chunks() -> AsyncIterator[bytes]:
        try:
            if first:
                yield first
            async for chunk in stream:
                yield chunk
        finally:
            await stream.aclose()  # pyright: ignore[reportAttributeAccessIssue]
            await client.aclose()

    return meta, chunks()


async def submission(
    ctx: Ctx, course_id: str, assignment_id: str, refresh: bool
) -> SubmissionDetail:
    async def fetch(b: Bound, i: Any, ext: str) -> Any:
        return await b.provider.submission(i, b.cfg, b.creds, ext, assignment_id)

    data, *_ = await _read(
        ctx,
        course_id,
        "submissions",
        "submission",
        {"assignment": assignment_id},
        fetch,
        refresh=refresh,
    )
    return SubmissionDetail.model_validate(data)


async def folder(ctx: Ctx, course_id: str, folder_id: str | None, refresh: bool) -> FolderListing:
    async def fetch(b: Bound, i: Any, ext: str) -> Any:
        return await b.provider.folder(i, b.cfg, b.creds, ext, folder_id)

    data, truncated, *_ = await _read(
        ctx, course_id, "folders", "folder", {"folder": folder_id}, fetch, refresh=refresh
    )
    return FolderListing.model_validate({**data, "truncated": truncated})


async def search_files(ctx: Ctx, course_id: str, term: str, refresh: bool) -> FileList:
    async def fetch(b: Bound, i: Any, ext: str) -> Any:
        return await b.provider.search_files(i, b.cfg, b.creds, ext, term)

    data, truncated, *_ = await _read(
        ctx, course_id, "folders", "file_search", {"term": term}, fetch, refresh=refresh
    )
    return FileList.model_validate({"items": data, "truncated": truncated})


# --- writes ---------------------------------------------------------------------------------


async def mark_announcement_read(ctx: Ctx, course_id: str, announcement_id: str) -> None:
    """Marks it read on the platform when the user allows writes (M09 设置 `lms.allow_writes`).
    The cached list is dropped (not rewritten, which would extend its 5 minutes); the app updates
    its own copy."""
    link, b = await service.require_link(ctx, course_id)
    await service.require_write(ctx, b, "mark_read")
    ext = link.external_course_id
    await service.call(
        ctx,
        b,
        lambda i: b.provider.mark_announcement_read(i, b.cfg, b.creds, ext, announcement_id),
    )
    key = cache.cache_key(ctx.user_id, b.row.id, "announcements", {"course": ext, "since": None})
    await cache.drop(ctx, key)
