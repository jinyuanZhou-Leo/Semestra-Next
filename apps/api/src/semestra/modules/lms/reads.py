"""Course-level reads (M09 §5): the platform-neutral interface the Canvas tab (M16) and the
agent use. Every read needs a linked course and the provider's feature; HTML is cleaned before
it is cached, so cache hits are clean too."""

import asyncio
from collections.abc import AsyncGenerator, AsyncIterator, Sequence
from datetime import datetime, timedelta, tzinfo
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules.academics import service as academics
from semestra.modules.lms import answers, cache, html, rules, service
from semestra.modules.lms.answers import STOPPING
from semestra.modules.lms.errors import lms_error
from semestra.modules.lms.models import LmsCourseLink, LmsImportedRef
from semestra.modules.lms.schemas.dto import (
    DiscussionDetail,
    FileMeta,
    FolderListing,
    LmsFeature,
    NavKind,
    PageDetail,
    RichText,
    SubmissionDetail,
)
from semestra.modules.lms.schemas.io import (
    CourseOverview,
    FileList,
    ModuleItemList,
    ModuleList,
    PageList,
    QuizList,
)
from semestra.modules.lms.service import Bound

# Platform requests one `read_many` runs at once.
MANY_CONCURRENCY = 4
# Page texts read for the assistant's search stay longer than other reads: a course has dozens
# of pages, which rarely change. One whose last change is in the key stays until it changes (the
# key changes with it); one known only from a module (the pages list hidden) for an hour.
# `refresh` reads them again.
PAGE_TEXT_KEPT = timedelta(days=14)
PAGE_TEXT_TTL = timedelta(hours=1)


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
    area: NavKind | None = None,
) -> tuple[Any, bool, LmsCourseLink, Bound]:
    """One course read through the cache (scoped to the course, so "Refresh" drops it).
    `linked` is the course's link when the caller looked it up already. `area` marks a read of a
    whole area (the pages, the quizzes...): the platform refusing it means the instructor hid
    that area (`lms.area_hidden`), not that something is missing."""
    link, b = linked or await service.require_link(ctx, course_id)
    service.require_feature(b, feature)
    ext = link.external_course_id
    try:
        data, truncated = await service.cached(
            ctx,
            b,
            method,
            {"course": ext, **params},
            lambda i: fetch(b, i, ext),
            refresh=refresh,
            scope=cache.course_scope(ext),
        )
    except AppError as exc:
        if area is not None and exc.code not in STOPPING:
            closed = await _nav_closed(ctx, course_id, area, refresh=refresh)
            if b.provider.area_answer(exc, nav_closed=closed) == "hidden":
                raise lms_error("lms.area_hidden", area=area) from None
        raise
    return data, truncated, link, b


async def _nav_closed(ctx: Ctx, course_id: str, area: NavKind, *, refresh: bool) -> bool | None:
    """Whether the course's menu leaves `area` out or hides it (None: no menu to tell by): only
    then is a refused list of it the instructor's doing (M09 table 2, rows 7-8). A course gone
    from the platform, or a user no longer enrolled, is refused too, and keeps its own error."""
    try:
        found = await overview(ctx, course_id, refresh)
    except AppError as exc:
        if exc.code in STOPPING:
            raise  # about the connection, not the course: the read fails with it
        return None
    if "navigation" not in found.features:
        return None
    return answers.nav_closed(found.navigation, area)


async def course_zone(ctx: Ctx, course_id: str) -> tzinfo:
    course = await academics.get_course_row(ctx, course_id)
    return ZoneInfo((await academics.get_program_row(ctx, course.program_id)).timezone)


def aware(value: datetime | None, zone: tzinfo) -> datetime | None:
    """A time the caller gave without an offset ("2026-11-01") is read in the Program's zone."""
    if value is None:
        return None
    return value.replace(tzinfo=zone) if value.tzinfo is None else value


def _cleaned(b: Bound, items: list[Any], course: str | None, field: str = "html") -> list[Any]:
    """Cleans each item's HTML; `course` is the platform course, else each item's own."""
    for item in items:
        own = course or getattr(item, "external_course_id", None) or None
        setattr(item, field, b.clean(getattr(item, field), item.web_url, own))
        lock_text(item)
    return items


def lock_text(item: Any) -> Any:
    """Lock explanations come as HTML fragments ("…the module <b>Week 2</b>…"): shown as text."""
    if getattr(item, "lock_explanation", None):
        item.lock_explanation = html.to_text(item.lock_explanation)
    return item


async def overview(ctx: Ctx, course_id: str, refresh: bool) -> CourseOverview:
    link, b = await service.require_link(ctx, course_id)
    ext = link.external_course_id

    async def fetch(i: Any) -> dict[str, Any]:
        async def navigation() -> list[Any]:
            if "navigation" not in b.provider.features:
                return []
            return list(await b.provider.navigation(i, b.cfg, b.creds, ext))

        course, nav = await asyncio.gather(
            b.provider.get_course(i, b.cfg, b.creds, ext), navigation()
        )
        return {
            "course": course.model_dump(mode="json"),
            "navigation": [t.model_dump(mode="json") for t in nav],
            "fetched_at": ctx.now.isoformat(),
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
            "fetched_at": data.get("fetched_at"),
            "truncated": truncated,
        }
    )


async def imported_targets(ctx: Ctx, link_id: str) -> dict[str, dict[str, str]]:
    """What each imported assignment of the course became: `{kind, id}` by external id."""
    return (await _imported_targets(ctx, [link_id])).get(link_id, {})


async def _imported_targets(
    ctx: Ctx, link_ids: Sequence[str]
) -> dict[str, dict[str, dict[str, str]]]:
    """`imported_targets` of several links in one query, by link id."""
    out: dict[str, dict[str, dict[str, str]]] = {}
    refs = await ctx.db.scalars(
        select(LmsImportedRef).where(
            LmsImportedRef.link_id.in_(link_ids),
            LmsImportedRef.target_id.is_not(None),
        )
    )
    for ref in refs:
        out.setdefault(ref.link_id, {})[ref.external_id] = {
            "kind": ref.target_kind or "",
            "id": ref.target_id or "",
        }
    return out


async def raw_assignments(
    ctx: Ctx,
    course_id: str,
    refresh: bool,
    *,
    linked: tuple[LmsCourseLink, Bound] | None = None,
) -> tuple[list[dict[str, Any]], bool]:
    async def fetch(b: Bound, i: Any, ext: str) -> Any:
        return _cleaned(b, await b.provider.assignments(i, b.cfg, b.creds, ext), ext)

    data, truncated, *_ = await _read(
        ctx,
        course_id,
        "assignments",
        "assignments",
        {},
        fetch,
        refresh=refresh,
        linked=linked,
        area="assignments",
    )
    return data, truncated


async def modules(ctx: Ctx, course_id: str, refresh: bool) -> ModuleList:
    async def fetch(b: Bound, i: Any, ext: str) -> Any:
        found = await b.provider.modules(i, b.cfg, b.creds, ext)
        for module in found:
            for item in module.items or []:
                lock_text(item)
        return found

    data, truncated, *_ = await _read(
        ctx, course_id, "modules", "modules", {}, fetch, refresh=refresh, area="modules"
    )
    return ModuleList.model_validate(
        {
            "items": [
                {**module, "items": _with_due(ctx, module["items"])}
                if module.get("items") is not None
                else module
                for module in data
            ],
            "truncated": truncated,
        }
    )


def _with_due(ctx: Ctx, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Module items with their due state (table 3d), worked out as they are read: what is
    stored and cached stays the platform's facts."""
    return [{**item, "due_state": rules.item_due_state(item, ctx.now)} for item in items]


async def module_items(ctx: Ctx, course_id: str, module_id: str, refresh: bool) -> ModuleItemList:
    linked = await service.require_link(ctx, course_id)
    link, b = linked
    service.require_feature(b, "modules")
    if not refresh:
        # The module list usually came with its items: no platform request for them.
        key = cache.cache_key(ctx.user_id, b.row.id, "modules", {"course": link.external_course_id})
        hit = cache.get(ctx, key)
        for module in (hit or {}).get("data", []):
            if module.get("external_id") == module_id and module.get("items") is not None:
                return ModuleItemList.model_validate(
                    {"items": _with_due(ctx, module["items"]), "truncated": False}
                )

    async def fetch(b: Bound, i: Any, ext: str) -> Any:
        return [
            lock_text(item)
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
    return ModuleItemList.model_validate({"items": _with_due(ctx, data), "truncated": truncated})


async def pages(ctx: Ctx, course_id: str, refresh: bool) -> PageList:
    async def fetch(b: Bound, i: Any, ext: str) -> Any:
        return await b.provider.pages(i, b.cfg, b.creds, ext)

    data, truncated, *_ = await _read(
        ctx, course_id, "pages", "pages", {}, fetch, refresh=refresh, area="pages"
    )
    return PageList.model_validate({"items": data, "truncated": truncated})


def _page_fetch(ref: str) -> Any:
    async def fetch(b: Bound, i: Any, ext: str) -> Any:
        detail = await b.provider.page(i, b.cfg, b.creds, ext, ref)
        detail.html = b.clean(detail.html, detail.web_url, ext)
        return lock_text(detail)

    return fetch


async def page(
    ctx: Ctx,
    course_id: str,
    ref: str,
    refresh: bool,
    *,
    linked: tuple[LmsCourseLink, Bound] | None = None,
) -> PageDetail:
    data, *_ = await _read(
        ctx,
        course_id,
        "pages",
        "page",
        {"ref": ref},
        _page_fetch(ref),
        refresh=refresh,
        linked=linked,
    )
    return PageDetail.model_validate(data)


async def pages_many(
    ctx: Ctx,
    linked: tuple[LmsCourseLink, Bound],
    wanted: Sequence[tuple[str, datetime | None]],
    refresh: bool,
) -> list[PageDetail | AppError]:
    """Several pages at once (the assistant's search reads their text), the missing ones asked
    side by side; `(ref, updated_at)` each. A page whose last change is known (from the pages
    list) is kept until it changes; one known only from a module is kept for an hour. A page
    that fails is its error in the list."""
    known = [(ref, at) for ref, at in wanted if at is not None]
    unknown = [ref for ref, at in wanted if at is None]
    by_ref: dict[str, Any] = {}
    if known:
        found = await read_many(
            ctx,
            linked,
            "pages",
            "page_text",
            [({"ref": ref, "updated_at": at.isoformat()}, _page_fetch(ref)) for ref, at in known],
            refresh=refresh,
            ttl=PAGE_TEXT_KEPT,
        )
        by_ref.update(zip((ref for ref, _ in known), found, strict=True))
    if unknown:
        found = await read_many(
            ctx,
            linked,
            "pages",
            "page_text",
            [({"ref": ref}, _page_fetch(ref)) for ref in unknown],
            refresh=refresh,
            ttl=PAGE_TEXT_TTL,
        )
        by_ref.update(zip(unknown, found, strict=True))
    return [
        by_ref[ref] if isinstance(by_ref[ref], AppError) else PageDetail.model_validate(by_ref[ref])
        for ref, _ in wanted
    ]


async def read_many(
    ctx: Ctx,
    linked: tuple[LmsCourseLink, Bound],
    feature: LmsFeature,
    method: str,
    wanted: Sequence[tuple[dict[str, Any], Any]],
    *,
    refresh: bool,
    ttl: timedelta = cache.TTL,
) -> list[Any | AppError]:
    """Reads of one kind for one course (`(params, fetch)` each, like `_read`): cached ones from
    the cache, the others from the platform side by side in one attempt (the session is not
    shared between tasks: only the provider calls run concurrently). An item the platform
    refuses or lacks is its error in the result; a broken connection fails the whole call."""
    link, b = linked
    service.require_feature(b, feature)
    ext = link.external_course_id
    keys = [
        cache.cache_key(ctx.user_id, b.row.id, method, {"course": ext, **params})
        for params, _ in wanted
    ]
    out: list[Any | AppError] = [None] * len(wanted)
    missing: list[int] = []
    for n, key in enumerate(keys):
        hit = None if refresh else cache.get(ctx, key)
        if hit is None:
            missing.append(n)
        else:
            out[n] = hit["data"]
    if not missing:
        return out
    gate = asyncio.Semaphore(MANY_CONCURRENCY)

    async def one(i: Any, n: int) -> Any:
        async with gate:
            try:
                return service.dump(await wanted[n][1](b, i, ext))
            except AppError as exc:
                if exc.code in STOPPING:
                    raise
                return exc  # about this item only

    async def run(i: Any) -> list[Any]:
        return await asyncio.gather(*(one(i, n) for n in missing))

    fetched, _ = await service.call(ctx, b, run)
    for n, data in zip(missing, fetched, strict=True):
        out[n] = data
        if not isinstance(data, AppError):
            cache.put(
                ctx,
                keys[n],
                b.row.id,
                {"data": data, "truncated": False},
                scope=cache.course_scope(ext),
                ttl=ttl,
            )
    return out


async def discussions(ctx: Ctx, course_id: str, refresh: bool) -> list[dict[str, Any]]:
    async def fetch(b: Bound, i: Any, ext: str) -> Any:
        return _cleaned(b, await b.provider.discussions(i, b.cfg, b.creds, ext), ext)

    data, *_ = await _read(
        ctx,
        course_id,
        "discussions",
        "discussions",
        {},
        fetch,
        refresh=refresh,
        area="discussions",
    )
    return data


async def discussion(ctx: Ctx, course_id: str, topic_id: str, refresh: bool) -> DiscussionDetail:
    async def fetch(b: Bound, i: Any, ext: str) -> Any:
        detail = await b.provider.discussion(i, b.cfg, b.creds, ext, topic_id)
        detail.html = b.clean(detail.html, detail.web_url, ext)
        for entry in detail.entries:
            entry.html = b.clean(entry.html, detail.web_url, ext)
        return lock_text(detail)

    data, *_ = await _read(
        ctx, course_id, "discussions", "discussion", {"topic": topic_id}, fetch, refresh=refresh
    )
    return DiscussionDetail.model_validate(data)


async def quizzes(ctx: Ctx, course_id: str, refresh: bool) -> QuizList:
    async def fetch(b: Bound, i: Any, ext: str) -> Any:
        return _cleaned(b, await b.provider.quizzes(i, b.cfg, b.creds, ext), ext)

    data, truncated, *_ = await _read(
        ctx, course_id, "quizzes", "quizzes", {}, fetch, refresh=refresh, area="quizzes"
    )
    return QuizList.model_validate({"items": data, "truncated": truncated})


async def syllabus(ctx: Ctx, course_id: str, refresh: bool) -> RichText:
    async def fetch(b: Bound, i: Any, ext: str) -> Any:
        text = await b.provider.syllabus(i, b.cfg, b.creds, ext)
        text.html = b.clean(text.html, text.web_url, ext)
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


async def files_many(
    ctx: Ctx, linked: tuple[LmsCourseLink, Bound], file_ids: Sequence[str], refresh: bool
) -> list[FileMeta | AppError]:
    """Several files' metadata at once, the missing ones asked side by side (`read_many`); a
    file that fails is its error in the list."""

    def fetch(file_id: str) -> Any:
        async def run(b: Bound, i: Any, ext: str) -> Any:
            return await b.provider.file(i, b.cfg, b.creds, ext, file_id)

        return run

    found = await read_many(
        ctx,
        linked,
        "files",
        "file",
        [({"file": file_id}, fetch(file_id)) for file_id in file_ids],
        refresh=refresh,
    )
    return [r if isinstance(r, AppError) else FileMeta.model_validate(r) for r in found]


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
    ext = link.external_course_id
    if meta is None:
        service.require_feature(b, "files")
        # A cached address is fine: Canvas's download URL carries the file's own verifier, which
        # does not expire, and the request is sent with the user's token anyway.
        meta = await file(ctx, course_id, file_id, refresh=False, linked=linked)

    from semestra.core.http import safe_client
    from semestra.modules.lms.providers import Io

    client = safe_client(ctx.settings)

    async def begin() -> tuple[AsyncIterator[bytes], bytes]:
        opened = b.provider.open_file(
            Io(client=client, settings=ctx.settings), b.cfg, b.creds, ext, meta
        )
        try:
            return opened, await anext(opened)
        except StopAsyncIteration:
            return opened, b""

    try:
        stream, first = await service.attempt(ctx, b, begin)
    except BaseException:
        await client.aclose()
        raise

    async def chunks() -> AsyncGenerator[bytes]:
        try:
            if first:
                yield first
            async for chunk in stream:
                yield chunk
        finally:
            await stream.aclose()  # pyright: ignore[reportAttributeAccessIssue]
            await client.aclose()

    return meta, _Download(chunks(), stream, client)


class _Download:
    """The bytes of a file being downloaded (`chunks` in `open_file`). An async generator that
    has not started skips its `finally` on `aclose()`, so closing one never read (an archive asked
    for and never fetched, M07 §5) closes the provider's stream and the HTTP client here."""

    def __init__(self, chunks: AsyncGenerator[bytes], stream: AsyncIterator[bytes], client: Any):
        self._chunks = chunks
        self._stream = stream
        self._client = client
        self._started = False

    def __aiter__(self) -> _Download:
        return self

    async def __anext__(self) -> bytes:
        self._started = True
        return await anext(self._chunks)

    async def aclose(self) -> None:
        await self._chunks.aclose()
        if not self._started:
            self._started = True
            try:
                await self._stream.aclose()  # pyright: ignore[reportAttributeAccessIssue]
            finally:
                await self._client.aclose()


async def submission(
    ctx: Ctx, course_id: str, assignment_id: str, refresh: bool
) -> SubmissionDetail:
    async def fetch(b: Bound, i: Any, ext: str) -> Any:
        found = await b.provider.submission(i, b.cfg, b.creds, ext, assignment_id)
        found.body = b.clean(found.body, None, ext)
        return found

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
        ctx,
        course_id,
        "folders",
        "folder",
        {"folder": folder_id},
        fetch,
        refresh=refresh,
        area="files" if folder_id is None else None,
    )
    return FolderListing.model_validate({**data, "truncated": truncated})


async def course_files(
    ctx: Ctx, course_id: str, refresh: bool, *, linked: tuple[LmsCourseLink, Bound] | None = None
) -> FileList:
    """Every file of the course the user can see, with its folder (the file sync)."""

    async def fetch(b: Bound, i: Any, ext: str) -> Any:
        return await b.provider.course_files(i, b.cfg, b.creds, ext)

    data, truncated, *_ = await _read(
        ctx,
        course_id,
        "folders",
        "course_files",
        {},
        fetch,
        refresh=refresh,
        linked=linked,
        area="files",
    )
    return FileList.model_validate({"items": data, "truncated": truncated})


async def search_files(ctx: Ctx, course_id: str, term: str, refresh: bool) -> FileList:
    async def fetch(b: Bound, i: Any, ext: str) -> Any:
        return await b.provider.search_files(i, b.cfg, b.creds, ext, term)

    data, truncated, *_ = await _read(
        ctx,
        course_id,
        "folders",
        "file_search",
        {"term": term},
        fetch,
        refresh=refresh,
        area="files",
    )
    return FileList.model_validate({"items": data, "truncated": truncated})


# --- writes ---------------------------------------------------------------------------------


async def refresh_course(ctx: Ctx, course_id: str) -> None:
    """Forgets everything cached about one course ("Refresh" in the Canvas tab); the next reads
    ask the platform."""
    link, b = await service.require_link(ctx, course_id)
    cache.drop_scope(ctx, b.row.id, cache.course_scope(link.external_course_id))
