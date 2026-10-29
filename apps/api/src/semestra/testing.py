"""pytest fixtures shared by every module's tests (loaded with `-p semestra.testing`).

* `client` — httpx client bound to a fresh app and a fresh migrated SQLite file.
* `make_user`, `login_as`, `bearer_for` — M01's helpers (M00 §3.13).
* `mailer` / `google` — fakes for outgoing email and Google ID token verification.
* `clock` — move time forward to test expiry and rate-limit windows.
* `run_jobs` — run every due background job now (no worker runs in tests).
* `collect_events(app, user_id)` — the SSE messages a user would have received.
"""

import shutil
from collections.abc import AsyncIterator, Awaitable, Callable, Generator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from alembic import command
from alembic.config import Config
from argon2 import PasswordHasher
from fastapi import FastAPI
from fastapi import routing as fastapi_routing
from httpx import ASGITransport, AsyncClient
from starlette.types import ASGIApp, Receive, Scope, Send

from semestra.core.config import Settings
from semestra.core.events import drain
from semestra.main import create_app
from semestra.modules.auth import crypto, service
from semestra.modules.auth.google import GoogleClaims
from semestra.modules.auth.identity import CSRF_COOKIE, SESSION_COOKIE
from semestra.modules.auth.mailer import MemoryMailer
from semestra.modules.auth.models import AuthUser

API_DIR = Path(__file__).resolve().parents[2]
TEST_ORIGIN = "https://test"


class Clock:
    def __init__(self) -> None:
        self.now = datetime(2026, 1, 15, 12, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.now

    def advance(self, **kwargs: float) -> None:
        self.now += timedelta(**kwargs)


class FakeGoogle:
    """Maps ID token strings to claims; unknown tokens are rejected like a bad signature."""

    def __init__(self) -> None:
        self.tokens: dict[str, GoogleClaims] = {}

    def add(self, token: str, *, subject: str, email: str, name: str | None = "G User") -> str:
        self.tokens[token] = GoogleClaims(subject, email.lower(), name, "https://img/g.png")
        return token

    async def verify(self, id_token: str) -> GoogleClaims:
        from semestra.core.errors import AppError

        if id_token not in self.tokens:
            raise AppError("auth.google_invalid_token", 401)
        return self.tokens[id_token]


# Production argon2 settings cost ~0.1 s per hash; tests hash and verify hundreds of passwords.
_FAST_HASHER = PasswordHasher(time_cost=1, memory_cost=1024, parallelism=1)


@pytest.fixture(autouse=True)
def fast_password_hashing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(crypto, "_hasher", _FAST_HASHER)
    monkeypatch.setattr(crypto, "_DUMMY_HASH", _FAST_HASHER.hash("semestra-timing-equalizer"))


@pytest.fixture(scope="session", autouse=True)
def reuse_route_handlers() -> Generator[None]:
    """FastAPI builds every included route's dependant, fields and handler again for each new
    app (~3 ms a route, most of a test's time). Tests build one app per test from the same
    routers, so build each once per worker. The handler keeps the first app as its
    `dependency_overrides` provider: tests here don't override dependencies."""
    context_cls = getattr(fastapi_routing, "_EffectiveRouteContext", None)
    if context_cls is None:  # FastAPI changed its internals: just run slower
        yield
        return
    build = context_cls.from_api_route
    built: dict[tuple[int, int, str], tuple[object, object, object]] = {}

    def from_api_route(*, original_route: Any, include_context: Any) -> Any:
        key = (id(original_route), id(include_context.included_router), include_context.prefix)
        if (hit := built.get(key)) is None:
            context = build(original_route=original_route, include_context=include_context)
            # Keeping the route and router alive keeps their ids from being reused.
            hit = built[key] = (original_route, include_context.included_router, context)
        return hit[2]

    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(context_cls, "from_api_route", from_api_route)
        yield


@pytest.fixture(scope="session")
def migrated_template(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """One database with every migration applied; each test gets a copy (M00 §3.13)."""
    path = tmp_path_factory.mktemp("template") / "template.db"
    cfg = Config(str(API_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_DIR / "migrations"))
    cfg.attributes["database_url"] = f"sqlite+aiosqlite:///{path}"
    command.upgrade(cfg, "head")
    return path


@pytest.fixture
def settings(tmp_path: Path, migrated_template: Path) -> Settings:
    db_path = tmp_path / "test.db"
    shutil.copyfile(migrated_template, db_path)
    return Settings(
        env="test",
        data_dir=tmp_path,
        database_url=f"sqlite+aiosqlite:///{db_path}",
        cors_origins=["http://localhost:5173"],
        public_api_origin=TEST_ORIGIN,
        public_web_origin="https://web.test",
        google_client_id="test-client-id",
        storage_local_root=tmp_path / "storage",
        jobs_autostart=False,  # tests run the queue with `run_jobs()`
        ai_warm_up=False,
    )


@pytest.fixture
def clock() -> Clock:
    return Clock()


@pytest.fixture
def mailer() -> MemoryMailer:
    return MemoryMailer()


@pytest.fixture
def google() -> FakeGoogle:
    return FakeGoogle()


class _DrainEvents:
    """Event subscribers run in the background (`core.events`); tests read their effects right
    after a request, so each request here returns only once they are done."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        await self.app(scope, receive, send)
        if scope["type"] == "http":
            await drain(scope["app"].state)


@pytest.fixture
def app(settings: Settings, clock: Clock, mailer: MemoryMailer, google: FakeGoogle) -> FastAPI:
    app = create_app(settings)
    app.add_middleware(_DrainEvents)
    app.state.now = clock
    app.state.auth_runtime.mailer = mailer
    app.state.auth_runtime.google = google
    return app


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[AsyncClient]:
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app), base_url=TEST_ORIGIN) as c,
    ):
        yield c


@pytest.fixture
def run_jobs(app: FastAPI) -> Callable[[], Awaitable[None]]:
    async def _run() -> None:
        # Jobs publish events whose subscribers may enqueue more jobs.
        while True:
            await app.state.jobs.run_until_idle()
            if not getattr(app.state, "event_tasks", None):
                return
            await drain(app.state)

    return _run


@contextmanager
def collect_events(app: FastAPI, user_id: str) -> Generator[list[dict[str, Any]]]:
    """Messages pushed to `user_id` while the block runs; the list is filled when it exits."""
    messages: list[dict[str, Any]] = []
    with app.state.realtime.listen(user_id) as queue:
        try:
            yield messages
        finally:
            while not queue.empty():
                messages.append(queue.get_nowait()[1])


@dataclass
class UserHandle:
    id: str
    email: str
    password: str | None


MakeUser = Callable[..., Awaitable[UserHandle]]


@pytest.fixture
def make_user(app: FastAPI, clock: Clock, client: AsyncClient) -> MakeUser:
    """`await make_user(email="a@b.c", password="correct horse")` inserts a user directly."""
    del client  # ensures the app lifespan (and its session factory) is running

    async def _make(
        email: str = "student@example.com",
        password: str | None = None,
        display_name: str = "Test Student",
        locale: str | None = "en",
    ) -> UserHandle:
        async with app.state.session_factory() as db:
            user = AuthUser(
                email=email.lower(),
                email_verified_at=clock.now,
                display_name=display_name,
                password_hash=await crypto.hash_password(password) if password else None,
                locale=locale,
                created_at=clock.now,
                updated_at=clock.now,
            )
            db.add(user)
            await db.commit()
            return UserHandle(user.id, user.email, password)

    return _make


@pytest.fixture
def login_as(app: FastAPI, clock: Clock) -> Callable[[AsyncClient, UserHandle], Awaitable[str]]:
    """Signs `client` in as the user with a browser session; returns the session id.

    Also sends the CSRF header by default, like the real frontend.
    """

    async def _login(client: AsyncClient, user: UserHandle) -> str:
        async with app.state.session_factory() as db:
            row = await db.get(AuthUser, user.id)
            assert row is not None
            ctx_like = _MinimalCtx(db, app, clock)
            signed_in = await service.create_session(
                ctx_like,  # pyright: ignore[reportArgumentType]
                row,
                "web",
                service.RequestMeta(ip="127.0.0.1", user_agent="pytest"),
            )
            await db.commit()
        client.cookies.set(SESSION_COOKIE, signed_in.token)
        csrf = crypto.csrf_token_for(app.state.settings, signed_in.token)
        client.cookies.set(CSRF_COOKIE, csrf)
        client.headers["x-semestra-csrf"] = csrf
        return signed_in.session.id

    return _login


class _MinimalCtx:
    """Just enough of `Ctx` for `service.create_session`."""

    def __init__(self, db: object, app: FastAPI, clock: Clock) -> None:
        self.db = db
        self.settings = app.state.settings
        self.now = clock.now


@pytest.fixture
def bearer_for(app: FastAPI, clock: Clock) -> Callable[[UserHandle], Awaitable[dict[str, str]]]:
    """Authorization header with a fresh JWT access token (native session)."""

    async def _bearer(user: UserHandle) -> dict[str, str]:
        async with app.state.session_factory() as db:
            row = await db.get(AuthUser, user.id)
            assert row is not None
            signed_in = await service.create_session(
                _MinimalCtx(db, app, clock),  # pyright: ignore[reportArgumentType]
                row,
                "native",
                service.RequestMeta(ip=None, user_agent="pytest-native"),
            )
            await db.commit()
        token = crypto.issue_access_token(
            app.state.settings, user.id, signed_in.session.id, clock.now
        )
        return {"Authorization": f"Bearer {token}"}

    return _bearer


def last_code(mailer: MemoryMailer, to: str) -> str:
    """The 6-digit code in the newest email sent to `to`."""
    import re

    for msg in reversed(mailer.outbox):
        if msg.to == to.strip().lower():
            match = re.search(r"\b(\d{6})\b", msg.content.text)
            assert match, msg.content.text
            return match.group(1)
    raise AssertionError(f"no email sent to {to}")
