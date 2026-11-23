"""core: when a worker last took each job

`core_jobs.claimed_at` is set on every attempt (`started_at` keeps the first), so a retried job
counts as its user's turn; the index reads each user's last turn (M00 §3.7, the order jobs are
taken in). Jobs taken before this count from their first start.

Revision ID: 0071
Revises: 0070
Create Date: 2026-11-23 05:30:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import semestra.core.db

# revision identifiers, used by Alembic.
revision: str = "0071"
down_revision: str | Sequence[str] | None = "0070"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("core_jobs", schema=None) as batch_op:
        batch_op.add_column(sa.Column("claimed_at", semestra.core.db.UTCDateTime(), nullable=True))
        batch_op.create_index("ix_core_jobs_user_claimed", ["user_id", "claimed_at"], unique=False)
    op.execute("UPDATE core_jobs SET claimed_at = started_at")


def downgrade() -> None:
    with op.batch_alter_table("core_jobs", schema=None) as batch_op:
        batch_op.drop_index("ix_core_jobs_user_claimed")
        batch_op.drop_column("claimed_at")
