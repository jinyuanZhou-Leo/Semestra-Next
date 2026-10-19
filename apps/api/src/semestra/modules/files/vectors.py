"""Vector index (M07 §2): one sqlite-vec `vec0` table per embedding space, partitioned by user.

Everything else talks to the `VectorStore` interface, so the store can be replaced (e.g. by
Qdrant) without touching the pipeline or search. A "space" is identified by a fingerprint of
(provider kind, model, dimension): vectors of different models are never mixed.
"""

import hashlib
import re
import struct
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from sqlalchemy import bindparam, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

TABLE_PREFIX = "files_vec_"
_FINGERPRINT = re.compile(r"[0-9a-f]{12}")
MAX_K = 4096


def fingerprint(provider_kind: str, model: str, dim: int) -> str:
    """Names the vector space; also the table suffix."""
    return hashlib.sha256(f"{provider_kind}|{model}|{dim}".encode()).hexdigest()[:12]


@dataclass(frozen=True)
class VectorRow:
    chunk_id: str
    user_id: str
    course_id: str
    embedding: Sequence[float]


class VectorStore(Protocol):
    async def available(self, db: AsyncSession) -> bool: ...

    async def upsert(
        self, db: AsyncSession, space: str, dim: int, rows: Sequence[VectorRow]
    ) -> None: ...

    async def delete(
        self, db: AsyncSession, chunk_ids: Sequence[str], space: str | None = None
    ) -> None:
        """Removes the vectors of these chunks from `space`, or from every space."""
        ...

    async def count(self, db: AsyncSession, space: str) -> int: ...

    async def knn(
        self,
        db: AsyncSession,
        space: str,
        *,
        user_id: str,
        vector: Sequence[float],
        k: int,
        course_ids: Sequence[str] | None = None,
    ) -> list[tuple[str, float]]:
        """`(chunk_id, cosine distance)`, nearest first, among this user's vectors."""
        ...

    async def spaces(self, db: AsyncSession) -> list[str]: ...

    async def drop(self, db: AsyncSession, space: str) -> None: ...


def _pack(vector: Sequence[float]) -> bytes:
    return struct.pack(f"{len(vector)}f", *vector)


def _table(space: str) -> str:
    if not _FINGERPRINT.fullmatch(space):
        raise ValueError(f"invalid vector space {space!r}")
    return TABLE_PREFIX + space


class SqliteVecStore:
    async def available(self, db: AsyncSession) -> bool:
        try:
            await db.execute(text("SELECT vec_version()"))
        except OperationalError:
            return False
        return True

    async def spaces(self, db: AsyncSession) -> list[str]:
        rows = await db.scalars(
            text("SELECT name FROM sqlite_master WHERE type = 'table' AND name GLOB :pattern"),
            {"pattern": TABLE_PREFIX + "[0-9a-f]" * 12},
        )
        return [name.removeprefix(TABLE_PREFIX) for name in rows.all()]

    async def upsert(
        self, db: AsyncSession, space: str, dim: int, rows: Sequence[VectorRow]
    ) -> None:
        table = _table(space)
        await db.execute(
            text(
                f"CREATE VIRTUAL TABLE IF NOT EXISTS {table} USING vec0("
                "chunk_id TEXT PRIMARY KEY, user_id TEXT PARTITION KEY, course_id TEXT, "
                f"embedding float[{int(dim)}] distance_metric=cosine)"
            )
        )
        ids = [r.chunk_id for r in rows]
        if ids:
            await db.execute(
                text(f"DELETE FROM {table} WHERE chunk_id IN :ids").bindparams(  # noqa: S608
                    bindparam("ids", expanding=True)
                ),
                {"ids": ids},
            )
        for row in rows:
            await db.execute(
                text(
                    f"INSERT INTO {table}(chunk_id, user_id, course_id, embedding) "  # noqa: S608
                    "VALUES (:chunk_id, :user_id, :course_id, :embedding)"
                ),
                {
                    "chunk_id": row.chunk_id,
                    "user_id": row.user_id,
                    "course_id": row.course_id,
                    "embedding": _pack(row.embedding),
                },
            )

    async def count(self, db: AsyncSession, space: str) -> int:
        if space not in await self.spaces(db):
            return 0
        return int(await db.scalar(text(f"SELECT count(*) FROM {_table(space)}")) or 0)  # noqa: S608

    async def delete(
        self, db: AsyncSession, chunk_ids: Sequence[str], space: str | None = None
    ) -> None:
        if not chunk_ids or not await self.available(db):
            return
        for target in [space] if space else await self.spaces(db):
            for start in range(0, len(chunk_ids), 500):
                await db.execute(
                    text(
                        f"DELETE FROM {_table(target)} WHERE chunk_id IN :ids"  # noqa: S608
                    ).bindparams(bindparam("ids", expanding=True)),
                    {"ids": list(chunk_ids[start : start + 500])},
                )

    async def knn(
        self,
        db: AsyncSession,
        space: str,
        *,
        user_id: str,
        vector: Sequence[float],
        k: int,
        course_ids: Sequence[str] | None = None,
    ) -> list[tuple[str, float]]:
        if space not in await self.spaces(db):
            return []
        sql = (
            f"SELECT chunk_id, distance FROM {_table(space)} "  # noqa: S608
            "WHERE embedding MATCH :vector AND k = :k AND user_id = :user_id"
        )
        params: dict[str, object] = {
            "vector": _pack(vector),
            "k": min(k, MAX_K),
            "user_id": user_id,
        }
        stmt = None
        if course_ids is not None:
            if not course_ids:
                return []
            sql += " AND course_id IN :course_ids"
            stmt = text(sql).bindparams(bindparam("course_ids", expanding=True))
            params["course_ids"] = list(course_ids)
        result = await db.execute(stmt if stmt is not None else text(sql), params)
        return [(row[0], float(row[1])) for row in result.all()]

    async def drop(self, db: AsyncSession, space: str) -> None:
        await db.execute(text(f"DROP TABLE IF EXISTS {_table(space)}"))


def get_vector_store() -> VectorStore:
    return SqliteVecStore()
