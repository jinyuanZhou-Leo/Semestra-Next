"""Course-level reads (M09 §5): the platform-neutral interface the Canvas tab (M16) and the
agent use. Every read needs a linked course and the provider's feature; HTML is cleaned before
it is cached, so cache hits are clean too."""

import asyncio
from collections.abc import AsyncIterator, Collection, Sequence
from datetime import UTC, datetime, timedelta, tzinfo
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules.academics import service as academics
from semestra.modules.lms import cache, html, service, submissions
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
    AnnouncementList,
    AssignmentList,
    AssignmentsInput,
    CourseOverview,
    FileList,
    GradeList,
    ModuleItemList,
    ModuleList,
    NewAssignmentList,
    NewAssignments,
    PageList,
    QuizList,
    TermAnnouncement,
    TermAnnouncementList,
)
from semestra.modules.lms.service import Bound

# What the platform answers a list of an area the user can't open with (Canvas: 404 when the
# instructor hid the tab, 401 when the files are hidden).
AREA_REFUSALS = frozenset(("lms.not_found", "lms.forbidden"))
# Errors about one item (`read_many` keeps them per item); the others stop the whole read.
ITEM_ERRORS = frozenset(("lms.not_found", "lms.forbidden"))
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
        if (
            area is not None
            and exc.code in AREA_REFUSALS
            and await _area_hidden(ctx, course_id, area, refresh=refresh)
        ):
            raise lms_error("lms.area_hidden", area=area) from None
        raise
    return data, truncated, link, b


async def _area_hidden(ctx: Ctx, course_id: str, area: NavKind, *, refresh: bool) -> bool:
    """Whether the course's menu leaves `area` out or hides it: only then is a refused list of
    it the instructor's doing. A course gone from the platform, or a user no longer enrolled, is
    refused too, and keeps its own error."""
    try:
        found = await overview(ctx, course_id, refresh)
    except AppError:
        return False
    if "navigation" not in found.features or not found.navigation:
        return False
    return not any(t.kind == area and not t.hidden for t in found.navigation)


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


def _announcement_params(since: datetime | None) -> dict[str, Any]:
    return {"since": since.isoformat() if since else None}


async def announcements(
    ctx: Ctx, course_id: str, since: datetime | None, refresh: bool
) -> AnnouncementList:
    async def fetch(b: Bound, i: Any, ext: str) -> Any:
        items = await b.provider.announcements(i, b.cfg, b.creds, [ext], since=since)
        return _cleaned(b, items, ext)

    data, truncated, *_ = await _read(
        ctx,
        course_id,
        "announcements",
        "announcements",
        _announcement_params(since),
        fetch,
        refresh=refresh,
        area="announcements",
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
            dumped = [a.model_dump(mode="json") for a in _cleaned(b, fetched, None)]
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
            LmsImportedRef.link_id.in_(link_ids), LmsImportedRef.external_kind == "assignment"
        )
    )
    for ref in refs:
        out.setdefault(ref.link_id, {})[ref.external_id] = {
            "kind": ref.target_kind,
            "id": ref.target_id,
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

    data, truncated, link, _ = await _read(
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
    submissions.after_read(ctx, link.id, data)
    return data, truncated


def new_ids(ctx: Ctx, data: list[dict[str, Any]], imported: Collection[str]) -> list[str]:
    """The assignments "N new assignments" counts: not imported, due later; soonest first. One
    with no due date or already past is not offered again: the user can still import it."""
    later = [
        a
        for a in data
        if a["external_id"] not in imported
        and a.get("due_at")
        and datetime.fromisoformat(a["due_at"]) > ctx.now
    ]
    later.sort(key=lambda a: datetime.fromisoformat(a["due_at"]))
    return [a["external_id"] for a in later]


async def assignments(ctx: Ctx, inp: AssignmentsInput) -> AssignmentList:
    """The course's assignments with what each was imported as (and the course total when
    asked). The filters narrow `items` only: `new_ids` is about the whole list."""
    course_id, refresh = inp.course_id, inp.refresh
    linked = await service.require_link(ctx, course_id)
    data, truncated = await raw_assignments(ctx, course_id, refresh, linked=linked)
    targets = await imported_targets(ctx, linked[0].id)
    zone = await course_zone(ctx, course_id) if inp.due_after or inp.due_before else UTC
    after, before = aware(inp.due_after, zone), aware(inp.due_before, zone)
    items = [
        {**a, "ref": f"assignment:{a['external_id']}", "imported_as": targets.get(a["external_id"])}
        for a in data
        if _wanted(ctx, a, inp, after, before)
    ]
    totals: list[Any] = []
    if inp.include_total and "grades" in linked[1].provider.features:
        try:
            totals, *_ = await _read(
                ctx,
                course_id,
                "grades",
                "grade_totals",
                {},
                _totals_fetch,
                refresh=refresh,
                linked=linked,
            )
        except AppError as exc:
            if exc.code not in ITEM_ERRORS:
                raise
    return AssignmentList.model_validate(
        {
            "items": items,
            "new_ids": new_ids(ctx, data, targets),
            "totals": totals,
            "truncated": truncated,
        }
    )


async def _totals_fetch(b: Bound, i: Any, ext: str) -> Any:
    return await b.provider.grade_totals(i, b.cfg, b.creds, ext)


# Assignments handed in elsewhere: nothing to submit online, so never "missing" by date alone.
OFFLINE_SUBMISSIONS = frozenset(("on_paper", "none", "not_graded"))


def _wanted(
    ctx: Ctx,
    a: dict[str, Any],
    inp: AssignmentsInput,
    after: datetime | None,
    before: datetime | None,
) -> bool:
    due = datetime.fromisoformat(a["due_at"]) if a.get("due_at") else None
    if after and (due is None or due < after):
        return False
    if before and (due is None or due > before):
        return False
    sub = a.get("submission")
    handed_in = (sub or {}).get("state") in ("submitted", "graded", "pending_review") or bool(
        (sub or {}).get("submitted_at")
    )
    types = set(a.get("submission_types") or [])
    online = not types or not types <= OFFLINE_SUBMISSIONS
    match inp.status:
        case "upcoming":
            return not handed_in and (due is None or due > ctx.now)
        case "missing":
            if sub is not None:  # the platform's own flag knows what needs handing in
                return bool(sub.get("missing"))
            return online and due is not None and due < ctx.now
        case "graded":
            return (sub or {}).get("score") is not None or (sub or {}).get("state") == "graded"
        case None:
            return True


async def term_new_assignments(ctx: Ctx, term_id: str) -> NewAssignmentList:
    """New assignments of every synced, linked course of a term (the "today" page's prompt),
    from the cached lists only: asking the platform course after course would hold the page
    up. Courses not in the cache are listed in `unread` for the page to read side by side."""
    term = await academics.get_term_row(ctx, term_id)
    links = {li.course_id: li for li in await service.program_links(ctx, term.program_id)}
    program = await academics.get_program_row(ctx, term.program_id)
    rows = await academics.courses_by_id(
        ctx, [li.course_id for li in links.values() if li.sync_enabled]
    )
    courses = [
        c
        for c in sorted(
            await academics.courses_out(ctx, program, rows),
            key=lambda c: (c.code or c.title).lower(),
        )
        if term_id in c.term_ids
    ]
    connections: dict[str, Bound | None] = {}
    for connection_id in {links[c.id].connection_id for c in courses}:
        try:
            b = await service.bound(ctx, await service.get_connection_row(ctx, connection_id))
            service.require_feature(b, "assignments")
        except AppError:
            b = None  # credentials gone, platform without assignments: its courses are left out
        connections[connection_id] = b
    targets = await _imported_targets(ctx, [links[c.id].id for c in courses])
    items: list[NewAssignments] = []
    unread: list[str] = []
    for course in courses:
        link = links[course.id]
        b = connections[link.connection_id]
        if b is None:
            continue
        try:
            with service.cache_only():
                data, _ = await raw_assignments(ctx, course.id, False, linked=(link, b))
        except service.NotCached:
            unread.append(course.id)
            continue
        except AppError:
            continue
        found = new_ids(ctx, data, targets.get(link.id, {}))
        if found:
            names = {a["external_id"]: str(a["name"]) for a in data}
            items.append(
                NewAssignments(
                    course_id=course.id, external_ids=found, names=[names[i] for i in found]
                )
            )
    return NewAssignmentList(
        items=items, total=sum(len(i.external_ids) for i in items), unread=unread
    )


async def grades(ctx: Ctx, course_id: str, refresh: bool) -> GradeList:
    """The course total from the platform, then one row per assignment built from the cached
    assignment list (its submissions carry the scores): the platform is not asked twice."""

    linked = await service.require_link(ctx, course_id)
    totals, truncated, *_ = await _read(
        ctx,
        course_id,
        "grades",
        "grade_totals",
        {},
        _totals_fetch,
        refresh=refresh,
        linked=linked,
        area="grades",
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
                lock_text(item)
        return found

    data, truncated, *_ = await _read(
        ctx, course_id, "modules", "modules", {}, fetch, refresh=refresh, area="modules"
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
    return ModuleItemList.model_validate({"items": data, "truncated": truncated})


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
        hit = None if refresh else await cache.get(ctx, key)
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
                if exc.code in ITEM_ERRORS:
                    return exc
                raise

    async def run(i: Any) -> list[Any]:
        return await asyncio.gather(*(one(i, n) for n in missing))

    fetched, _ = await service.call(ctx, b, run)
    for n, data in zip(missing, fetched, strict=True):
        out[n] = data
        if not isinstance(data, AppError):
            await cache.put(
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
