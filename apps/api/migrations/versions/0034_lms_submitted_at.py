"""lms: when the platform first showed an imported assignment handed in

`lms_imported_refs.submitted_at` makes "finish the to-do when the platform shows it submitted"
happen once per assignment. Existing refs start empty, so the first read after the upgrade
finishes the to-dos of assignments already handed in.

Revision ID: 0034
Revises: 0033
Create Date: 2026-11-07 22:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import semestra.core.db

# revision identifiers, used by Alembic.
revision: str = "0034"
down_revision: str | Sequence[str] | None = "0033"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("lms_imported_refs", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("submitted_at", semestra.core.db.UTCDateTime(timezone=True), nullable=True)
        )


def downgrade() -> None:
    with op.batch_alter_table("lms_imported_refs", schema=None) as batch_op:
        batch_op.drop_column("submitted_at")
