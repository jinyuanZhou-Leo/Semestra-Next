"""settings: the page the app opens on

Revision ID: 0027
Revises: 0026
Create Date: 2026-10-31 16:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0027"
down_revision: str | Sequence[str] | None = "0026"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("settings_preferences", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("start_page", sa.String(), server_default="today", nullable=False)
        )


def downgrade() -> None:
    with op.batch_alter_table("settings_preferences", schema=None) as batch_op:
        batch_op.drop_column("start_page")
