"""lms cache scope (drop one course's reads together), drop unused imported_refs column

Revision ID: 0021
Revises: 0020
Create Date: 2026-10-23 02:30:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import semestra.core.db

# revision identifiers, used by Alembic.
revision: str = "0021"
down_revision: str | Sequence[str] | None = "0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Old entries have no scope and would survive a course refresh: they expire within
    # minutes anyway, so they are simply dropped.
    op.execute("DELETE FROM lms_cache")
    with op.batch_alter_table("lms_cache", schema=None) as batch_op:
        batch_op.add_column(sa.Column("scope", sa.String(), nullable=True))
        batch_op.create_index(
            "ix_lms_cache_connection_scope", ["connection_id", "scope"], unique=False
        )
    with op.batch_alter_table("lms_imported_refs", schema=None) as batch_op:
        batch_op.drop_column("external_updated_at")


def downgrade() -> None:
    with op.batch_alter_table("lms_imported_refs", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "external_updated_at",
                semestra.core.db.UTCDateTime(timezone=True),
                nullable=True,
            )
        )
    with op.batch_alter_table("lms_cache", schema=None) as batch_op:
        batch_op.drop_index("ix_lms_cache_connection_scope")
        batch_op.drop_column("scope")
