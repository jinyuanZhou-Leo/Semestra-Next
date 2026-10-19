import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import structlog
from sqlalchemy import DateTime, ForeignKey, String, event
from sqlalchemy.engine import Dialect, make_url
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.types import TypeDecorator

from semestra.core.config import Settings, get_settings


def new_id() -> str:
    """UUIDv7 as a string primary key."""
    return str(uuid.uuid7())


def utcnow() -> datetime:
    return datetime.now(UTC)


class UTCDateTime(TypeDecorator[datetime]):
    """Always stores UTC and always returns timezone-aware datetimes (SQLite drops tzinfo)."""

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect: Dialect) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("naive datetime is not allowed; use timezone-aware UTC")
        return value.astimezone(UTC)

    def process_result_value(self, value: datetime | None, dialect: Dialect) -> datetime | None:
        if value is None:
            return None
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


class Base(DeclarativeBase):
    type_annotation_map = {datetime: UTCDateTime}  # noqa: RUF012


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)


class OwnedMixin:
    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("auth_users.id", ondelete="CASCADE"), index=True
    )


def _load_sqlite_vec(dbapi_connection: Any) -> None:
    """Makes `vec0` virtual tables available (M07 vector index). A platform without
    loadable-extension support just has no semantic search: M07 checks `vec_version()`."""
    try:
        import sqlite_vec  # pyright: ignore[reportMissingTypeStubs]

        async def load(conn: Any) -> None:
            await conn.enable_load_extension(True)
            try:
                await conn.load_extension(sqlite_vec.loadable_path())
            finally:
                await conn.enable_load_extension(False)

        dbapi_connection.run_async(load)
    except Exception:  # extension missing or loading disabled in this SQLite build
        structlog.get_logger().warning("sqlite_vec_unavailable")


def _set_sqlite_pragmas(dbapi_connection: Any, _record: Any) -> None:
    _load_sqlite_vec(dbapi_connection)
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.close()


def ensure_sqlite_dir(database_url: str) -> None:
    """SQLite will not create missing parent directories; do it before connecting."""
    url = make_url(database_url)
    if url.get_backend_name() == "sqlite" and url.database not in (None, "", ":memory:"):
        Path(url.database).parent.mkdir(parents=True, exist_ok=True)


def make_engine(settings: Settings | None = None) -> AsyncEngine:
    settings = settings or get_settings()
    ensure_sqlite_dir(settings.database_url)
    engine = create_async_engine(settings.database_url)
    if engine.dialect.name == "sqlite":
        event.listen(engine.sync_engine, "connect", _set_sqlite_pragmas)
    return engine


def make_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


async def get_db(session_factory: async_sessionmaker[AsyncSession]) -> AsyncIterator[AsyncSession]:
    async with session_factory() as session:
        yield session
