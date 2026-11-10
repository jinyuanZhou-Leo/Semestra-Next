"""agent: when Auto Dream last tidied the user's memories

`agent_preferences.memory_dreamed_at` gates Auto Dream to at most one run a day (M12 记忆).

Revision ID: 0045
Revises: 0044
Create Date: 2026-11-10 14:30:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import semestra.core.db

# revision identifiers, used by Alembic.
revision: str = "0045"
down_revision: str | Sequence[str] | None = "0044"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("agent_preferences", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "memory_dreamed_at", semestra.core.db.UTCDateTime(timezone=True), nullable=True
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("agent_preferences", schema=None) as batch_op:
        batch_op.drop_column("memory_dreamed_at")
