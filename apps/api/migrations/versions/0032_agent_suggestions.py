"""agent: the small model's wording of suggested questions

Revision ID: 0032
Revises: 0031
Create Date: 2026-11-07 16:41:23.248517

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import semestra.core.db

# revision identifiers, used by Alembic.
revision: str = "0032"
down_revision: str | Sequence[str] | None = "0031"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "agent_suggestions",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("program_id", sa.String(), nullable=False),
        sa.Column("locale", sa.String(), nullable=False),
        sa.Column("items", sa.JSON(), nullable=False),
        sa.Column("generated_at", semestra.core.db.UTCDateTime(timezone=True), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["program_id"], ["academics_programs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["auth_users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("agent_suggestions", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_agent_suggestions_user_id"), ["user_id"], unique=False)
        batch_op.create_index(
            "ux_agent_suggestions_user_program", ["user_id", "program_id"], unique=True
        )


def downgrade() -> None:
    with op.batch_alter_table("agent_suggestions", schema=None) as batch_op:
        batch_op.drop_index("ux_agent_suggestions_user_program")
        batch_op.drop_index(batch_op.f("ix_agent_suggestions_user_id"))
    op.drop_table("agent_suggestions")
