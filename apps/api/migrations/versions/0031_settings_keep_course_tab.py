"""settings: switching courses keeps the open tab

Revision ID: 0031
Revises: 0030
Create Date: 2026-11-06 23:40:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0031"
down_revision: str | Sequence[str] | None = "0030"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("settings_preferences", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("keep_course_tab", sa.Boolean(), server_default=sa.true(), nullable=False)
        )


def downgrade() -> None:
    with op.batch_alter_table("settings_preferences", schema=None) as batch_op:
        batch_op.drop_column("keep_course_tab")
