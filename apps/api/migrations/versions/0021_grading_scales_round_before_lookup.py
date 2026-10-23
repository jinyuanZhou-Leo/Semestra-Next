"""grading scales: round the percentage to a whole number before the band lookup

Revision ID: 0021
Revises: 0020
Create Date: 2026-10-23 02:10:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0021"
down_revision: str | Sequence[str] | None = "0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # On for every Program, existing ones too: 84.96 % is shown as 85 %, so it reads as 85.
    with op.batch_alter_table("grading_scales") as batch:
        batch.add_column(
            sa.Column("round_before_lookup", sa.Boolean(), nullable=False, server_default=sa.true())
        )


def downgrade() -> None:
    with op.batch_alter_table("grading_scales") as batch:
        batch.drop_column("round_before_lookup")
