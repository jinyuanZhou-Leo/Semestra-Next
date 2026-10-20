"""agent messages keep the Pydantic AI message (model_parts)

Revision ID: 0016
Revises: 0015
Create Date: 2026-10-20 03:00:00.000000

Conversations from before the assistant moved to Pydantic AI cannot be replayed to the model, so
they are removed (the app is not deployed yet; owner's decision in the Sem refactor plan), and so
are the stored files of their attachments (nothing else would ever delete them).
"""
from collections.abc import Sequence
from pathlib import Path

import sqlalchemy as sa
from alembic import op

from semestra.core.config import get_settings

# revision identifiers, used by Alembic.
revision: str = '0016'
down_revision: str | Sequence[str] | None = '0015'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    root = Path(get_settings().storage_local_root)
    keys = op.get_bind().execute(sa.text('SELECT storage_key FROM agent_attachments')).scalars()
    for key in keys:
        if key and '..' not in key:
            (root / key).unlink(missing_ok=True)
    op.execute('DELETE FROM agent_proposals')
    op.execute('DELETE FROM agent_attachments')
    op.execute('DELETE FROM agent_messages')
    op.execute('DELETE FROM agent_sessions')
    with op.batch_alter_table('agent_messages', schema=None) as batch_op:
        batch_op.add_column(sa.Column('model_parts', sa.JSON(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('agent_messages', schema=None) as batch_op:
        batch_op.drop_column('model_parts')
