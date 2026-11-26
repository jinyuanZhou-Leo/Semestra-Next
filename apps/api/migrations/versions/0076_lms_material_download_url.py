"""lms: a synced file's download address

`lms_materials.download_url` keeps the download address a file's listing gave (M09 §4.6), so
the sync's downloads (the local copy, reading the file) no longer read each file on its own
first. Empty for every existing row: filled by the next sync; until then a download reads the
file first, as before.

Revision ID: 0076
Revises: 0075
Create Date: 2026-11-26 18:10:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0076"
down_revision: str | Sequence[str] | None = "0075"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("lms_materials") as batch_op:
        batch_op.add_column(sa.Column("download_url", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("lms_materials") as batch_op:
        batch_op.drop_column("download_url")
