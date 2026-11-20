"""lms: kept assignments (description, submission; to-dos too)

Revision ID: 0066
Revises: 0065
Create Date: 2026-11-20 20:48:58.510637

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import semestra.core.db

# revision identifiers, used by Alembic.
revision: str = "0066"
down_revision: str | Sequence[str] | None = "0065"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("lms_feedback", schema=None) as batch_op:
        batch_op.add_column(sa.Column("task_id", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("details", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("work", sa.JSON(), nullable=True))
        batch_op.add_column(
            sa.Column("read_at", semestra.core.db.UTCDateTime(timezone=True), nullable=True)
        )
        batch_op.alter_column("assessment_id", existing_type=sa.VARCHAR(), nullable=True)
        batch_op.create_unique_constraint("uq_lms_feedback_task_id", ["task_id"])
        batch_op.create_foreign_key(
            "fk_lms_feedback_task_id", "tasks_items", ["task_id"], ["id"], ondelete="CASCADE"
        )


def downgrade() -> None:
    """Downgrade schema."""
    # Rows kept for to-dos have no assessment: they go.
    op.execute("DELETE FROM lms_feedback WHERE assessment_id IS NULL")
    with op.batch_alter_table("lms_feedback", schema=None) as batch_op:
        batch_op.drop_constraint("fk_lms_feedback_task_id", type_="foreignkey")
        batch_op.drop_constraint("uq_lms_feedback_task_id", type_="unique")
        batch_op.alter_column("assessment_id", existing_type=sa.VARCHAR(), nullable=False)
        batch_op.drop_column("read_at")
        batch_op.drop_column("work")
        batch_op.drop_column("details")
        batch_op.drop_column("task_id")
