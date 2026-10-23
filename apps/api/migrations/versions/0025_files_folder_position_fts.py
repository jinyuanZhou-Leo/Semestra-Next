"""files: drop folder position, contentless FTS index, count failed vector retries

Revision ID: 0025
Revises: 0024
Create Date: 2026-10-23 04:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0025"
down_revision: str | Sequence[str] | None = "0024"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Same text as indexing.heading_text: the heading path joined with " > ".
_HEADING = "(SELECT group_concat(value, ' > ') FROM json_each(c.heading_path))"


def _refill(create: str) -> None:
    op.execute("DROP TABLE IF EXISTS files_chunks_fts")
    op.execute(create)
    op.execute(
        "INSERT INTO files_chunks_fts(rowid, text, heading_path) "
        f"SELECT c.fts_rowid, c.text, coalesce({_HEADING}, '') FROM files_chunks c "
        "WHERE c.fts_rowid IS NOT NULL"
    )


def upgrade() -> None:
    # No screen ever set a folder's order; folders are listed by name.
    op.drop_column("files_folders", "position")
    op.add_column(
        "files_index_state",
        sa.Column("vector_failures", sa.Integer(), nullable=False, server_default="0"),
    )
    # The chunk text already lives in files_chunks.text: a contentless table (rows still
    # deletable by rowid, SQLite >= 3.43) keeps only the index.
    _refill(
        "CREATE VIRTUAL TABLE files_chunks_fts USING fts5(text, heading_path, "
        "content='', contentless_delete=1, tokenize='trigram')"
    )


def downgrade() -> None:
    op.drop_column("files_index_state", "vector_failures")
    _refill("CREATE VIRTUAL TABLE files_chunks_fts USING fts5(text, heading_path, tokenize='trigram')")
    op.add_column(
        "files_folders",
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
    )
