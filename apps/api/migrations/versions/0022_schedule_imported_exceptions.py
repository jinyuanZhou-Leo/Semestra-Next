"""mark imported meeting exceptions

Revision ID: 0022
Revises: 0021
Create Date: 2026-10-23 03:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0022"
down_revision: str | Sequence[str] | None = "0021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Exceptions an import wrote, so a repeated import can take back the ones it no longer has.
    Existing rows count as the user's own (kept)."""
    with op.batch_alter_table("schedule_meeting_exceptions", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("imported", sa.Boolean(), server_default=sa.false(), nullable=False)
        )


def downgrade() -> None:
    with op.batch_alter_table("schedule_meeting_exceptions", schema=None) as batch_op:
        batch_op.drop_column("imported")
