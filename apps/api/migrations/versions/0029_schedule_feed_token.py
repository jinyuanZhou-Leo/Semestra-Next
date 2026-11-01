"""schedule: one subscription link per Program, shown again whenever needed

Like Google Calendar's secret address: calendar apps read the link, so it is not a secret shown
once. The token is now also stored encrypted, and links lose their name. Links made before this
keep only the hash and show no URL until they are reset; where a Program had several, the newest
stays on and the others are turned off.

Revision ID: 0029
Revises: 0028
Create Date: 2026-11-01 15:30:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0029"
down_revision: str | Sequence[str] | None = "0028"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE schedule_feeds SET revoked_at = created_at
        WHERE revoked_at IS NULL AND EXISTS (
            SELECT 1 FROM schedule_feeds AS newer
            WHERE newer.user_id = schedule_feeds.user_id
              AND newer.program_id = schedule_feeds.program_id
              AND newer.revoked_at IS NULL
              AND newer.created_at > schedule_feeds.created_at
        )
        """
    )
    with op.batch_alter_table("schedule_feeds") as batch:
        batch.add_column(sa.Column("token_encrypted", sa.String(), nullable=True))
        batch.drop_column("name")


def downgrade() -> None:
    with op.batch_alter_table("schedule_feeds") as batch:
        batch.add_column(sa.Column("name", sa.String(), nullable=False, server_default=""))
        batch.drop_column("token_encrypted")
