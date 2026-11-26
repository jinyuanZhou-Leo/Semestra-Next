"""The provider contract (M09 §2.1) and the registry of providers.

A provider maps one platform onto the module's DTOs (`schemas/dto.py`). It never sees the
database or the user: the module hands it the normalized config, the decrypted credentials and
an `Io` (the outbound HTTP client and a place to report truncated lists).
"""

import asyncio
import functools
from collections.abc import AsyncIterator, Callable, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from types import CoroutineType
from typing import Any, ClassVar, Literal, Protocol, cast, runtime_checkable

import httpx
from pydantic import BaseModel

from semestra.core.config import Settings
from semestra.core.errors import AppError
from semestra.modules.lms.answers import AreaResult, Gone, Unavailable
from semestra.modules.lms.gate import Gate
from semestra.modules.lms.schemas.dto import (
    Announcement,
    Assignment,
    ConnectionSummary,
    CourseTotal,
    Discussion,
    DiscussionDetail,
    FileMeta,
    FolderListing,
    InternalRef,
    LmsCalendarEvent,
    LmsCourse,
    LmsFeature,
    Module,
    ModuleItem,
    NavTab,
    PageDetail,
    PageSummary,
    Quiz,
    RichText,
    SubmissionDetail,
)


@dataclass
class Io:
    """What a provider call may use besides its config and credentials."""

    client: httpx.AsyncClient
    settings: Settings
    # Set by the provider when a list hit its page limit and was cut short.
    truncated: bool = False
    notes: dict[str, Any] = field(default_factory=dict)
    # The connection's limit on requests in flight (`gate.py`): a provider sends each request
    # through `gate.slot()` and tells it what the platform says is left of its rate limit.
    gate: Gate | None = None
    # Answers the calls of one sync round share (`service.shared_reads`), so an object several
    # stages read (the course) is asked for once; None outside a round.
    shared: dict[Any, Any] | None = None


@dataclass(frozen=True)
class Call:
    """A read a sync stage will make of the provider (`method(io, cfg, creds, *args, **kwargs)`),
    made ahead of it (`prefetch`)."""

    method: str
    args: tuple[Any, ...] = ()
    kwargs: dict[str, Any] = field(default_factory=lambda: {})

    @property
    def key(self) -> tuple[str, str, str]:
        return _shared_key(self.method, self.args, self.kwargs)


def _shared_key(method: str, args: tuple[Any, ...], kwargs: dict[str, Any]) -> tuple[str, str, str]:
    return (f"read:{method}", repr(args), repr(sorted(kwargs.items())))


def round_shared[**P, R](
    fn: Callable[P, CoroutineType[Any, Any, R]],
) -> Callable[P, CoroutineType[Any, Any, R]]:
    """Marks a provider read a sync round may make ahead (`prefetch`): called with the same
    arguments within the round, it is given that answer (or raises its error) once, instead of
    asking the platform again."""

    @functools.wraps(fn)
    async def read(*args: P.args, **kwargs: P.kwargs) -> R:
        io = cast(Io, args[1])
        if io.shared is not None:
            got = io.shared.pop(_shared_key(fn.__name__, tuple(args[4:]), dict(kwargs)), None)
            if got is not None:
                ok, value, truncated = got
                if not ok:
                    raise value
                io.truncated = io.truncated or truncated
                return value
        return await fn(*args, **kwargs)

    setattr(read, "round_shared", True)  # noqa: B010 (a flag `prefetch` reads)
    return read


async def prefetch(
    io: Io, provider: Any, cfg: BaseModel, creds: BaseModel, calls: Sequence[Call]
) -> None:
    """Makes these reads side by side (each through the connection's gate) and keeps each one's
    answer or error in the round's `io.shared`, for the stage that makes it (`round_shared`)."""
    shared = io.shared
    if shared is None:
        return

    # Only reads that take the answer made ahead (`round_shared`): any other would be made twice.
    calls = [c for c in calls if getattr(getattr(provider, c.method, None), "round_shared", False)]

    async def one(call: Call) -> None:
        own = Io(client=io.client, settings=io.settings, gate=io.gate, shared=shared)
        try:
            value = await getattr(provider, call.method)(own, cfg, creds, *call.args, **call.kwargs)
        except Exception as exc:
            shared[call.key] = (False, exc, False)
        else:
            shared[call.key] = (True, value, own.truncated)

    await asyncio.gather(*(one(c) for c in calls))


class LmsProvider(Protocol):
    kind: ClassVar[str]
    display_name: ClassVar[str]
    config_model: ClassVar[type[BaseModel]]
    credentials_model: ClassVar[type[BaseModel]]
    features: ClassVar[frozenset[LmsFeature]]

    def normalize_config(self, raw: dict[str, Any], settings: Settings) -> BaseModel: ...
    def normalize_credentials(self, raw: dict[str, Any]) -> BaseModel: ...
    def mask_credentials(self, creds: BaseModel) -> dict[str, str]: ...
    def web_base(self, cfg: BaseModel) -> str:
        """The platform's root address: relative links in its HTML resolve against it when the
        item has no address of its own (`web_url`)."""
        ...

    def rewrite_internal_link(self, cfg: BaseModel, url: str) -> InternalRef | None:
        """What an (absolute) address in the platform's HTML points at, if the app can open it."""
        ...

    def image_formula(self, cfg: BaseModel, url: str) -> str | None:
        """The formula (LaTeX) an image at this (absolute) address shows, for a platform whose
        editor inserts formulas as images; None for any other image."""
        ...

    def item_answer(self, error: AppError, *, area: AreaResult | None) -> Gone | Unavailable:
        """What a failed read of one item means (M09 §4.1, table 2): gone from the user's view, or
        not known. `area`: this round's result of the item's area (`answers.AREA_OF`), None when
        it was not read: a refusal tells the item is gone only where the area was read, as it
        may be about the whole area otherwise."""
        ...

    def area_answer(
        self, error: AppError, *, nav_closed: bool | None
    ) -> Literal["hidden", "unavailable"]:
        """What a failed read of an area's list means: closed to the user, or not known.
        `nav_closed`: the course's navigation this round leaves the area out or hides it (None:
        it could not be read)."""
        ...

    async def validate(self, io: Io, cfg: BaseModel, creds: BaseModel) -> ConnectionSummary: ...
    async def list_courses(
        self, io: Io, cfg: BaseModel, creds: BaseModel, *, include_past: bool
    ) -> list[LmsCourse]: ...
    async def get_course(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str
    ) -> LmsCourse: ...
    async def navigation(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str
    ) -> list[NavTab]: ...
    async def announcements(
        self,
        io: Io,
        cfg: BaseModel,
        creds: BaseModel,
        course_ids: Sequence[str],
        *,
        since: datetime,
    ) -> list[Announcement]:
        """Announcements of several courses posted since `since`, each naming its course in
        `external_course_id`."""
        ...

    async def assignments(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str
    ) -> list[Assignment]: ...
    async def assignment(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str, assignment_id: str
    ) -> Assignment:
        """One assignment read on its own (whether it is still there when its list is closed,
        M09 §4.2 table 3c); its group's weight is not given."""
        ...

    async def course_total(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str
    ) -> CourseTotal | None:
        """The user's course total (feature `grades`); None when the platform shows none.
        Per-assignment grades come with the submissions."""
        ...

    async def modules(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str
    ) -> list[Module]:
        """Modules, with their `items` when the platform can include them (None otherwise:
        then `module_items` is asked)."""
        ...

    async def module_items(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str, module_id: str
    ) -> list[ModuleItem]: ...
    async def pages(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str
    ) -> list[PageSummary]: ...
    async def page(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str, page_ref: str
    ) -> PageDetail:
        """`page_ref` may be `FRONT_PAGE_REF`: the front page (`lms.not_found` if none)."""
        ...

    async def quizzes(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str
    ) -> list[Quiz]: ...
    async def discussions(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str
    ) -> list[Discussion]:
        """The course's discussion topics, announcements left out (feature `discussions`)."""
        ...

    async def discussion(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str, topic_id: str
    ) -> DiscussionDetail:
        """One topic with its first replies; an announcement's id works too."""
        ...

    async def syllabus(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str
    ) -> RichText: ...
    async def file(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str, file_id: str
    ) -> FileMeta: ...
    def open_file(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str, file: FileMeta
    ) -> AsyncIterator[bytes]:
        """The file's bytes, from the metadata `file` returned (the module fetched it already)."""
        ...

    async def submission(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str, assignment_id: str
    ) -> SubmissionDetail:
        """The user's own submission with comments and rubric scores (feature `submissions`)."""
        ...

    async def submissions(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str
    ) -> list[SubmissionDetail]:
        """The user's own submissions of every assignment of the course, with comments and
        rubric scores, in one read (feature `submissions`): the sync keeps the teacher's
        feedback of the imported assignments from it."""
        ...

    async def folder(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str, folder_id: str | None
    ) -> FolderListing:
        """A folder of the course's files, the root for None (feature `folders`); a folder of
        another course is `lms.not_found`."""
        ...

    async def course_files(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str
    ) -> list[FileMeta]:
        """Every file of the course the user can see, each with its `folder_path` (feature
        `folders`); `lms.forbidden` or `lms.not_found` when the files area is hidden."""
        ...

    async def search_files(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str, term: str
    ) -> list[FileMeta]: ...
    async def mark_announcement_read(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str, announcement_id: str
    ) -> None:
        """Marks it read on the platform (feature `mark_read`, a write)."""
        ...

    async def calendar_events(
        self,
        io: Io,
        cfg: BaseModel,
        creds: BaseModel,
        course_ids: Sequence[str],
    ) -> list[LmsCalendarEvent]:
        """All calendar events of the courses, of any date (feature `calendar`), not assignments;
        an event for one section belongs to its course (M09 表 2 第 18 行)."""
        ...


@runtime_checkable
class SignInProvider(Protocol):
    """Optional: connecting by signing in on the platform's own page instead of pasting a token,
    with credentials that the module renews (`service.fresh`) and stores again."""

    def sign_in_enabled(self, settings: Settings) -> bool: ...
    async def start_sign_in(self, io: Io, cfg: BaseModel) -> str:
        """The address to open in the user's browser."""
        ...

    async def finish_sign_in(self, io: Io, cfg: BaseModel, pasted: str, now: datetime) -> BaseModel:
        """Credentials from what the user pasted back (the address the sign-in ended on)."""
        ...

    def credentials_stale(self, creds: BaseModel, now: datetime) -> bool: ...
    def can_refresh(self, creds: BaseModel) -> bool: ...
    async def refresh_credentials(
        self, io: Io, cfg: BaseModel, creds: BaseModel, now: datetime
    ) -> BaseModel:
        """Renewed credentials; `lms.invalid_credentials` once the sign-in was revoked."""
        ...

    async def revoke_credentials(
        self, io: Io, cfg: BaseModel, creds: BaseModel, now: datetime
    ) -> None:
        """Ends the sign-in, renewing expired credentials if the platform needs a live token.
        Raises when it could not; already ended is not a failure."""
        ...


def sign_in_support(provider: LmsProvider) -> SignInProvider | None:
    return provider if isinstance(provider, SignInProvider) else None


_providers: dict[str, LmsProvider] = {}


def register_lms_provider(provider: LmsProvider) -> LmsProvider:
    if provider.kind in _providers:
        raise ValueError(f"duplicate LMS provider {provider.kind!r}")
    _providers[provider.kind] = provider
    return provider


def unregister_lms_provider(kind: str) -> None:
    """For tests that register a fake provider."""
    _providers.pop(kind, None)


def get_provider(kind: str) -> LmsProvider:
    from semestra.modules.lms.errors import lms_error

    try:
        return _providers[kind]
    except KeyError:
        raise lms_error("lms.provider_unknown", provider=kind) from None


def all_providers() -> list[LmsProvider]:
    return [_providers[k] for k in sorted(_providers)]
