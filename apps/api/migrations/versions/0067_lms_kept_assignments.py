"""lms: kept assignments (description, submission; to-dos too)

`lms_feedback` held the teacher's feedback of imported assessments. It now holds the whole
imported assignment, of to-dos too, so it is `lms_kept_assignments`.

Revision ID: 0067
Revises: 0066
Create Date: 2026-11-20 20:48:58.510637

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import semestra.core.db

# revision identifiers, used by Alembic.
revision: str = "0067"
down_revision: str | Sequence[str] | None = "0066"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("lms_feedback", schema=None) as batch_op:
        batch_op.drop_index("ix_lms_feedback_course_id")
        batch_op.drop_index("ix_lms_feedback_user_id")
    op.rename_table("lms_feedback", "lms_kept_assignments")
    with op.batch_alter_table("lms_kept_assignments", schema=None) as batch_op:
        batch_op.add_column(sa.Column("task_id", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("details", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("work", sa.JSON(), nullable=True))
        batch_op.add_column(
            sa.Column("read_at", semestra.core.db.UTCDateTime(timezone=True), nullable=True)
        )
        batch_op.alter_column("assessment_id", existing_type=sa.VARCHAR(), nullable=True)
        batch_op.create_unique_constraint("uq_lms_kept_assignments_task_id", ["task_id"])
        batch_op.create_foreign_key(
            "fk_lms_kept_assignments_task_id",
            "tasks_items",
            ["task_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch_op.create_check_constraint(
            "ck_lms_kept_assignments_owner", "(assessment_id IS NULL) <> (task_id IS NULL)"
        )
        batch_op.create_index("ix_lms_kept_assignments_course_id", ["course_id"], unique=False)
        batch_op.create_index("ix_lms_kept_assignments_user_id", ["user_id"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    # Rows kept for to-dos have no assessment: they go.
    op.execute("DELETE FROM lms_kept_assignments WHERE assessment_id IS NULL")
    with op.batch_alter_table("lms_kept_assignments", schema=None) as batch_op:
        batch_op.drop_index("ix_lms_kept_assignments_user_id")
        batch_op.drop_index("ix_lms_kept_assignments_course_id")
        batch_op.drop_constraint("ck_lms_kept_assignments_owner", type_="check")
        batch_op.drop_constraint("fk_lms_kept_assignments_task_id", type_="foreignkey")
        batch_op.drop_constraint("uq_lms_kept_assignments_task_id", type_="unique")
        batch_op.alter_column("assessment_id", existing_type=sa.VARCHAR(), nullable=False)
        batch_op.drop_column("read_at")
        batch_op.drop_column("work")
        batch_op.drop_column("details")
        batch_op.drop_column("task_id")
    op.rename_table("lms_kept_assignments", "lms_feedback")
    with op.batch_alter_table("lms_feedback", schema=None) as batch_op:
        batch_op.create_index("ix_lms_feedback_course_id", ["course_id"], unique=False)
        batch_op.create_index("ix_lms_feedback_user_id", ["user_id"], unique=False)
