from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from semestra.core.db import Base, OwnedMixin, UTCDateTime, new_id


class PortabilityArchive(Base, OwnedMixin):
    """A backup file the user exported or uploaded to restore from (M13 §4, §6).

    Exports are downloadable until `expires_at`; uploads wait there until they are imported or
    discarded. The file itself is in storage under `storage_key`; a periodic task removes both
    once they expire.
    """

    __tablename__ = "portability_archives"
    __table_args__ = (Index("ix_portability_archives_user_kind", "user_id", "kind", "created_at"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    kind: Mapped[str] = mapped_column(String)  # export | import
    # export: pending → ready | failed; import: uploaded → importing → imported | failed
    status: Mapped[str] = mapped_column(String)
    job_id: Mapped[str | None] = mapped_column(String, default=None)
    include_files: Mapped[bool] = mapped_column(Boolean, default=False)
    storage_key: Mapped[str | None] = mapped_column(String, default=None)
    size_bytes: Mapped[int | None] = mapped_column(Integer, default=None)
    # Upload: the preview shown before importing (counts, Programs, files, quota).
    preview: Mapped[dict[str, Any] | None] = mapped_column(JSON, default=None)
    # Import: what each module imported and skipped.
    report: Mapped[dict[str, Any] | None] = mapped_column(JSON, default=None)
    error_code: Mapped[str | None] = mapped_column(String, default=None)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
