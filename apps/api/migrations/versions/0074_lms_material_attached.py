"""lms: materials seen only as an announcement's attachment

`lms_materials.attached` marks a material last seen only as an attachment of an announcement
(M09 §4.6): the announcements are then the one place it may be in. False for every existing
row: none came in that way before.

The sync now also reads the syllabus, the links of assignments, announcements and calendar
events, and the announcements' attachments (M09 §4.6, table 4d). What it brings in on its first
run after this upgrade was on the platform all along: each course's next materials run is quiet
again (`materials_settled_at` cleared, as when the materials sync is turned on), so none of it
is told as new.

Revision ID: 0074
Revises: 0073
Create Date: 2026-11-24 16:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0074"
down_revision: str | Sequence[str] | None = "0073"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("lms_materials") as batch_op:
        batch_op.add_column(
            sa.Column("attached", sa.Boolean(), nullable=False, server_default=sa.text("0"))
        )
    op.execute("UPDATE lms_course_links SET materials_settled_at = NULL")


def downgrade() -> None:
    with op.batch_alter_table("lms_materials") as batch_op:
        batch_op.drop_column("attached")
