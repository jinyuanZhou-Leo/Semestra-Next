"""The assistant's LMS reads (M09 §8): a course's outline, search across its content, reading
any item by its ref, and what is new. Built on the cached reads of `reads.py`; areas the
instructor hid are not asked for (the course's navigation says which are open), and what could
not be read is reported instead of failing the call."""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, get_args
from zoneinfo import ZoneInfo

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules.academics import service as academics
from semestra.modules.lms import files, reads, refs, service
from semestra.modules.lms import search as ranking
from semestra.modules.lms.errors import lms_error
from semestra.modules.lms.markdown import to_markdown
from semestra.modules.lms.models import LmsCourseLink
from semestra.modules.lms.schemas.agent import (
    ContentKind,
    LmsActivityInput,
    LmsActivityItem,
    LmsActivityList,
    LmsContentDetail,
    LmsCourseOutline,
    LmsOutlineInput,
    LmsOutlineItem,
    LmsOutlineModule,
    LmsOutlinePage,
    LmsOutlineTab,
    LmsReadInput,
    LmsSearchHit,
    LmsSearchInput,
    LmsSearchResults,
    LmsSkipped,
)
from semestra.modules.lms.schemas.dto import Module, ModuleItem
from semestra.modules.lms.schemas.io import CourseOverview
from semestra.modules.lms.service import Bound

# Module items one outline call returns at most; the rest come with `next_cursor`.
OUTLINE_ITEMS = 300
# Pages one search reads the text of at most (cached for an hour, `reads.PAGE_TEXT_TTL`).
SEARCH_MAX_PAGES = 60
# Characters of text one `read` returns; `next_offset` goes on.
TEXT_CHUNK = 20_000
ACTIVITY_WINDOW = timedelta(days=7)
ACTIVITY_MAX = 60
# What makes one source of a search or one course of the activity list fail on its own.
_SKIPPABLE = frozenset(
    ("lms.area_hidden", "lms.not_found", "lms.forbidden", "lms.feature_unsupported")
)
# Areas whose lists the platform refuses when the instructor hid them (Canvas answers 404):
# skipped up front when the navigation says so.
_GUARDED_AREAS = frozenset(("pages", "files", "quizzes", "discussions"))
_ITEM_KINDS: dict[str, ContentKind] = {
    "page": "page",
    "assignment": "assignment",
    "quiz": "quiz",
    "file": "file",
    "discussion": "discussion",
    "external_url": "link",
    "external_tool": "link",
}


def _md(html: str | None) -> str:
    return (to_markdown(html) if html else None) or ""


# --- the course as the assistant sees it ---------------------------------------------------


@dataclass
class _Course:
    link: LmsCourseLink
    b: Bound
    overview: CourseOverview
    open_areas: set[str] | None
    modules: list[Module]
    pages: list[LmsOutlinePage] | None  # None: the pages area is hidden or not offered
    skipped: list[LmsSkipped] = field(default_factory=list)

    def is_open(self, area: str) -> bool:
        return self.open_areas is None or area not in _GUARDED_AREAS or area in self.open_areas

    def has(self, feature: str) -> bool:
        return feature in self.b.provider.features


def _open_areas(overview: CourseOverview) -> set[str] | None:
    if "navigation" not in overview.features or not overview.navigation:
        return None
    return {
        t.kind
        for t in overview.navigation
        if not t.hidden and t.kind not in ("external", "unknown")
    }


async def _course(ctx: Ctx, course_id: str, refresh: bool) -> _Course:
    linked = await service.require_link(ctx, course_id)
    overview = await reads.overview(ctx, course_id, refresh)
    course = _Course(
        link=linked[0],
        b=linked[1],
        overview=overview,
        open_areas=_open_areas(overview),
        modules=[],
        pages=None,
    )
    if course.has("modules"):
        try:
            course.modules = list((await reads.modules(ctx, course_id, refresh)).items)
        except AppError as exc:
            _skip(course.skipped, "modules", exc)
        missing = [m for m in course.modules if m.items is None]
        if missing:
            found = await reads.read_many(
                ctx,
                linked,
                "modules",
                "module_items",
                [({"module": m.external_id}, _module_items_fetch(m.external_id)) for m in missing],
                refresh=refresh,
            )
            for module, items in zip(missing, found, strict=True):
                if isinstance(items, AppError):
                    module.items = []
                    course.skipped.append(
                        LmsSkipped(source=f"module {module.name}", reason="failed")
                    )
                else:
                    module.items = [ModuleItem.model_validate(i) for i in items]
    if course.has("pages") and course.is_open("pages"):
        try:
            listed = (await reads.pages(ctx, course_id, refresh)).items
            course.pages = [
                LmsOutlinePage(
                    ref=refs.make("page", p.ref),
                    title=p.title,
                    updated_at=p.updated_at,
                    front_page=p.front_page,
                )
                for p in listed
            ]
        except AppError as exc:
            _skip(course.skipped, "pages", exc)
    elif course.has("pages"):
        course.skipped.append(LmsSkipped(source="pages", reason="hidden"))
    return course


def _module_items_fetch(module_id: str) -> Callable[[Bound, Any, str], Awaitable[Any]]:
    async def fetch(b: Bound, i: Any, ext: str) -> Any:
        items = await b.provider.module_items(i, b.cfg, b.creds, ext, module_id)
        return [reads.lock_text(item) for item in items]

    return fetch


def _skip(skipped: list[LmsSkipped], source: str, exc: AppError) -> None:
    if exc.code not in _SKIPPABLE:
        raise exc
    if exc.code != "lms.feature_unsupported":
        reason = "hidden" if exc.code == "lms.area_hidden" else "failed"
        skipped.append(LmsSkipped(source=source, reason=reason))


def _item(item: ModuleItem) -> LmsOutlineItem:
    url = None
    if item.kind == "external_url":
        url = item.external_url
    elif item.kind == "external_tool":
        url = item.web_url
    return LmsOutlineItem(
        title=item.title,
        kind=item.kind,
        ref=refs.from_internal(item.target),
        url=url,
        indent=item.indent,
        due_at=item.due_at,
        points=item.points,
        locked=item.locked,
        lock_explanation=item.lock_explanation,
        completed=item.completion.completed if item.completion else None,
    )


async def outline(ctx: Ctx, inp: LmsOutlineInput) -> LmsCourseOutline:
    course = await _course(ctx, inp.course_id, inp.refresh)
    start = int(inp.cursor) if inp.cursor and inp.cursor.isdigit() else 0
    modules: list[LmsOutlineModule] = []
    count, next_cursor = 0, None
    for n, module in enumerate(course.modules[start:], start):
        items = [_item(i) for i in module.items or []]
        if modules and count + len(items) > OUTLINE_ITEMS:
            next_cursor = str(n)
            break
        count += len(items)
        modules.append(
            LmsOutlineModule(
                name=module.name, state=module.state, unlock_at=module.unlock_at, items=items
            )
        )
    in_modules = {
        refs.from_internal(i.target)
        for m in course.modules
        for i in m.items or []
        if i.kind == "page"
    }
    c = course.overview.course
    return LmsCourseOutline(
        course_id=inp.course_id,
        code=c.code,
        name=c.name,
        term=c.term,
        provider_name=course.overview.provider_name,
        open_areas=sorted(course.open_areas) if course.open_areas is not None else None,
        external_tabs=[
            LmsOutlineTab(label=t.label, url=t.web_url)
            for t in course.overview.navigation
            if t.kind == "external" and not t.hidden
        ],
        modules=modules,
        other_pages=[p for p in course.pages or [] if p.ref not in in_modules]
        if start == 0
        else [],
        next_cursor=next_cursor,
        skipped=course.skipped,
    )


# --- search ----------------------------------------------------------------------------------


@dataclass
class _Entry:
    kind: ContentKind
    ref: str | None
    doc: ranking.Doc
    where: str | None = None
    url: str | None = None
    date: datetime | None = None


class _Docs:
    def __init__(self) -> None:
        self.by_key: dict[str, _Entry] = {}

    def add(
        self,
        kind: ContentKind,
        ref: str | None,
        title: str,
        text: str = "",
        *,
        where: str | None = None,
        url: str | None = None,
        date: datetime | None = None,
    ) -> None:
        key = ref or f"link:{url or title}"
        have = self.by_key.get(key)
        if have is None:
            self.by_key[key] = _Entry(kind, ref, ranking.Doc(key, title, text), where, url, date)
            return
        # The same item from a module and from its own list: keep the module as `where`.
        if text and not have.doc.text:
            have.doc.text = text
        have.where = have.where or where
        have.url = have.url or url
        have.date = have.date or date


async def search(ctx: Ctx, inp: LmsSearchInput) -> LmsSearchResults:
    course = await _course(ctx, inp.course_id, inp.refresh)
    wanted: set[str] = set(inp.kinds or get_args(ContentKind))
    docs = _Docs()
    skipped = list(course.skipped)
    for module in course.modules:
        for item in module.items or []:
            kind = _ITEM_KINDS.get(item.kind)
            if kind is None:
                continue
            o = _item(item)
            docs.add(kind, o.ref, o.title, o.url or "", where=module.name, url=o.url, date=o.due_at)
    for page in course.pages or []:
        docs.add("page", page.ref, page.title, where="Pages", date=page.updated_at)

    if "page" in wanted and course.has("pages"):
        page_refs = [e.ref for e in docs.by_key.values() if e.kind == "page" and e.ref]
        if len(page_refs) > SEARCH_MAX_PAGES:
            skipped.append(
                LmsSkipped(source=f"pages after the first {SEARCH_MAX_PAGES}", reason="limit")
            )
        page_refs = page_refs[:SEARCH_MAX_PAGES]
        changed = {p.ref: p.updated_at for p in course.pages or []}
        found = await reads.pages_many(
            ctx,
            (course.link, course.b),
            [(refs.parse(r)[1], changed.get(r)) for r in page_refs],
            inp.refresh,
        )
        for ref, page in zip(page_refs, found, strict=True):
            if not isinstance(page, AppError):
                docs.add("page", ref, page.title, _md(page.html), date=page.updated_at)

    async def source(name: str, area: str | None, run: Callable[[], Awaitable[None]]) -> None:
        if area is not None and not course.is_open(area):
            skipped.append(LmsSkipped(source=name, reason="hidden"))
            return
        try:
            await run()
        except AppError as exc:
            _skip(skipped, name, exc)

    cid = inp.course_id

    async def announcements() -> None:
        for a in (await reads.announcements(ctx, cid, None, inp.refresh)).items:
            ref = refs.make("announcement", a.external_id)
            docs.add(
                "announcement", ref, a.title, _md(a.html), where="Announcements", date=a.posted_at
            )

    async def assignments() -> None:
        data, _ = await reads.raw_assignments(ctx, cid, inp.refresh, linked=(course.link, course.b))
        for a in data:
            ref = refs.make("assignment", a["external_id"])
            docs.add(
                "assignment",
                ref,
                a["name"],
                _md(a.get("html")),
                where=a.get("group_name"),
                date=_dt(a.get("due_at")),
            )

    async def quizzes() -> None:
        for q in (await reads.quizzes(ctx, cid, inp.refresh)).items:
            docs.add(
                "quiz",
                refs.make("quiz", q.external_id),
                q.title,
                _md(q.html),
                where="Quizzes",
                date=q.due_at,
            )

    async def discussions() -> None:
        for d in await reads.discussions(ctx, cid, inp.refresh):
            ref = refs.make("discussion", d["external_id"])
            docs.add(
                "discussion",
                ref,
                d["title"],
                _md(d.get("html")),
                where="Discussions",
                date=_dt(d.get("posted_at")),
            )

    async def syllabus() -> None:
        text = await reads.syllabus(ctx, cid, inp.refresh)
        if text.html:
            docs.add("syllabus", refs.SYLLABUS, "Syllabus", _md(text.html), url=text.web_url)

    async def file_names() -> None:
        for f in (await reads.search_files(ctx, cid, inp.query.strip(), inp.refresh)).items:
            docs.add(
                "file", refs.make("file", f.external_id), f.name, where="Files", date=f.updated_at
            )

    if "announcement" in wanted and course.has("announcements"):
        await source("announcements", None, announcements)
    if "assignment" in wanted and course.has("assignments"):
        await source("assignments", None, assignments)
    if "quiz" in wanted and course.has("quizzes"):
        await source("quizzes", "quizzes", quizzes)
    if "discussion" in wanted and course.has("discussions"):
        await source("discussions", "discussions", discussions)
    if "syllabus" in wanted and course.has("syllabus"):
        await source("syllabus", None, syllabus)
    if "file" in wanted and course.has("folders") and len(inp.query.strip()) >= 2:
        await source("files", "files", file_names)

    scored = [
        (m, e)
        for e in docs.by_key.values()
        if e.kind in wanted and (m := ranking.rank(inp.query, e.doc)) is not None
    ]
    scored.sort(key=lambda pair: ranking.order_key(pair[0], pair[1].date))
    hits = [
        LmsSearchHit(
            ref=e.ref,
            kind=e.kind,
            title=e.doc.title,
            where=e.where,
            snippet=ranking.snippet(e.doc.text, m.at) if e.doc.text else "",
            url=e.url,
            date=e.date,
        )
        for m, e in scored[: inp.limit]
    ]
    return LmsSearchResults(hits=hits, skipped=skipped)


def _dt(value: Any) -> datetime | None:
    if isinstance(value, datetime) or value is None:
        return value
    return datetime.fromisoformat(str(value))


# --- read ------------------------------------------------------------------------------------


async def read(ctx: Ctx, inp: LmsReadInput) -> LmsContentDetail:
    link, b = await service.require_link(ctx, inp.course_id)
    if inp.ref is not None:
        kind, item_id = refs.parse(inp.ref)
    else:
        target = b.rewrite(inp.url or "")
        if target is not None and target.course not in (None, link.external_course_id):
            raise lms_error("lms.other_course")
        ref = refs.from_internal(target)
        if ref is None:
            raise lms_error("lms.invalid_ref", ref=(inp.url or "")[:100])
        kind, item_id = refs.parse(ref)
    detail = await _READERS[kind](ctx, inp, (link, b), item_id)
    text = detail.text
    detail.text = text[inp.offset : inp.offset + TEXT_CHUNK]
    if inp.offset + TEXT_CHUNK < len(text):
        detail.next_offset = inp.offset + TEXT_CHUNK
    return detail


type _Reader = Callable[
    [Ctx, LmsReadInput, tuple[LmsCourseLink, Bound], str], Awaitable[LmsContentDetail]
]


async def _read_page(
    ctx: Ctx, inp: LmsReadInput, linked: tuple[LmsCourseLink, Bound], item_id: str
) -> LmsContentDetail:
    p = await reads.page(ctx, inp.course_id, item_id, inp.refresh, linked=linked)
    return LmsContentDetail(
        ref=refs.make("page", p.ref),
        kind="page",
        title=p.title,
        url=p.web_url,
        date=p.updated_at,
        locked=p.locked,
        lock_explanation=p.lock_explanation,
        text=_md(p.html),
    )


async def _read_discussion(
    ctx: Ctx,
    inp: LmsReadInput,
    linked: tuple[LmsCourseLink, Bound],
    item_id: str,
    kind: ContentKind = "discussion",
) -> LmsContentDetail:
    d = await reads.discussion(ctx, inp.course_id, item_id, inp.refresh)
    parts = [_md(d.html)]
    if d.entries:
        parts.append(f"## Replies ({d.reply_count})")
        for e in d.entries:
            when = f" ({e.created_at:%Y-%m-%d})" if e.created_at else ""
            body = " ".join(_md(e.html).split())
            parts.append(f"{'  ' * e.depth}- **{e.author or '?'}**{when}: {body}")
    return LmsContentDetail(
        ref=refs.make(kind, d.external_id),  # pyright: ignore[reportArgumentType]
        kind=kind,
        title=d.title,
        url=d.web_url,
        date=d.posted_at,
        locked=d.locked,
        lock_explanation=d.lock_explanation,
        text="\n\n".join(p for p in parts if p),
        note="Only the first replies are included." if d.entries_truncated else None,
    )


async def _read_announcement(
    ctx: Ctx, inp: LmsReadInput, linked: tuple[LmsCourseLink, Bound], item_id: str
) -> LmsContentDetail:
    if "discussions" in linked[1].provider.features:  # an announcement is a topic, with replies
        return await _read_discussion(ctx, inp, linked, item_id, "announcement")
    for a in (await reads.announcements(ctx, inp.course_id, None, inp.refresh)).items:
        if a.external_id == item_id:
            return LmsContentDetail(
                ref=refs.make("announcement", a.external_id),
                kind="announcement",
                title=a.title,
                url=a.web_url,
                date=a.posted_at,
                text=_md(a.html),
            )
    raise lms_error("lms.not_found")


async def _read_assignment(
    ctx: Ctx, inp: LmsReadInput, linked: tuple[LmsCourseLink, Bound], item_id: str
) -> LmsContentDetail:
    data, _ = await reads.raw_assignments(ctx, inp.course_id, inp.refresh, linked=linked)
    a = next((a for a in data if a["external_id"] == item_id), None)
    if a is None:
        raise lms_error("lms.not_found")
    parts = [_md(a.get("html"))]
    sub = a.get("submission") or {}
    if sub:
        state = sub.get("state") or "unsubmitted"
        score = sub.get("score")
        line = f"Your submission: {state}"
        if score is not None:
            line += f", score {score:g}" + (f"/{a['points']:g}" if a.get("points") else "")
        if sub.get("grade"):
            line += f" ({sub['grade']})"
        flags = [f for f in ("late", "missing") if sub.get(f)]
        parts.append(line + (f"; {', '.join(flags)}" if flags else ""))
    rubric = a.get("rubric") or []
    feedback: dict[str, Any] = {}
    if "submissions" in linked[1].provider.features and sub.get("state") not in (
        None,
        "unsubmitted",
    ):
        try:
            detail = await reads.submission(ctx, inp.course_id, item_id, inp.refresh)
            feedback = detail.model_dump()
        except AppError as exc:
            if exc.code not in _SKIPPABLE:
                raise
    scores = {s["criterion_id"]: s for s in feedback.get("rubric_scores", [])}
    if rubric:
        parts.append("## Rubric")
        for c in rubric:
            mine = scores.get(c["id"])
            got = f" — you: {mine['points']:g}" if mine and mine.get("points") is not None else ""
            pts = f" ({c['points']:g} pts)" if c.get("points") is not None else ""
            note = f" — {mine['comments']}" if mine and mine.get("comments") else ""
            parts.append(f"- {c['description']}{pts}{got}{note}")
    if feedback.get("comments"):
        parts.append("## Comments")
        for cm in feedback["comments"]:
            parts.append(f"- **{cm.get('author') or '?'}**: {cm.get('comment', '')}")
    return LmsContentDetail(
        ref=refs.make("assignment", item_id),
        kind="assignment",
        title=a["name"],
        url=a.get("web_url"),
        date=_dt(a.get("updated_at")),
        due_at=_dt(a.get("due_at")),
        points=a.get("points"),
        locked=bool(a.get("locked")),
        lock_explanation=a.get("lock_explanation"),
        text="\n\n".join(p for p in parts if p),
    )


async def _read_quiz(
    ctx: Ctx, inp: LmsReadInput, linked: tuple[LmsCourseLink, Bound], item_id: str
) -> LmsContentDetail:
    q = next(
        (
            q
            for q in (await reads.quizzes(ctx, inp.course_id, inp.refresh)).items
            if q.external_id == item_id
        ),
        None,
    )
    if q is None:
        raise lms_error("lms.not_found")
    facts = [
        f"{label}: {value}"
        for label, value in (
            ("Questions", q.question_count),
            ("Time limit", f"{q.time_limit} min" if q.time_limit else None),
            ("Attempts", "unlimited" if q.allowed_attempts in (None, -1) else q.allowed_attempts),
        )
        if value is not None
    ]
    note = (
        f"Its score and attempts: lms.content.read(assignment:{q.assignment_id})"
        if q.assignment_id
        else None
    )
    return LmsContentDetail(
        ref=refs.make("quiz", item_id),
        kind="quiz",
        title=q.title,
        url=q.web_url,
        due_at=q.due_at,
        points=q.points,
        locked=q.locked,
        lock_explanation=q.lock_explanation,
        text="\n\n".join(p for p in ("\n".join(facts), _md(q.html)) if p),
        note=note,
    )


async def _read_file(
    ctx: Ctx, inp: LmsReadInput, linked: tuple[LmsCourseLink, Bound], item_id: str
) -> LmsContentDetail:
    meta = await reads.file(ctx, inp.course_id, item_id, inp.refresh, linked=linked)
    preview = await files.preview(ctx, inp.course_id, item_id, inp.refresh)
    text = "\n\n".join(f"--- page {n} ---\n\n{page}" for n, page in enumerate(preview.pages, 1))
    note = None
    if preview.truncated:
        note = "Only the first pages; lms.file.save_to_course keeps the whole file searchable."
    return LmsContentDetail(
        ref=refs.make("file", item_id),
        kind="file",
        title=meta.name,
        url=meta.web_url,
        date=meta.updated_at,
        locked=meta.locked,
        text=text,
        note=note,
    )


async def _read_syllabus(
    ctx: Ctx, inp: LmsReadInput, linked: tuple[LmsCourseLink, Bound], item_id: str
) -> LmsContentDetail:
    s = await reads.syllabus(ctx, inp.course_id, inp.refresh)
    return LmsContentDetail(
        ref=refs.SYLLABUS,
        kind="syllabus",
        title="Syllabus",
        url=s.web_url,
        text=_md(s.html),
        note=None if s.html else "The course has no syllabus text on the LMS.",
    )


_READERS: dict[str, _Reader] = {
    "page": _read_page,
    "announcement": _read_announcement,
    "discussion": _read_discussion,
    "assignment": _read_assignment,
    "quiz": _read_quiz,
    "file": _read_file,
    "syllabus": _read_syllabus,
}


# --- activity --------------------------------------------------------------------------------


async def activity(ctx: Ctx, inp: LmsActivityInput) -> LmsActivityList:
    if inp.course_id is not None:
        await service.require_link(ctx, inp.course_id)
        course_ids = [inp.course_id]
        zone = await reads.course_zone(ctx, inp.course_id)
    else:
        term = await academics.get_term_row(ctx, inp.term_id or "")
        course_ids = await _term_courses(ctx, term.id)
        zone = ZoneInfo((await academics.get_program_row(ctx, term.program_id)).timezone)
    since = reads.aware(inp.since, zone) or ctx.now - ACTIVITY_WINDOW
    rows = {c.id: c for c in await academics.courses_by_id(ctx, course_ids)}
    items: list[LmsActivityItem] = []
    skipped: list[LmsSkipped] = []
    for course_id in course_ids:
        row = rows[course_id]
        label = row.code or row.title
        try:
            items += await _course_activity(ctx, course_id, label, since, inp.refresh)
        except AppError as exc:
            if exc.code not in _SKIPPABLE and inp.course_id is not None:
                raise
            skipped.append(LmsSkipped(source=label, reason=exc.code))
    items.sort(key=lambda i: i.at.timestamp() if i.at else 0.0, reverse=True)
    return LmsActivityList(
        since=since,
        items=items[:ACTIVITY_MAX],
        skipped=skipped,
        truncated=len(items) > ACTIVITY_MAX,
    )


async def _term_courses(ctx: Ctx, term_id: str) -> list[str]:
    term = await academics.get_term_row(ctx, term_id)
    links = await service.program_links(ctx, term.program_id)
    program = await academics.get_program_row(ctx, term.program_id)
    rows = await academics.courses_by_id(ctx, [li.course_id for li in links])
    courses = await academics.courses_out(ctx, program, rows)
    ordered = sorted(courses, key=lambda c: (c.code or c.title).lower())
    return [c.id for c in ordered if term_id in c.term_ids]


async def _course_activity(
    ctx: Ctx, course_id: str, label: str, since: datetime, refresh: bool
) -> list[LmsActivityItem]:
    linked = await service.require_link(ctx, course_id)
    b = linked[1]
    out: list[LmsActivityItem] = []

    def add(
        kind: Any,
        ref: str | None,
        title: str,
        at: datetime | None,
        summary: str | None,
        due_at: datetime | None = None,
    ) -> None:
        out.append(
            LmsActivityItem(
                course_id=course_id,
                course=label,
                kind=kind,
                ref=ref,
                title=title,
                at=at,
                due_at=due_at,
                summary=summary,
            )
        )

    if "announcements" in b.provider.features:
        try:
            for a in (await reads.announcements(ctx, course_id, None, refresh)).items:
                if a.posted_at and a.posted_at >= since:
                    text = " ".join(_md(a.html).split())
                    ref = refs.make("announcement", a.external_id)
                    add("announcement", ref, a.title, a.posted_at, text[:200] or None)
        except AppError as exc:
            if exc.code not in _SKIPPABLE:
                raise
    if "assignments" in b.provider.features:
        data, _ = await reads.raw_assignments(ctx, course_id, refresh, linked=linked)
        imported = await reads.imported_targets(ctx, linked[0].id)
        # New: what the app offers to import (not imported, due later), changed lately.
        fresh = set(reads.new_ids(ctx, data, imported))
        for a in data:
            ref = refs.make("assignment", a["external_id"])
            sub = a.get("submission") or {}
            graded = _dt(sub.get("graded_at"))
            if graded and graded >= since and sub.get("score") is not None:
                pts = f"/{a['points']:g}" if a.get("points") else ""
                grade = f" ({sub['grade']})" if sub.get("grade") else ""
                add("grade", ref, a["name"], graded, f"{sub['score']:g}{pts}{grade}")
            updated = _dt(a.get("updated_at"))
            if a["external_id"] in fresh and updated and updated >= since:
                add("assignment", ref, a["name"], updated, None, due_at=_dt(a.get("due_at")))
    return out
