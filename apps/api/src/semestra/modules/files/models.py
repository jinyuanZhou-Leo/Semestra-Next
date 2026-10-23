from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from semestra.core.db import Base, OwnedMixin, TimestampMixin, UTCDateTime, new_id

# The FTS5 table `files_chunks_fts` and the per-embedding-model `files_vec_<fingerprint>` vec0
# tables are virtual tables: they are created by SQL (migration / `vectors.py`), not by these
# models, and `migrations/env.py` leaves them out of autogenerate.


class FilesFolder(Base, OwnedMixin, TimestampMixin):
    __tablename__ = "files_folders"
    # SQLite treats NULLs as distinct, so root-level names get their own partial index. The
    # service also compares names case-insensitively before writing.
    __table_args__ = (
        UniqueConstraint("course_id", "parent_id", "name"),
        Index(
            "uq_files_folders_root_name",
            "course_id",
            "name",
            unique=True,
            sqlite_where=text("parent_id IS NULL"),
        ),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    course_id: Mapped[str] = mapped_column(
        String, ForeignKey("academics_courses.id", ondelete="CASCADE"), index=True
    )
    parent_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("files_folders.id", ondelete="CASCADE"), default=None
    )
    name: Mapped[str] = mapped_column(String)


class FilesItem(Base, OwnedMixin, TimestampMixin):
    """An uploaded file or a saved link of one course."""

    __tablename__ = "files_items"
    __table_args__ = (Index("ix_files_items_course_folder", "course_id", "folder_id"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    course_id: Mapped[str] = mapped_column(
        String, ForeignKey("academics_courses.id", ondelete="CASCADE")
    )
    folder_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("files_folders.id", ondelete="CASCADE"), default=None
    )
    kind: Mapped[str] = mapped_column(String)  # 'file' | 'link'
    display_name: Mapped[str] = mapped_column(String)
    original_name: Mapped[str | None] = mapped_column(String, default=None)
    mime_type: Mapped[str | None] = mapped_column(String, default=None)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    sha256: Mapped[str | None] = mapped_column(String, default=None)
    storage_key: Mapped[str | None] = mapped_column(String, default=None)
    url: Mapped[str | None] = mapped_column(String, default=None)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    source_kind: Mapped[str | None] = mapped_column(String, default=None)  # upload|lms|agent
    source_ref: Mapped[str | None] = mapped_column(String, default=None)
    # none | pending | processing | ready | failed | unsupported
    doc_status: Mapped[str] = mapped_column(String, default="none")
    doc_error_code: Mapped[str | None] = mapped_column(String, default=None)
    # No foreign key: the document points back at the item, and the switch to a new document
    # must not be blocked by (or cascade into) the old one.
    active_document_id: Mapped[str | None] = mapped_column(String, default=None)


class FilesDocument(Base, OwnedMixin):
    """The product of one parse. Reprocessing builds a new one and then switches to it."""

    __tablename__ = "files_documents"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    item_id: Mapped[str] = mapped_column(
        String, ForeignKey("files_items.id", ondelete="CASCADE"), index=True
    )
    parser_fingerprint: Mapped[str] = mapped_column(String)
    page_count: Mapped[int] = mapped_column(Integer, default=0)
    char_count: Mapped[int] = mapped_column(Integer, default=0)
    language: Mapped[str | None] = mapped_column(String, default=None)
    status: Mapped[str] = mapped_column(String, default="building")  # building | ready | failed
    # Pages that needed OCR but had no vision model (the UI suggests configuring AI).
    ocr_skipped_pages: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime)


class FilesDocumentPage(Base, OwnedMixin):
    __tablename__ = "files_document_pages"
    __table_args__ = (UniqueConstraint("document_id", "page_no"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    document_id: Mapped[str] = mapped_column(
        String, ForeignKey("files_documents.id", ondelete="CASCADE"), index=True
    )
    page_no: Mapped[int] = mapped_column(Integer)  # 1-based
    markdown: Mapped[str] = mapped_column(String, default="")
    ocr_used: Mapped[bool] = mapped_column(Boolean, default=False)
    image_storage_key: Mapped[str | None] = mapped_column(String, default=None)


class FilesChunk(Base, OwnedMixin):
    __tablename__ = "files_chunks"
    __table_args__ = (Index("ix_files_chunks_user_course", "user_id", "course_id"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    document_id: Mapped[str] = mapped_column(
        String, ForeignKey("files_documents.id", ondelete="CASCADE"), index=True
    )
    item_id: Mapped[str] = mapped_column(
        String, ForeignKey("files_items.id", ondelete="CASCADE"), index=True
    )
    course_id: Mapped[str] = mapped_column(String)
    chunk_no: Mapped[int] = mapped_column(Integer)
    page_from: Mapped[int] = mapped_column(Integer)
    page_to: Mapped[int] = mapped_column(Integer)
    heading_path: Mapped[list[Any]] = mapped_column(JSON, default=list)
    text: Mapped[str] = mapped_column(String)
    token_count: Mapped[int] = mapped_column(Integer)
    content_hash: Mapped[str] = mapped_column(String)
    # Rowid of this chunk's row in `files_chunks_fts` (which keeps its own rowids).
    fts_rowid: Mapped[int | None] = mapped_column(Integer, default=None, index=True)


class FilesIndexState(Base, OwnedMixin):
    """Which document is indexed for an item, in full text and in which vector space."""

    __tablename__ = "files_index_state"

    item_id: Mapped[str] = mapped_column(
        String, ForeignKey("files_items.id", ondelete="CASCADE"), primary_key=True
    )
    fts_document_id: Mapped[str | None] = mapped_column(String, default=None)
    vector_document_id: Mapped[str | None] = mapped_column(String, default=None)
    vector_fingerprint: Mapped[str | None] = mapped_column(String, default=None)
    # Vector retries that failed in a row for this document; past the limit the periodic retry
    # leaves it alone until the file is reprocessed or the embedding model changes.
    vector_failures: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime)
