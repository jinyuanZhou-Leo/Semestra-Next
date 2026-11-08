"""auth: when each session last proved who is using it

`auth_sessions.verified_at` is set at sign-in and renewed by the `account.reauth.*` checks;
sensitive account actions need it to be under 10 minutes old (M01 §4.5). Existing sessions start
from their sign-in time.

Revision ID: 0044
Revises: 0043
Create Date: 2026-11-08 22:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import semestra.core.db

# revision identifiers, used by Alembic.
revision: str = "0044"
down_revision: str | Sequence[str] | None = "0043"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("auth_sessions", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("verified_at", semestra.core.db.UTCDateTime(timezone=True), nullable=True)
        )
    op.execute("UPDATE auth_sessions SET verified_at = created_at")
    with op.batch_alter_table("auth_sessions", schema=None) as batch_op:
        batch_op.alter_column(
            "verified_at",
            existing_type=semestra.core.db.UTCDateTime(timezone=True),
            nullable=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("auth_sessions", schema=None) as batch_op:
        batch_op.drop_column("verified_at")
