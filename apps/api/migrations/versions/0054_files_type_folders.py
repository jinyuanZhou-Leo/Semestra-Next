"""files: type folders (moved from lms_imported_refs)

Revision ID: 0054
Revises: 0053
Create Date: 2026-11-17 17:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0054"
down_revision: str | Sequence[str] | None = "0053"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "files_type_folders",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("course_id", sa.String(), nullable=False),
        sa.Column("type", sa.String(), nullable=False),
        sa.Column("folder_id", sa.String(), nullable=True),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["course_id"], ["academics_courses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["folder_id"], ["files_folders.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["auth_users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("course_id", "type"),
    )
    with op.batch_alter_table("files_type_folders", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_files_type_folders_course_id"), ["course_id"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_files_type_folders_folder_id"), ["folder_id"], unique=False
        )
        batch_op.create_index(batch_op.f("ix_files_type_folders_user_id"), ["user_id"], unique=False)
    # The LMS sync kept them as refs of its own; they are the files' now.
    op.execute(
        """
        INSERT OR IGNORE INTO files_type_folders (id, user_id, course_id, type, folder_id)
        SELECT r.id, r.user_id, l.course_id, r.external_id,
               (SELECT f.id FROM files_folders f WHERE f.id = r.target_id)
        FROM lms_imported_refs r JOIN lms_course_links l ON l.id = r.link_id
        WHERE r.external_kind = 'type_folder'
        """
    )
    op.execute("DELETE FROM lms_imported_refs WHERE external_kind = 'type_folder'")


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("files_type_folders", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_files_type_folders_user_id"))
        batch_op.drop_index(batch_op.f("ix_files_type_folders_folder_id"))
        batch_op.drop_index(batch_op.f("ix_files_type_folders_course_id"))
    op.drop_table("files_type_folders")
