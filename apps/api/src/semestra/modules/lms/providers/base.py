"""The provider contract (M09 §2.1) and the registry of providers.

A provider maps one platform onto the module's DTOs (`schemas/dto.py`). It never sees the
database or the user: the module hands it the normalized config, the decrypted credentials and
an `Io` (the outbound HTTP client and a place to report truncated lists).
"""

from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, ClassVar, Protocol

import httpx
from pydantic import BaseModel

from semestra.core.config import Settings
from semestra.modules.lms.schemas.dto import (
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
    NavTab,
    PageDetail,
    PageSummary,
    Quiz,
    RichText,
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
        course_id: str,
        *,
        since: datetime | None = None,
    ) -> list[Announcement]: ...
    async def assignments(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str
    ) -> list[Assignment]: ...
    async def grades(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str
    ) -> list[GradeItem]: ...
    async def modules(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str
    ) -> list[Module]: ...
    async def module_items(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str, module_id: str
    ) -> list[ModuleItem]: ...
    async def pages(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str
    ) -> list[PageSummary]: ...
    async def page(
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str, page_ref: str
    ) -> PageDetail: ...
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
        self, io: Io, cfg: BaseModel, creds: BaseModel, course_id: str, file_id: str
    ) -> AsyncIterator[bytes]: ...
    async def calendar_events(
        self,
        io: Io,
        cfg: BaseModel,
        creds: BaseModel,
        course_ids: Sequence[str],
        start: datetime,
        end: datetime,
    ) -> list[LmsCalendarEvent]: ...


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
