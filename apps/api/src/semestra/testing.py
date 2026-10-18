"""pytest fixtures shared by every module's tests (loaded with `-p semestra.testing`).

* `client` — httpx client bound to a fresh app and a fresh migrated SQLite file.
* `make_user`, `login_as`, `bearer_for` — M01's helpers (M00 §3.13).
* `mailer` / `google` — fakes for outgoing email and Google ID token verification.
* `clock` — move time forward to test expiry and rate-limit windows.
"""

import shutil
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from semestra.core.config import Settings
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


@pytest.fixture
def app(settings: Settings, clock: Clock, mailer: MemoryMailer, google: FakeGoogle) -> FastAPI:
    app = create_app(settings)
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
