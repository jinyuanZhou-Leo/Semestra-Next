"""files: a followed file's source side and its local copy's side, each with one meaning

- `files_items.source_version` (new): the source's current version (the hash of its version
  string), which `sha256` used to hold for followed files. `sha256` is now only ever the hash of
  stored bytes: NULL for a followed file stored nowhere, and NULL for an existing copy until
  it is stored again or handed to the user (whose files always have it).
- `source_mime` and `source_size` now always hold the source's current type and size, not
  only while the copy is older.
- `copy_modified_at` (new): when the source changed the version the copy holds, so a copy
  older than the source shows its own time; `copy_error_code` (new): why the last attempt to
  store a wanted copy failed.

Revision ID: 0062
Revises: 0061
Create Date: 2026-11-19 17:30:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0062"
down_revision: str | Sequence[str] | None = "0061"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

FOLLOWED = "kind = 'file' AND source_ref LIKE 'lms:%'"


def upgrade() -> None:
    with op.batch_alter_table("files_items", schema=None) as batch_op:
        batch_op.add_column(sa.Column("source_version", sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column("copy_modified_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("copy_error_code", sa.String(), nullable=True))
    op.execute(
        "UPDATE files_items SET source_version = sha256,"
        " source_mime = COALESCE(source_mime, mime_type),"
        " source_size = COALESCE(source_size, size_bytes),"
        " copy_modified_at = CASE WHEN storage_key IS NOT NULL AND copy_version = sha256"
        "   THEN source_modified_at END,"
        f" sha256 = NULL WHERE {FOLLOWED}"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE files_items SET sha256 = source_version,"
        " source_mime = CASE WHEN storage_key IS NOT NULL AND copy_version IS NOT source_version"
        "   THEN source_mime END,"
        " source_size = CASE WHEN storage_key IS NOT NULL AND copy_version IS NOT source_version"
        "   THEN source_size END"
        f" WHERE {FOLLOWED}"
    )
    with op.batch_alter_table("files_items", schema=None) as batch_op:
        batch_op.drop_column("copy_error_code")
        batch_op.drop_column("copy_modified_at")
        batch_op.drop_column("source_version")
