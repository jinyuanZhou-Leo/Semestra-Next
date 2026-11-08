"""agent: when an attachment was first sent

`agent_attachments.sent_at` is set when a message first carries the attachment, so the hourly
cleanup of unsent uploads reads only those, instead of scanning every message for references.
Attachments already in messages take their message's time.

Revision ID: 0041
Revises: 0040
Create Date: 2026-11-08 18:10:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import semestra.core.db

# revision identifiers, used by Alembic.
revision: str = "0041"
down_revision: str | Sequence[str] | None = "0040"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("agent_attachments", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("sent_at", semestra.core.db.UTCDateTime(timezone=True), nullable=True)
        )
    op.execute(
        """
        UPDATE agent_attachments SET sent_at = (
            SELECT min(m.created_at) FROM agent_messages m, json_each(m.content) b
            WHERE m.session_id = agent_attachments.session_id
              AND json_extract(b.value, '$.attachment_id') = agent_attachments.id
        )
        """
    )


def downgrade() -> None:
    with op.batch_alter_table("agent_attachments", schema=None) as batch_op:
        batch_op.drop_column("sent_at")
