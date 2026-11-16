"""lms: course links files_sync, files_offline; files: items kept_offline

Revision ID: 0053
Revises: 0052
Create Date: 2026-11-16 20:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0053"
down_revision: str | Sequence[str] | None = "0052"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("lms_course_links", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("files_sync", sa.Boolean(), server_default="1", nullable=False)
        )
        batch_op.add_column(
            sa.Column("files_offline", sa.Boolean(), server_default="0", nullable=False)
        )
    with op.batch_alter_table("files_items", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("kept_offline", sa.Boolean(), server_default="0", nullable=False)
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("files_items", schema=None) as batch_op:
        batch_op.drop_column("kept_offline")
    with op.batch_alter_table("lms_course_links", schema=None) as batch_op:
        batch_op.drop_column("files_offline")
        batch_op.drop_column("files_sync")
