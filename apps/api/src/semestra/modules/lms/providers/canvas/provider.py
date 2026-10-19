"""Canvas REST API v1 (M09 §2.3).

Every request goes through `core.http.safe_client` (the `Io` the module hands in): it refuses
private addresses where the connection is opened and never follows redirects. File downloads
follow redirects here, hop by hop, only to the instance itself or Canvas's file CDN, and check
each hop's address before connecting.
"""

import ipaddress
import re
import socket
from collections.abc import AsyncIterator, Sequence
from datetime import UTC, datetime, timedelta
from typing import Any, ClassVar, cast
from urllib.parse import quote, unquote, urljoin, urlsplit

import anyio
import httpx
from pydantic import BaseModel

from semestra.core.config import Settings
from semestra.core.errors import AppError
from semestra.core.http import is_public_address
from semestra.modules.lms.errors import lms_error
from semestra.modules.lms.providers.base import Io
from semestra.modules.lms.providers.canvas.config import (
    API_PREFIX,
    CanvasConfig,
    CanvasCredentials,
    mask_token,
    normalize_base_url,
    normalize_token,
)
from semestra.modules.lms.schemas.dto import (
    ALL_FEATURES,
    FRONT_PAGE_REF,
    Announcement,
    Assignment,
    ConnectionSummary,
    FileMeta,
    GradeItem,
    InternalRef,
    LmsCalendarEvent,
    LmsCourse,
    LmsFeature,
    Module,
    ModuleItem,
    NavKind,
    NavTab,
    PageDetail,
    PageSummary,
    Quiz,
    RichText,
    Submission,
)

MAX_PAGES = 50
PER_PAGE = 100
MAX_REDIRECTS = 5
# Canvas accepts at most 10 context codes per calendar request.
CONTEXT_CODES_PER_REQUEST = 10
ANNOUNCEMENT_LOOKBACK = timedelta(days=180)
# Where Canvas hands out file downloads besides the instance itself.
FILE_CDN_SUFFIXES = (
    ".instructure.com",
    ".canvas-user-content.com",
    ".inscloudgate.net",
    ".instructure-uploads.s3.amazonaws.com",
)
NAV_KINDS: dict[str, NavKind] = {
    k: k
    for k in (
        "home",
        "announcements",
        "assignments",
        "grades",
        "modules",
        "pages",
        "quizzes",
        "syllabus",
        "files",
        "discussions",
    )
}  # pyright: ignore[reportAssignmentType]
MODULE_ITEM_KINDS = {
    "Page": "page",
    "Assignment": "assignment",
    "Quiz": "quiz",
    "File": "file",
    "Discussion": "discussion",
    "SubHeader": "subheader",
    "ExternalUrl": "external_url",
    "ExternalTool": "external_tool",
}
LINK_PATTERNS: tuple[tuple[str, str], ...] = (
    (r"/courses/[^/]+/pages/([^/?#]+)", "page"),
    (r"/courses/[^/]+/wiki/([^/?#]+)", "page"),
    (r"/courses/[^/]+/assignments/(\d+)", "assignment"),
    (r"/courses/[^/]+/quizzes/(\d+)", "quiz"),
    (r"/courses/[^/]+/files/(\d+)", "file"),
    (r"/courses/[^/]+/modules/(\d+)", "module"),
    (r"/courses/[^/]+/announcements/(\d+)", "announcement"),
    (r"/courses/[^/]+/discussion_topics/(\d+)", "discussion"),
)


def _absolute(cfg: BaseModel, url: str | None) -> str | None:
    return urljoin(f"{_cfg(cfg).base_url}/", url) if url else None


def _cfg(cfg: BaseModel) -> CanvasConfig:
    return cast(CanvasConfig, cfg)


def _token(creds: BaseModel) -> str:
    return cast(CanvasCredentials, creds).access_token.get_secret_value()


def _text(value: Any) -> str | None:
    text = str(value).strip() if value is not None else ""
    return text or None


def _num(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return float(value)
    except TypeError, ValueError:
        return None


def _int(value: Any, default: int = 0) -> int:
    number = _num(value)
    return int(number) if number is not None else default


DEFAULT_PORTS = {"https": 443, "http": 80}


def _origin(url: str) -> str:
    """scheme://host[:port]; "" for a URL that doesn't parse (a bad port in course HTML), so it
    never matches the Canvas origin."""
    parts = urlsplit(url)
    scheme = parts.scheme.lower()
    try:
        port = parts.port
    except ValueError:
        return ""
    if port == DEFAULT_PORTS.get(scheme):
        port = None  # https://x:443 and https://x are the same origin
    return f"{scheme}://{(parts.hostname or '').lower()}{f':{port}' if port else ''}"


def _body(response: httpx.Response) -> str:
    try:
        return response.text
    except httpx.ResponseNotRead:  # a streamed download: the headers have to do
        return ""


def _map_status(response: httpx.Response) -> AppError | None:
    status = response.status_code
    if status < 300:
        return None
    if status < 400:
        # The API never redirects; a redirect means the address is not a Canvas API (a login
        # page, another site).
        return lms_error("lms.invalid_config", field="base_url", reason="redirect")
    if status == 401:
        # A bad or expired token gets `WWW-Authenticate: Bearer`; a 401 without it is Canvas
        # refusing one resource (a locked page or file) to a signed-in user.
        if "www-authenticate" in response.headers:
            return lms_error("lms.invalid_credentials")
        return lms_error("lms.forbidden")
    if status == 403:
        # Canvas throttles with 403 "(Rate Limit Exceeded)" unless the site opts into 429
        # (request_throttle.rb); X-Rate-Limit-Remaining is sent on every response, so only an
        # empty bucket counts.
        remaining = _num(response.headers.get("x-rate-limit-remaining"))
        if (remaining is not None and remaining <= 0) or "Rate Limit Exceeded" in _body(response):
            return lms_error("lms.rate_limited", retry_after=60)
        return lms_error("lms.forbidden")
    if status == 404:
        return AppError("common.not_found", 404)
    if status == 429:
        retry = _int(response.headers.get("retry-after"), 60)
        return lms_error("lms.rate_limited", retry_after=retry)
    return lms_error("lms.unreachable", upstream_status=status)


def _next_link(response: httpx.Response) -> str | None:
    for part in response.headers.get("link", "").split(","):
        match = re.match(r'\s*<([^>]+)>\s*;\s*rel="?next"?', part)
        if match:
            return match.group(1)
    return None


async def _resolve(host: str, port: int) -> list[str]:
    try:
        infos = await anyio.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except OSError:
        raise lms_error("lms.unreachable") from None
    return [str(info[4][0]) for info in infos]


async def _check_host(settings: Settings, url: str) -> None:
    """The address a redirect points at must be public (safe_client checks again on connect)."""
    if settings.allow_private_egress:
        return
    parts = urlsplit(url)
    host = parts.hostname
    if not host:
        raise lms_error("lms.blocked_address")
    try:
        ipaddress.ip_address(host)
        addresses = [host]
    except ValueError:
        try:
            port = parts.port
        except ValueError:  # malformed or out of range
            raise lms_error("lms.blocked_address") from None
        addresses = await _resolve(host, port or 443)
    if not addresses or not all(is_public_address(a) for a in addresses):
        raise lms_error("lms.blocked_address")


class CanvasProvider:
    kind: ClassVar[str] = "canvas"
    display_name: ClassVar[str] = "Canvas"
    config_model: ClassVar[type[BaseModel]] = CanvasConfig
    credentials_model: ClassVar[type[BaseModel]] = CanvasCredentials
    features: ClassVar[frozenset[LmsFeature]] = ALL_FEATURES

    # --- config ---------------------------------------------------------------------------

    def normalize_config(self, raw: dict[str, Any], settings: Settings) -> BaseModel:
        return CanvasConfig(base_url=normalize_base_url(str(raw.get("base_url") or ""), settings))

    def normalize_credentials(self, raw: dict[str, Any]) -> BaseModel:
        value = raw.get("access_token")
        return CanvasCredentials.model_validate({"access_token": normalize_token(str(value or ""))})

    def mask_credentials(self, creds: BaseModel) -> dict[str, str]:
        return {"access_token": mask_token(_token(creds))}

    def rewrite_internal_link(self, cfg: BaseModel, url: str) -> InternalRef | None:
        base = _cfg(cfg).base_url
        absolute = urljoin(f"{base}/", url)
        if _origin(absolute) != _origin(base):
            return None
        path = urlsplit(absolute).path.removeprefix(API_PREFIX)
        for pattern, kind in LINK_PATTERNS:
            match = re.search(pattern, path)
            if match:
                return InternalRef(kind=kind, ref=unquote(match.group(1)))  # pyright: ignore[reportArgumentType]
        return None

    # --- transport ------------------------------------------------------------------------

    async def _send(
        self, io: Io, url: str, token: str | None, params: Any = None, *, stream: bool = False
    ) -> httpx.Response:
        headers = {"Accept": "application/json"}
        if token is not None:
            headers["Authorization"] = f"Bearer {token}"
        try:
            request = io.client.build_request("GET", url, params=params, headers=headers)
            return await io.client.send(request, stream=stream)
        except AppError as exc:
            if exc.code == "common.egress_blocked":
                raise lms_error("lms.blocked_address") from None
            raise
        except httpx.HTTPError:
            raise lms_error("lms.unreachable") from None

    async def _get(
        self, io: Io, cfg: BaseModel, creds: BaseModel, path: str, params: Any = None
    ) -> Any:
        url = f"{_cfg(cfg).base_url}{API_PREFIX}{path}"
        response = await self._send(io, url, _token(creds), params)
        if error := _map_status(response):
            raise error
        try:
            return response.json()
        except ValueError:
            raise lms_error("lms.unreachable", reason="payload") from None

    async def _list(
        self, io: Io, cfg: BaseModel, creds: BaseModel, path: str, params: Any = None
    ) -> list[dict[str, Any]]:
        """Follows `Link: rel=next` (same origin only) up to MAX_PAGES pages."""
        base = _cfg(cfg).base_url
        url: str | None = f"{base}{API_PREFIX}{path}"
        query: Any = [*(params or []), ("per_page", PER_PAGE)]
        items: list[dict[str, Any]] = []
        pages = 0
        while url is not None:
            if pages == MAX_PAGES:
                io.truncated = True
                break
            response = await self._send(io, url, _token(creds), query)
            if error := _map_status(response):
                raise error
            try:
                payload = response.json()
            except ValueError:
                raise lms_error("lms.unreachable", reason="payload") from None
            if isinstance(payload, list):
                items += [p for p in cast(list[Any], payload) if isinstance(p, dict)]
            pages += 1
            url = _next_link(response)
            if url is not None and _origin(url) != _origin(base):
                url = None
            query = None  # the next link carries the query
        return items

    # --- reads ----------------------------------------------------------------------------

    async def validate(self, io: Io, cfg: BaseModel, creds: BaseModel) -> ConnectionSummary:
        profile = await self._get(io, cfg, creds, "/users/self/profile")
        if not isinstance(profile, dict):
            raise lms_error("lms.unreachable", reason="payload")
        data = cast(dict[str, Any], profile)
        return ConnectionSummary(
            account_name=_text(data.get("name")) or _text(data.get("short_name")),
            avatar_url=_text(data.get("avatar_url")),
            instance_name=urlsplit(_cfg(cfg).base_url).hostname,
        )

    def _course(self, cfg: BaseModel, data: dict[str, Any], now: datetime) -> LmsCourse:
        term = data.get("term") if isinstance(data.get("term"), dict) else None
        term_data = cast(dict[str, Any], term or {})
        course = LmsCourse(
            external_id=str(data.get("id") or ""),
            web_url=f"{_cfg(cfg).base_url}/courses/{data.get('id')}",
            raw_kind="course",
            code=_text(data.get("course_code")),
            name=_text(data.get("name")) or str(data.get("id") or ""),
            term=_text(term_data.get("name")),
            start_at=data.get("start_at") or term_data.get("start_at"),
            end_at=data.get("end_at") or term_data.get("end_at"),
            default_view=_text(data.get("default_view")),
        )
        ended = course.end_at is not None and course.end_at < now
        course.is_current = data.get("workflow_state") != "completed" and not ended
        return course

    async def list_courses(
        self, io: Io, cfg: BaseModel, creds: BaseModel, *, include_past: bool
    ) -> list[LmsCourse]:
        params: list[tuple[str, Any]] = [("include[]", "term")]
        if not include_past:
            params.append(("enrollment_state", "active"))
        now = datetime.now(UTC)
        rows = await self._list(io, cfg, creds, "/courses", params)
        if include_past:
            # Without enrollment_state Canvas lists only current-ish enrollments; finished
            # courses come from enrollment_state=completed (courses_controller#index).
            seen = {r.get("id") for r in rows}
            done = await self._list(
                io, cfg, creds, "/courses", [*params, ("enrollment_state", "completed")]
            )
            rows += [r for r in done if r.get("id") not in seen]
        courses = [self._course(cfg, r, now) for r in rows if r.get("id") and r.get("name")]
        if not include_past:
            for course in courses:
                course.is_current = True
        return courses

    async def get_course(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str
    ) -> LmsCourse:
        data = await self._get(
            io, cfg, creds, f"/courses/{quote(course_id)}", [("include[]", "term")]
        )
        return self._course(cfg, cast(dict[str, Any], data), datetime.now(UTC))

    async def navigation(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str
    ) -> list[NavTab]:
        rows = await self._list(io, cfg, creds, f"/courses/{quote(course_id)}/tabs")
        tabs: list[NavTab] = []
        for r in rows:
            tab_id = str(r.get("id") or "")
            kind: NavKind = (
                "external" if r.get("type") == "external" else NAV_KINDS.get(tab_id, "unknown")
            )
            tabs.append(
                NavTab(
                    external_id=tab_id,
                    # `html_url` is relative in the Tab object (`/courses/1/external_tools/4`).
                    web_url=_absolute(cfg, _text(r.get("full_url")) or _text(r.get("html_url"))),
                    raw_kind=_text(r.get("type")),
                    kind=kind,
                    label=_text(r.get("label")) or tab_id,
                    position=_int(r.get("position")),
                    hidden=bool(r.get("hidden")) or r.get("visibility") == "none",
                )
            )
        return sorted(tabs, key=lambda t: t.position)

    async def announcements(
        self,
        io: Io,
        cfg: BaseModel,
        creds: BaseModel,
        course_id: str,
        *,
        since: datetime | None = None,
    ) -> list[Announcement]:
        now = datetime.now(UTC)
        start = since or now - ANNOUNCEMENT_LOOKBACK
        params = [
            ("context_codes[]", f"course_{course_id}"),
            ("start_date", start.date().isoformat()),
            ("end_date", (now + timedelta(days=1)).date().isoformat()),
        ]
        rows = await self._list(io, cfg, creds, "/announcements", params)
        out = [
            Announcement(
                external_id=str(r.get("id") or ""),
                web_url=_text(r.get("html_url")),
                raw_kind="announcement",
                title=_text(r.get("title")) or "",
                html=_text(r.get("message")),
                author=_text(cast(dict[str, Any], r.get("author") or {}).get("display_name"))
                if isinstance(r.get("author"), dict)
                else _text(r.get("user_name")),
                posted_at=r.get("posted_at") or r.get("created_at"),
                updated_at=r.get("last_reply_at") or r.get("updated_at"),
                unread=r.get("read_state") == "unread",
            )
            for r in rows
        ]
        return sorted(out, key=lambda a: a.posted_at or now, reverse=True)

    async def assignments(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str
    ) -> list[Assignment]:
        course = await self._get(io, cfg, creds, f"/courses/{quote(course_id)}")
        weighted = bool(cast(dict[str, Any], course).get("apply_assignment_group_weights"))
        groups = await self._list(
            io,
            cfg,
            creds,
            f"/courses/{quote(course_id)}/assignment_groups",
            [("include[]", "assignments"), ("include[]", "submission")],
        )
        out: list[Assignment] = []
        for group in groups:
            for a in cast(list[dict[str, Any]], group.get("assignments") or []):
                sub = a.get("submission") if isinstance(a.get("submission"), dict) else None
                submission = None
                if sub is not None:
                    s = cast(dict[str, Any], sub)
                    submission = Submission(
                        state=_text(s.get("workflow_state")),
                        submitted_at=s.get("submitted_at"),
                        graded_at=s.get("graded_at"),
                        score=_num(s.get("score")),
                        grade=_text(s.get("grade")),
                        late=bool(s.get("late")),
                        missing=bool(s.get("missing")),
                    )
                out.append(
                    Assignment(
                        external_id=str(a.get("id") or ""),
                        web_url=_text(a.get("html_url")),
                        raw_kind="quiz" if a.get("is_quiz_assignment") else "assignment",
                        name=_text(a.get("name")) or str(a.get("id") or ""),
                        html=_text(a.get("description")),
                        due_at=a.get("due_at"),
                        unlock_at=a.get("unlock_at"),
                        lock_at=a.get("lock_at"),
                        points=_num(a.get("points_possible")),
                        group_id=_text(group.get("id")),
                        group_name=_text(group.get("name")),
                        group_weight=_num(group.get("group_weight")) if weighted else None,
                        submission_types=[str(t) for t in a.get("submission_types") or []],
                        submission=submission,
                        published=a.get("published", True) is not False,
                        updated_at=a.get("updated_at"),
                    )
                )
        return out

    async def grades(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str
    ) -> list[GradeItem]:
        enrollments = await self._list(
            io,
            cfg,
            creds,
            f"/courses/{quote(course_id)}/enrollments",
            [("user_id", "self"), ("type[]", "StudentEnrollment")],
        )
        out: list[GradeItem] = []
        for e in enrollments:
            grades = cast(dict[str, Any], e.get("grades") or {})
            out.append(
                GradeItem(
                    external_id=f"total:{e.get('id')}",
                    web_url=_text(grades.get("html_url")),
                    raw_kind="enrollment",
                    name=_text(e.get("course_section_id")) or "total",
                    score=_num(grades.get("current_score")),
                    grade=_text(grades.get("current_grade")),
                    kind="total",
                )
            )
            break  # one student enrollment is enough for the course total
        for a in await self.assignments(io, cfg, creds, course_id):
            sub = a.submission
            out.append(
                GradeItem(
                    external_id=a.external_id,
                    web_url=a.web_url,
                    raw_kind="submission",
                    name=a.name,
                    score=sub.score if sub else None,
                    points_possible=a.points,
                    grade=sub.grade if sub else None,
                    group_name=a.group_name,
                    graded_at=sub.graded_at if sub else None,
                )
            )
        return out

    async def modules(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str
    ) -> list[Module]:
        rows = await self._list(io, cfg, creds, f"/courses/{quote(course_id)}/modules")
        base = _cfg(cfg).base_url
        return [
            Module(
                external_id=str(r.get("id") or ""),
                web_url=f"{base}/courses/{course_id}/modules#module_{r.get('id')}",
                raw_kind="module",
                name=_text(r.get("name")) or "",
                position=_int(r.get("position")),
                state=_text(r.get("state")) or _text(r.get("workflow_state")),
                unlock_at=r.get("unlock_at"),
                item_count=_int(r.get("items_count")),
            )
            for r in rows
        ]

    async def module_items(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str, module_id: str
    ) -> list[ModuleItem]:
        rows = await self._list(
            io,
            cfg,
            creds,
            f"/courses/{quote(course_id)}/modules/{quote(module_id)}/items",
            [("include[]", "content_details")],
        )
        out: list[ModuleItem] = []
        for r in rows:
            raw = str(r.get("type") or "")
            kind = MODULE_ITEM_KINDS.get(raw, "unknown")
            target: InternalRef | None = None
            if kind == "page" and r.get("page_url"):
                target = InternalRef(kind="page", ref=str(r["page_url"]))
            elif kind in ("assignment", "quiz", "file", "discussion") and r.get("content_id"):
                target = InternalRef(kind=kind, ref=str(r["content_id"]))  # pyright: ignore[reportArgumentType]
            out.append(
                ModuleItem(
                    external_id=str(r.get("id") or ""),
                    web_url=_text(r.get("html_url")),
                    raw_kind=raw or None,
                    title=_text(r.get("title")) or "",
                    kind=kind,  # pyright: ignore[reportArgumentType]
                    position=_int(r.get("position")),
                    indent=_int(r.get("indent")),
                    target=target,
                    external_url=_text(r.get("external_url")),
                )
            )
        return out

    def _page_summary(self, r: dict[str, Any]) -> PageSummary:
        return PageSummary(
            external_id=str(r.get("page_id") or r.get("url") or ""),
            web_url=_text(r.get("html_url")),
            raw_kind="page",
            ref=str(r.get("url") or r.get("page_id") or ""),
            title=_text(r.get("title")) or "",
            updated_at=r.get("updated_at"),
            front_page=bool(r.get("front_page")),
        )

    async def pages(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str
    ) -> list[PageSummary]:
        rows = await self._list(
            io, cfg, creds, f"/courses/{quote(course_id)}/pages", [("sort", "title")]
        )
        return [self._page_summary(r) for r in rows]

    async def page(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str, page_ref: str
    ) -> PageDetail:
        path = (
            f"/courses/{quote(course_id)}/front_page"
            if page_ref == FRONT_PAGE_REF
            else f"/courses/{quote(course_id)}/pages/{quote(page_ref, safe='')}"
        )
        r = cast(dict[str, Any], await self._get(io, cfg, creds, path))
        summary = self._page_summary(r)
        return PageDetail(
            **summary.model_dump(),
            html=_text(r.get("body")),
            locked=bool(r.get("locked_for_user")),
        )

    async def quizzes(self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str) -> list[Quiz]:
        rows = await self._list(io, cfg, creds, f"/courses/{quote(course_id)}/quizzes")
        return [
            Quiz(
                external_id=str(r.get("id") or ""),
                web_url=_text(r.get("html_url")),
                raw_kind=_text(r.get("quiz_type")) or "quiz",
                title=_text(r.get("title")) or "",
                html=_text(r.get("description")),
                due_at=r.get("due_at"),
                unlock_at=r.get("unlock_at"),
                lock_at=r.get("lock_at"),
                points=_num(r.get("points_possible")),
                question_count=_int(r.get("question_count")) if r.get("question_count") else None,
            )
            for r in rows
        ]

    async def syllabus(self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str) -> RichText:
        r = cast(
            dict[str, Any],
            await self._get(
                io, cfg, creds, f"/courses/{quote(course_id)}", [("include[]", "syllabus_body")]
            ),
        )
        return RichText(
            html=_text(r.get("syllabus_body")),
            web_url=f"{_cfg(cfg).base_url}/courses/{course_id}/assignments/syllabus",
        )

    async def file(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str, file_id: str
    ) -> FileMeta:
        r = cast(
            dict[str, Any],
            await self._get(io, cfg, creds, f"/courses/{quote(course_id)}/files/{quote(file_id)}"),
        )
        return FileMeta(
            external_id=str(r.get("id") or file_id),
            web_url=f"{_cfg(cfg).base_url}/courses/{course_id}/files/{file_id}",
            raw_kind="file",
            name=_text(r.get("display_name")) or _text(r.get("filename")) or file_id,
            mime_type=_text(r.get("content-type")),
            size_bytes=_int(r.get("size")) if r.get("size") is not None else None,
            updated_at=r.get("updated_at"),
            locked=bool(r.get("locked_for_user")),
            download_url=_text(r.get("url")),
        )

    def _allowed_hop(self, base: str, url: str) -> bool:
        if _origin(url) == _origin(base):
            return True
        parts = urlsplit(url)
        host = (parts.hostname or "").lower()
        return parts.scheme == "https" and any(
            host == s.lstrip(".") or host.endswith(s) for s in FILE_CDN_SUFFIXES
        )

    async def open_file(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str, file_id: str
    ) -> AsyncIterator[bytes]:
        meta = await self.file(io, cfg, creds, course_id, file_id)
        if meta.locked or not meta.download_url:
            raise lms_error("lms.forbidden")
        base = _cfg(cfg).base_url
        url = urljoin(f"{base}/", meta.download_url)
        for _ in range(MAX_REDIRECTS + 1):
            if not self._allowed_hop(base, url):
                raise lms_error("lms.blocked_address")
            await _check_host(io.settings, url)
            same = _origin(url) == _origin(base)
            response = await self._send(io, url, _token(creds) if same else None, stream=True)
            if 300 <= response.status_code < 400:
                location = response.headers.get("location")
                await response.aclose()
                if not location:
                    raise lms_error("lms.unreachable", reason="redirect")
                url = urljoin(url, location)
                continue
            if error := _map_status(response):
                await response.aclose()
                raise error
            try:
                async for chunk in response.aiter_bytes():
                    yield chunk
            except httpx.HTTPError:
                raise lms_error("lms.unreachable") from None
            finally:
                await response.aclose()
            return
        raise lms_error("lms.unreachable", reason="redirects")

    async def calendar_events(
        self,
        io: Io,
        cfg: BaseModel,
        creds: BaseModel,
        course_ids: Sequence[str],
        start: datetime,
        end: datetime,
    ) -> list[LmsCalendarEvent]:
        out: list[LmsCalendarEvent] = []
        ids = list(dict.fromkeys(course_ids))
        for i in range(0, len(ids), CONTEXT_CODES_PER_REQUEST):
            chunk = ids[i : i + CONTEXT_CODES_PER_REQUEST]
            for kind in ("event", "assignment"):
                params: list[tuple[str, Any]] = [
                    ("type", kind),
                    ("start_date", start.astimezone(UTC).isoformat()),
                    ("end_date", end.astimezone(UTC).isoformat()),
                    *(("context_codes[]", f"course_{c}") for c in chunk),
                ]
                for r in await self._list(io, cfg, creds, "/calendar_events", params):
                    event = self._calendar_event(r, kind)
                    if event is not None:
                        out.append(event)
        return out

    def _calendar_event(self, r: dict[str, Any], kind: str) -> LmsCalendarEvent | None:
        context = str(r.get("context_code") or "")
        if not context.startswith("course_"):
            return None
        assignment = cast(dict[str, Any], r.get("assignment") or {})
        start = r.get("start_at") or assignment.get("due_at")
        if not start:
            return None
        return LmsCalendarEvent(
            external_id=str(r.get("id") or ""),
            web_url=_text(r.get("html_url")),
            raw_kind=kind,
            external_course_id=context.removeprefix("course_"),
            kind="assignment" if kind == "assignment" else "event",
            title=_text(r.get("title")) or _text(assignment.get("name")) or "",
            html=_text(r.get("description")) or _text(assignment.get("description")),
            location=_text(r.get("location_name")),
            start_at=start,
            end_at=None if kind == "assignment" else r.get("end_at"),
            all_day=bool(r.get("all_day")),
            assignment_id=_text(assignment.get("id")) if kind == "assignment" else None,
        )
