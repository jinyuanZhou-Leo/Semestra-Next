"""ai: a provider's limit of requests at a time; a purpose's parameters on Auto

A model assignment without a provider and without a model is "Auto" with parameters.

Revision ID: 0030
Revises: 0029
Create Date: 2026-11-05 22:30:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0030"
down_revision: str | Sequence[str] | None = "0029"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("ai_providers") as batch:
        batch.add_column(sa.Column("max_concurrency", sa.Integer(), nullable=True))
    with op.batch_alter_table("ai_model_assignments") as batch:
        batch.alter_column("model", existing_type=sa.String(), nullable=True)


def downgrade() -> None:
    op.execute("DELETE FROM ai_model_assignments WHERE model IS NULL")
    with op.batch_alter_table("ai_model_assignments") as batch:
        batch.alter_column("model", existing_type=sa.String(), nullable=False)
    with op.batch_alter_table("ai_providers") as batch:
        batch.drop_column("max_concurrency")
