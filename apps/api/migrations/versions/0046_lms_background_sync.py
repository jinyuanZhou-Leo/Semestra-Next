"""lms: background sync

Courses are synced in the background (M09 §4.8): `lms_course_links.synced_at` and
`sync_errors` replace `last_synced_at` and `last_error_code`; `lms_imported_refs` also keeps new
items not imported yet (null target), ignored ones (`dismissed_at`), fields the user changed too
(`conflicts`) and items gone from the platform (`removed_at`), and drops `reported` (update
notifications follow what the sync applied); `lms_sync_changes` lists what the sync changed.

Revision ID: 0046
Revises: 0045
Create Date: 2026-11-12 16:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import semestra.core.db

# revision identifiers, used by Alembic.
revision: str = "0046"
down_revision: str | Sequence[str] | None = "0045"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("lms_course_links", schema=None) as batch_op:
        batch_op.alter_column("last_synced_at", new_column_name="synced_at")
        batch_op.drop_column("last_error_code")
        batch_op.add_column(
            sa.Column("sync_errors", sa.JSON(), nullable=False, server_default=sa.text("'{}'"))
        )
    with op.batch_alter_table("lms_imported_refs", schema=None) as batch_op:
        batch_op.alter_column("target_kind", existing_type=sa.String(), nullable=True)
        batch_op.alter_column("target_id", existing_type=sa.String(), nullable=True)
        batch_op.alter_column(
            "imported_at",
            existing_type=semestra.core.db.UTCDateTime(timezone=True),
            nullable=True,
        )
        batch_op.drop_column("reported")
        batch_op.add_column(
            sa.Column("conflicts", sa.JSON(), nullable=False, server_default=sa.text("'{}'"))
        )
        batch_op.add_column(
            sa.Column("removed_at", semestra.core.db.UTCDateTime(timezone=True), nullable=True)
        )
        batch_op.add_column(
            sa.Column("dismissed_at", semestra.core.db.UTCDateTime(timezone=True), nullable=True)
        )
    op.create_table(
        "lms_sync_changes",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("ref_id", sa.String(), nullable=False),
        sa.Column("field", sa.String(), nullable=False),
        sa.Column("old", sa.JSON(), nullable=True),
        sa.Column("new", sa.JSON(), nullable=True),
        sa.Column("at", semestra.core.db.UTCDateTime(timezone=True), nullable=False),
        sa.Column("reverted_at", semestra.core.db.UTCDateTime(timezone=True), nullable=True),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["ref_id"], ["lms_imported_refs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["auth_users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("lms_sync_changes", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_lms_sync_changes_ref_id"), ["ref_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_lms_sync_changes_user_id"), ["user_id"], unique=False)
        batch_op.create_index("ix_lms_sync_changes_user_at", ["user_id", "at"], unique=False)


def downgrade() -> None:
    op.drop_table("lms_sync_changes")
    op.execute("DELETE FROM lms_imported_refs WHERE target_id IS NULL")
    with op.batch_alter_table("lms_imported_refs", schema=None) as batch_op:
        batch_op.drop_column("dismissed_at")
        batch_op.drop_column("removed_at")
        batch_op.drop_column("conflicts")
        batch_op.add_column(
            sa.Column("reported", sa.JSON(), nullable=False, server_default=sa.text("'{}'"))
        )
        batch_op.alter_column(
            "imported_at",
            existing_type=semestra.core.db.UTCDateTime(timezone=True),
            nullable=False,
        )
        batch_op.alter_column("target_id", existing_type=sa.String(), nullable=False)
        batch_op.alter_column("target_kind", existing_type=sa.String(), nullable=False)
    with op.batch_alter_table("lms_course_links", schema=None) as batch_op:
        batch_op.drop_column("sync_errors")
        batch_op.add_column(sa.Column("last_error_code", sa.String(), nullable=True))
        batch_op.alter_column("synced_at", new_column_name="last_synced_at")
