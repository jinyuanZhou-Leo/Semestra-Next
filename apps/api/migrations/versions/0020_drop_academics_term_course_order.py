"""drop per-term course order

Revision ID: 0020
Revises: 0019
Create Date: 2026-10-23 02:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0020"
down_revision: str | Sequence[str] | None = "0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Courses in a term are always listed in the default order; the stored order goes."""
    with op.batch_alter_table("academics_term_course_order", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_academics_term_course_order_user_id"))

    op.drop_table("academics_term_course_order")


def downgrade() -> None:
    """Recreate the table empty (the dropped order is not restored)."""
    op.create_table(
        "academics_term_course_order",
        sa.Column("term_id", sa.String(), nullable=False),
        sa.Column("course_id", sa.String(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["course_id"], ["academics_courses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["term_id"], ["academics_terms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["auth_users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("term_id", "course_id"),
    )
    with op.batch_alter_table("academics_term_course_order", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_academics_term_course_order_user_id"), ["user_id"], unique=False
        )
