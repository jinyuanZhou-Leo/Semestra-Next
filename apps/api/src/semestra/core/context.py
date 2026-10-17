"""Request context (M00 §3.4).

`Ctx` is what every service function and capability receives. The identity behind it is resolved
by the authenticator that the auth module (M01) installs on `app.state.authenticator`; core only
knows the protocol so that it never imports a feature module at runtime.
"""

import re
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import TYPE_CHECKING, Annotated, Literal, Protocol

import structlog
from fastapi import Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from starlette.datastructures import State

from semestra.core.config import Settings
from semestra.core.errors import AppError

if TYPE_CHECKING:
    from semestra.modules.auth.models import AuthUser

SUPPORTED_LOCALES = ("en", "zh-CN")
DEFAULT_LOCALE = "en"
Actor = Literal["user", "agent", "mcp", "system"]


@dataclass(frozen=True)
class ScopeRef:
    program_id: str
    term_id: str | None = None
    course_id: str | None = None

    @classmethod
    def parse(cls, header: str | None) -> ScopeRef | None:
        """`program:<id>;term:<id>;course:<id>` → ScopeRef. Malformed input is ignored."""
        if not header:
            return None
        parts: dict[str, str] = {}
        for chunk in header.split(";"):
            key, sep, value = chunk.strip().partition(":")
            if sep and value:
                parts[key.strip()] = value.strip()
        if "program" not in parts:
            return None
        return cls(parts["program"], parts.get("term"), parts.get("course"))


@dataclass(frozen=True)
class AuthInfo:
    """How the request was authenticated. `pat` requests are restricted (see capability.py)."""

    kind: Literal["cookie", "jwt", "pat"]
    session_id: str | None = None
    token_id: str | None = None
    scopes: tuple[str, ...] = ()
    session_created_at: datetime | None = None


@dataclass
class Identity:
    user: AuthUser
    auth: AuthInfo
    # Set when the authenticator extended the session and the cookie must be re-issued.
    cookie_token: str | None = None


@dataclass
class Ctx:
    db: AsyncSession
    user: AuthUser | None
    locale: str
    now: datetime
    scope: ScopeRef | None
    actor: Actor
    request_id: str
    auth: AuthInfo | None = field(default=None)
    # Side effects (emails, ...) to run once the transaction has been committed.
    after_commit: list[Callable[[], Awaitable[None]]] = field(default_factory=lambda: [])
    # `app.state`: settings, session factory and module runtimes (mailer, ...) hang off it.
    state: State = field(default_factory=State)

    @property
    def settings(self) -> Settings:
        return self.state.settings

    @property
    def user_id(self) -> str:
        if self.user is None:
            raise AppError("common.unauthenticated", 401)
        return self.user.id


async def run_after_commit(ctx: Ctx) -> None:
    """Runs deferred side effects; one failing must not stop the others or the response."""
    callbacks, ctx.after_commit = ctx.after_commit, []
    for callback in callbacks:
        try:
            await callback()
        except Exception:
            structlog.get_logger().exception("after_commit_failed")


class Authenticator(Protocol):
    async def __call__(
        self, request: Request, response: Response, db: AsyncSession, now: datetime
    ) -> Identity | None: ...


def pick_locale(accept_language: str | None, preferred: str | None = None) -> str:
    """User preference first, then the best Accept-Language match, then English."""
    if preferred in SUPPORTED_LOCALES:
        return preferred  # pyright: ignore[reportReturnType]
    for part in (accept_language or "").split(","):
        tag = part.split(";")[0].strip().lower()
        if not tag:
            continue
        if tag.startswith("zh"):
            return "zh-CN"
        if re.fullmatch(r"en(-\w+)?", tag):
            return "en"
    return DEFAULT_LOCALE


def client_ip(request: Request, trusted_hops: int = 0) -> str | None:
    if trusted_hops > 0:
        forwarded = [p.strip() for p in request.headers.get("x-forwarded-for", "").split(",")]
        forwarded = [p for p in forwarded if p]
        if len(forwarded) >= trusted_hops:
            return forwarded[-trusted_hops]
    return request.client.host if request.client else None


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    factory: async_sessionmaker[AsyncSession] = request.app.state.session_factory
    async with factory() as session:
        yield session


async def _build_ctx(
    request: Request,
    response: Response,
    db: AsyncSession,
    *,
    required: bool,
    allow_pat: bool,
    authenticate: bool = True,
) -> Ctx:
    now: datetime = request.app.state.now()
    authenticator: Authenticator | None = getattr(request.app.state, "authenticator", None)
    identity = (
        await authenticator(request, response, db, now) if authenticator and authenticate else None
    )
    if identity is None and required:
        raise AppError("common.unauthenticated", 401)
    if identity is not None and identity.auth.kind == "pat" and not allow_pat:
        raise AppError("auth.token_scope", 403)

    user = identity.user if identity else None
    auth = identity.auth if identity else None
    actor: Actor = "mcp" if auth and auth.kind == "pat" else "user"
    request_id: str = getattr(request.state, "request_id", None) or str(uuid.uuid7())
    return Ctx(
        db=db,
        user=user,
        locale=pick_locale(request.headers.get("accept-language"), user.locale if user else None),
        now=now,
        scope=ScopeRef.parse(request.headers.get("x-semestra-scope")),
        actor=actor,
        request_id=request_id,
        auth=auth,
        state=request.app.state,
    )


async def get_ctx(
    request: Request, response: Response, db: Annotated[AsyncSession, Depends(get_session)]
) -> Ctx:
    """Login required. Personal access tokens are rejected: they may only call capabilities."""
    return await _build_ctx(request, response, db, required=True, allow_pat=False)


async def get_optional_ctx(
    request: Request, response: Response, db: Annotated[AsyncSession, Depends(get_session)]
) -> Ctx:
    return await _build_ctx(request, response, db, required=False, allow_pat=False)


async def get_anonymous_ctx(
    request: Request, response: Response, db: Annotated[AsyncSession, Depends(get_session)]
) -> Ctx:
    """No authentication attempted (login endpoints: a stale cookie must not interfere)."""
    return await _build_ctx(
        request, response, db, required=False, allow_pat=False, authenticate=False
    )


async def get_capability_ctx(
    request: Request, response: Response, db: Annotated[AsyncSession, Depends(get_session)]
) -> Ctx:
    """Used by generated capability routes: the one place PATs are accepted."""
    return await _build_ctx(request, response, db, required=False, allow_pat=True)


NowFn = Callable[[], datetime]
