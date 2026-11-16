"""files: items week, week_source

Revision ID: 0054
Revises: 0053
Create Date: 2026-11-16 23:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0054"
down_revision: str | Sequence[str] | None = "0053"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("files_items", schema=None) as batch_op:
        batch_op.add_column(sa.Column("week", sa.Date(), nullable=True))
        batch_op.add_column(
            sa.Column("week_source", sa.String(), server_default="rule", nullable=False)
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("files_items", schema=None) as batch_op:
        batch_op.drop_column("week_source")
        batch_op.drop_column("week")
