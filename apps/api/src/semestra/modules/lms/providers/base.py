"""The provider contract (M09 §2.1) and the registry of providers.

A provider maps one platform onto the module's DTOs (`schemas/dto.py`). It never sees the
database or the user: the module hands it the normalized config, the decrypted credentials and
an `Io` (the outbound HTTP client and a place to report truncated lists).
"""

from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, ClassVar, Protocol, runtime_checkable

import httpx
from pydantic import BaseModel

from semestra.core.config import Settings
from semestra.modules.lms.schemas.dto import (
    Announcement,
    Assignment,
    ConnectionSummary,
    FileMeta,
    FolderListing,
    GradeItem,
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


class LmsProvider(Protocol):
    kind: ClassVar[str]
    display_name: ClassVar[str]
    config_model: ClassVar[type[BaseModel]]
    credentials_model: ClassVar[type[BaseModel]]
    features: ClassVar[frozenset[LmsFeature]]

    def normalize_config(self, raw: dict[str, Any], settings: Settings) -> BaseModel: ...
    def normalize_credentials(self, raw: dict[str, Any]) -> BaseModel: ...
    def mask_credentials(self, creds: BaseModel) -> dict[str, str]: ...
    def rewrite_internal_link(self, cfg: BaseModel, url: str) -> InternalRef | None: ...

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
        since: datetime | None = None,
    ) -> list[Announcement]:
        """Announcements of several courses at once (a term's board), each naming its course in
        `external_course_id`."""
        ...

    async def assignments(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str
    ) -> list[Assignment]: ...
    async def grade_totals(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str
    ) -> list[GradeItem]:
        """The course total(s) (`kind="total"`). Per-assignment grades come from `assignments`
        (their `submission`), so the module builds them without asking the platform again."""
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
        """`page_ref` may be `FRONT_PAGE_REF`: the front page (`common.not_found` if none)."""
        ...

    async def quizzes(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str
    ) -> list[Quiz]: ...
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

    async def folder(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str, folder_id: str | None
    ) -> FolderListing:
        """A folder of the course's files, the root for None (feature `folders`); a folder of
        another course is `common.not_found`."""
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
        start: datetime,
        end: datetime,
    ) -> list[LmsCalendarEvent]: ...


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
