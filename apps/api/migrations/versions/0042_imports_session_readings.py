"""imports: what the model read of each file, while a session is extracting

`imports_sessions.readings` keeps each file's reading as soon as it is read, so an extraction job
that runs again (a crash, a locked database at the end) builds the items without paying for the
files again. Emptied when extraction ends.

Revision ID: 0042
Revises: 0041
Create Date: 2026-11-08 20:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0042"
down_revision: str | Sequence[str] | None = "0041"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("imports_sessions", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("readings", sa.JSON(), nullable=False, server_default=sa.text("'{}'"))
        )


def downgrade() -> None:
    with op.batch_alter_table("imports_sessions", schema=None) as batch_op:
        batch_op.drop_column("readings")
