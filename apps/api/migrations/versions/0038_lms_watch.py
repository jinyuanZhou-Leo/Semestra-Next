"""lms: what the background check already reported, for update notifications (M18)

`lms_course_links.watched_at` is when the background check last looked at the course (null until
its first look, which reports nothing); `lms_imported_refs.reported` holds the platform values of
the changes already reported, so each change is told once.

Revision ID: 0038
Revises: 0037
Create Date: 2026-11-08 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import semestra.core.db

# revision identifiers, used by Alembic.
revision: str = "0038"
down_revision: str | Sequence[str] | None = "0037"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("lms_course_links", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("watched_at", semestra.core.db.UTCDateTime(timezone=True), nullable=True)
        )
    with op.batch_alter_table("lms_imported_refs", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("reported", sa.JSON(), nullable=False, server_default=sa.text("'{}'"))
        )


def downgrade() -> None:
    with op.batch_alter_table("lms_imported_refs", schema=None) as batch_op:
        batch_op.drop_column("reported")
    with op.batch_alter_table("lms_course_links", schema=None) as batch_op:
        batch_op.drop_column("watched_at")
