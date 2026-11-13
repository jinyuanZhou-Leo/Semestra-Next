"""agent: a course file picked with `@` is kept once per conversation and version, and counted

`file_document_id` is the version of the course file a snapshot copies; its text now counts in
`size` (the storage quota). Snapshots made before are counted here too.

Revision ID: 0048
Revises: 0047
Create Date: 2026-11-13 23:30:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0048"
down_revision: str | Sequence[str] | None = "0047"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("agent_attachments", schema=None) as batch_op:
        batch_op.add_column(sa.Column("file_document_id", sa.String(), nullable=True))
    op.execute(
        """
        UPDATE agent_attachments SET size = (
            SELECT coalesce(sum(length(CAST(p.markdown AS BLOB))), 0)
            FROM agent_attachment_pages p WHERE p.attachment_id = agent_attachments.id
        )
        WHERE storage_key = ''
        """
    )


def downgrade() -> None:
    op.execute("UPDATE agent_attachments SET size = 0 WHERE storage_key = ''")
    with op.batch_alter_table("agent_attachments", schema=None) as batch_op:
        batch_op.drop_column("file_document_id")
