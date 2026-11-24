"""lms: the sync keeps Semestra's own problems apart

`lms_course_links.sync_problems` replaces `sync_errors`: only what went wrong on Semestra's side
of a course's sync (a stage that raised, items it skipped, reads a provider bug failed), with
the run's request id, by stage (M09 表 5c). What the platform answered is in `area_reads`. The
old codes are dropped: the next sync of each course works them out again. A single read's
reason keeps its params (`lms_item_checks.reason_params`), as the parts' reasons do in
`area_reads`, so the panel can tell an answer not understood from no answer.

Revision ID: 0073
Revises: 0072
Create Date: 2026-11-23 23:30:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0073"
down_revision: str | Sequence[str] | None = "0072"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("lms_course_links") as batch_op:
        batch_op.add_column(
            sa.Column("sync_problems", sa.JSON(), nullable=False, server_default=sa.text("'{}'"))
        )
        batch_op.drop_column("sync_errors")
    with op.batch_alter_table("lms_item_checks") as batch_op:
        batch_op.add_column(
            sa.Column("reason_params", sa.JSON(), nullable=False, server_default=sa.text("'{}'"))
        )


def downgrade() -> None:
    with op.batch_alter_table("lms_item_checks") as batch_op:
        batch_op.drop_column("reason_params")
    with op.batch_alter_table("lms_course_links") as batch_op:
        batch_op.add_column(
            sa.Column("sync_errors", sa.JSON(), nullable=False, server_default=sa.text("'{}'"))
        )
        batch_op.drop_column("sync_problems")
