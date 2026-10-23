"""Writing and removing the searchable copies of a document: chunks, the FTS5 table and vectors.

`files_chunks_fts` is a contentless FTS5 table (the text lives only in `files_chunks.text`) with
its own rowids; `files_chunks.fts_rowid` points at the row, so removing a document's text from
the index is an indexed lookup instead of a scan.
"""

from collections.abc import Sequence

from sqlalchemy import bindparam, delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from semestra.core.db import new_id
from semestra.modules.files.chunking import Chunk
from semestra.modules.files.models import (
    FilesChunk,
    FilesDocument,
    FilesDocumentPage,
)
from semestra.modules.files.vectors import VectorStore

BATCH = 500


def heading_text(path: Sequence[str]) -> str:
    return " > ".join(path)


async def insert_chunks(
    db: AsyncSession,
    *,
    user_id: str,
    document_id: str,
    item_id: str,
    course_id: str,
    chunks: Sequence[Chunk],
) -> list[FilesChunk]:
    """Stores the chunks and indexes their text in FTS5."""
    rows: list[FilesChunk] = []
    for chunk in chunks:
        result = await db.execute(
            text("INSERT INTO files_chunks_fts(text, heading_path) VALUES (:text, :heading)"),
            {"text": chunk.text, "heading": heading_text(chunk.heading_path)},
        )
        row = FilesChunk(
            id=new_id(),
            user_id=user_id,
            document_id=document_id,
            item_id=item_id,
            course_id=course_id,
            chunk_no=chunk.chunk_no,
            page_from=chunk.page_from,
            page_to=chunk.page_to,
            heading_path=chunk.heading_path,
            text=chunk.text,
            token_count=chunk.token_count,
            content_hash=chunk.content_hash,
            fts_rowid=result.lastrowid,  # pyright: ignore[reportAttributeAccessIssue]
        )
        db.add(row)
        rows.append(row)
    await db.flush()
    return rows


async def delete_documents(
    db: AsyncSession, store: VectorStore, document_ids: Sequence[str]
) -> list[str]:
    """Removes documents with their pages, chunks and index entries.

    Returns the storage keys of their page images; the caller deletes those objects once the
    transaction has committed.
    """
    if not document_ids:
        return []
    ids = list(document_ids)
    chunk_rows = (
        await db.execute(
            select(FilesChunk.id, FilesChunk.fts_rowid).where(FilesChunk.document_id.in_(ids))
        )
    ).all()
    for start in range(0, len(chunk_rows), BATCH):
        part = chunk_rows[start : start + BATCH]
        rowids = [r[1] for r in part if r[1] is not None]
        if rowids:
            await db.execute(
                text("DELETE FROM files_chunks_fts WHERE rowid IN :rowids").bindparams(
                    bindparam("rowids", expanding=True)
                ),
                {"rowids": rowids},
            )
        await store.delete(db, [r[0] for r in part])
    keys = list(
        (
            await db.scalars(
                select(FilesDocumentPage.image_storage_key).where(
                    FilesDocumentPage.document_id.in_(ids),
                    FilesDocumentPage.image_storage_key.is_not(None),
                )
            )
        ).all()
    )
    await db.execute(delete(FilesChunk).where(FilesChunk.document_id.in_(ids)))
    await db.execute(delete(FilesDocumentPage).where(FilesDocumentPage.document_id.in_(ids)))
    await db.execute(delete(FilesDocument).where(FilesDocument.id.in_(ids)))
    return [k for k in keys if k]
