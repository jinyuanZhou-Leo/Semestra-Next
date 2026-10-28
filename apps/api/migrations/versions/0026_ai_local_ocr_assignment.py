"""ai: an OCR assignment may name a local model, with no provider

Revision ID: 0026
Revises: 0025
Create Date: 2026-10-28 15:40:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0026"
down_revision: str | Sequence[str] | None = "0025"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("ai_model_assignments", schema=None) as batch_op:
        batch_op.alter_column("provider_id", existing_type=sa.String(), nullable=True)


def downgrade() -> None:
    op.execute("DELETE FROM ai_model_assignments WHERE provider_id IS NULL")
    with op.batch_alter_table("ai_model_assignments", schema=None) as batch_op:
        batch_op.alter_column("provider_id", existing_type=sa.String(), nullable=False)
