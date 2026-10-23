"""Course-level reads (M09 §5): the platform-neutral interface the Canvas tab (M16) and the
agent use. Every read needs a linked course and the provider's feature; HTML is cleaned before
it is cached, so cache hits are clean too."""

from collections.abc import AsyncIterator
from datetime import datetime
from typing import Any

from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules.academics import service as academics
from semestra.modules.lms import cache, html, service
from semestra.modules.lms.models import LmsCourseLink, LmsImportedRef
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
    TermAnnouncement,
    TermAnnouncementList,
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
    linked: tuple[LmsCourseLink, Bound] | None = None,
) -> tuple[Any, bool, LmsCourseLink, Bound]:
    """One course read through the cache (scoped to the course, so "Refresh" drops it).
    `linked` is the course's link when the caller looked it up already."""
    link, b = linked or await service.require_link(ctx, course_id)
    service.require_feature(b, feature)
    ext = link.external_course_id
    data, truncated = await service.cached(
        ctx,
        b,
        method,
        {"course": ext, **params},
        lambda i: fetch(b, i, ext),
        refresh=refresh,
        scope=cache.course_scope(ext),
    )
    return data, truncated, link, b


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
        ctx, b, "overview", {"course": ext}, fetch, refresh=refresh, scope=cache.course_scope(ext)
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


def _announcement_params(since: datetime | None) -> dict[str, Any]:
    return {"since": since.isoformat() if since else None}


async def announcements(
    ctx: Ctx, course_id: str, since: datetime | None, refresh: bool
) -> AnnouncementList:
    async def fetch(b: Bound, i: Any, ext: str) -> Any:
        items = await b.provider.announcements(i, b.cfg, b.creds, [ext], since=since)
        return _cleaned(b, items)

    data, truncated, *_ = await _read(
        ctx,
        course_id,
        "announcements",
        "announcements",
        _announcement_params(since),
        fetch,
        refresh=refresh,
    )
    return AnnouncementList.model_validate({"items": data, "truncated": truncated})


async def term_announcements(ctx: Ctx, term_id: str, refresh: bool) -> TermAnnouncementList:
    """Every linked course of a term at once (the term board's card): one platform request per
    connection for the courses the cache can't answer, stored per course, so each course's own
    list and "mark read" stay in step with it."""
    term = await academics.get_term_row(ctx, term_id)
    links = await service.program_links(ctx, term.program_id)
    program = await academics.get_program_row(ctx, term.program_id)
    rows = await academics.courses_by_id(ctx, [li.course_id for li in links])
    in_term = {
        c.id for c in await academics.courses_out(ctx, program, rows) if term_id in c.term_ids
    }
    links = [li for li in links if li.course_id in in_term]
    params = _announcement_params(None)
    items: list[TermAnnouncement] = []
    truncated = False
    failed: AppError | None = None
    by_connection: dict[str, list[LmsCourseLink]] = {}
    for link in links:
        by_connection.setdefault(link.connection_id, []).append(link)
    for connection_id, group in by_connection.items():
        try:
            b = await service.bound(ctx, await service.get_connection_row(ctx, connection_id))
            service.require_feature(b, "announcements")
        except AppError:
            continue  # credentials gone, platform without announcements: its courses are left out
        found: dict[str, list[Any]] = {}
        missing: list[LmsCourseLink] = []
        for link in group:
            ext = link.external_course_id
            key = cache.cache_key(ctx.user_id, b.row.id, "announcements", {"course": ext, **params})
            hit = None if refresh else await cache.get(ctx, key)
            if hit is None:
                missing.append(link)
            else:
                found[link.course_id] = hit["data"]
                truncated |= bool(hit["truncated"])
        if missing:
            exts = [li.external_course_id for li in missing]
            try:
                fetched, cut = await service.call(
                    ctx,
                    b,
                    lambda i, b=b, exts=exts: b.provider.announcements(i, b.cfg, b.creds, exts),
                )
            except AppError as exc:
                # One connection down must not hide the others' announcements.
                failed = exc
                missing = []
                fetched, cut = [], False
            truncated |= cut
            dumped = [a.model_dump(mode="json") for a in _cleaned(b, fetched)]
            for link in missing:
                ext = link.external_course_id
                mine = [a for a in dumped if a["external_course_id"] == ext]
                key = cache.cache_key(
                    ctx.user_id, b.row.id, "announcements", {"course": ext, **params}
                )
                await cache.put(
                    ctx,
                    key,
                    b.row.id,
                    {"data": mine, "truncated": cut},
                    scope=cache.course_scope(ext),
                )
                found[link.course_id] = mine
        for course_id, data in found.items():
            items += [TermAnnouncement.model_validate({**a, "course_id": course_id}) for a in data]
    if failed is not None and not items:
        raise failed  # nothing to show: the card shows the error, not "no announcements"
    items.sort(key=lambda a: a.posted_at.timestamp() if a.posted_at else 0, reverse=True)
    return TermAnnouncementList(
        items=items, linked_course_ids=sorted(li.course_id for li in links), truncated=truncated
    )


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
    ctx: Ctx,
    course_id: str,
    refresh: bool,
    *,
    linked: tuple[LmsCourseLink, Bound] | None = None,
) -> tuple[list[dict[str, Any]], bool]:
    async def fetch(b: Bound, i: Any, ext: str) -> Any:
        return _cleaned(b, await b.provider.assignments(i, b.cfg, b.creds, ext))

    data, truncated, *_ = await _read(
        ctx, course_id, "assignments", "assignments", {}, fetch, refresh=refresh, linked=linked
    )
    return data, truncated


async def assignments(ctx: Ctx, course_id: str, refresh: bool) -> AssignmentList:
    linked = await service.require_link(ctx, course_id)
    data, truncated = await raw_assignments(ctx, course_id, refresh, linked=linked)
    targets = await imported_targets(ctx, linked[0].id)
    items = [{**a, "imported_as": targets.get(a["external_id"], [])} for a in data]
    return AssignmentList.model_validate({"items": items, "truncated": truncated})


async def grades(ctx: Ctx, course_id: str, refresh: bool) -> GradeList:
    """The course total from the platform, then one row per assignment built from the cached
    assignment list (its submissions carry the scores): the platform is not asked twice."""

    async def fetch(b: Bound, i: Any, ext: str) -> Any:
        return await b.provider.grade_totals(i, b.cfg, b.creds, ext)

    linked = await service.require_link(ctx, course_id)
    totals, truncated, *_ = await _read(
        ctx, course_id, "grades", "grade_totals", {}, fetch, refresh=refresh, linked=linked
    )
    listed, cut = await raw_assignments(ctx, course_id, refresh, linked=linked)
    rows = [
        {
            "external_id": a["external_id"],
            "web_url": a.get("web_url"),
            "raw_kind": "submission",
            "name": a["name"],
            "score": (a.get("submission") or {}).get("score"),
            "points_possible": a.get("points"),
            "grade": (a.get("submission") or {}).get("grade"),
            "group_name": a.get("group_name"),
            "graded_at": (a.get("submission") or {}).get("graded_at"),
        }
        for a in listed
    ]
    return GradeList.model_validate({"items": [*totals, *rows], "truncated": truncated or cut})


async def modules(ctx: Ctx, course_id: str, refresh: bool) -> ModuleList:
    async def fetch(b: Bound, i: Any, ext: str) -> Any:
        found = await b.provider.modules(i, b.cfg, b.creds, ext)
        for module in found:
            for item in module.items or []:
                _lock_text(item)
        return found

    data, truncated, *_ = await _read(
        ctx, course_id, "modules", "modules", {}, fetch, refresh=refresh
    )
    return ModuleList.model_validate({"items": data, "truncated": truncated})


async def module_items(ctx: Ctx, course_id: str, module_id: str, refresh: bool) -> ModuleItemList:
    linked = await service.require_link(ctx, course_id)
    link, b = linked
    service.require_feature(b, "modules")
    if not refresh:
        # The module list usually came with its items: no platform request for them.
        key = cache.cache_key(ctx.user_id, b.row.id, "modules", {"course": link.external_course_id})
        hit = await cache.get(ctx, key)
        for module in (hit or {}).get("data", []):
            if module.get("external_id") == module_id and module.get("items") is not None:
                return ModuleItemList.model_validate({"items": module["items"], "truncated": False})

    async def fetch(b: Bound, i: Any, ext: str) -> Any:
        return [
            _lock_text(item)
            for item in await b.provider.module_items(i, b.cfg, b.creds, ext, module_id)
        ]

    data, truncated, *_ = await _read(
        ctx,
        course_id,
        "modules",
        "module_items",
        {"module": module_id},
        fetch,
        refresh=refresh,
        linked=linked,
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


async def file(
    ctx: Ctx,
    course_id: str,
    file_id: str,
    refresh: bool,
    *,
    linked: tuple[LmsCourseLink, Bound] | None = None,
) -> FileMeta:
    async def fetch(b: Bound, i: Any, ext: str) -> Any:
        return await b.provider.file(i, b.cfg, b.creds, ext, file_id)

    data, *_ = await _read(
        ctx, course_id, "files", "file", {"file": file_id}, fetch, refresh=refresh, linked=linked
    )
    return FileMeta.model_validate(data)


async def open_file(
    ctx: Ctx,
    course_id: str,
    file_id: str,
    *,
    meta: FileMeta | None = None,
    linked: tuple[LmsCourseLink, Bound] | None = None,
) -> tuple[FileMeta, AsyncIterator[bytes]]:
    """Metadata plus a byte stream that keeps its own HTTP client open until it is consumed or
    closed. Errors before the first byte (forbidden, blocked redirect) are raised here. The
    metadata (with the download address) comes from the cache unless the caller has it."""
    linked = linked or await service.require_link(ctx, course_id)
    link, b = linked
    service.require_feature(b, "files")
    ext = link.external_course_id
    if meta is None:
        # A cached address is fine: Canvas's download URL carries the file's own verifier, which
        # does not expire, and the request is sent with the user's token anyway.
        meta = await file(ctx, course_id, file_id, refresh=False, linked=linked)

    from semestra.core.http import safe_client
    from semestra.modules.lms.providers import Io

    client = safe_client(ctx.settings)
    stream = b.provider.open_file(
        Io(client=client, settings=ctx.settings), b.cfg, b.creds, ext, meta
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
    params = {"course": ext, **_announcement_params(None)}
    await cache.drop(ctx, cache.cache_key(ctx.user_id, b.row.id, "announcements", params))


async def refresh_course(ctx: Ctx, course_id: str) -> None:
    """Forgets everything cached about one course ("Refresh" in the Canvas tab), and the
    calendar of its connection; the next reads ask the platform."""
    link, b = await service.require_link(ctx, course_id)
    await cache.drop_scope(ctx, b.row.id, cache.course_scope(link.external_course_id))
    await cache.drop_scope(ctx, b.row.id, cache.CALENDAR_SCOPE)
