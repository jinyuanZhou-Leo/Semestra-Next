"""agent: page images of attachments, rendered on upload

Revision ID: 0055
Revises: 0054
Create Date: 2026-11-17 18:10:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0055"
down_revision: str | Sequence[str] | None = "0054"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("agent_attachment_pages", schema=None) as batch_op:
        batch_op.add_column(sa.Column("image_key", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("image_type", sa.String(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("agent_attachment_pages", schema=None) as batch_op:
        batch_op.drop_column("image_type")
        batch_op.drop_column("image_key")
