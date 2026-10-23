"""agent proposals keep the chat's names and counts of the step they ran

Revision ID: 0022
Revises: 0021
Create Date: 2026-10-23 02:10:00.000000

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
    with op.batch_alter_table("agent_proposals") as batch:
        batch.add_column(sa.Column("display", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("agent_proposals") as batch:
        batch.drop_column("display")
