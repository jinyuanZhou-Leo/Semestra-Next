"""grading: `hide_gpa` becomes `hide_grades`

The setting now masks percentages as well as GPA (M03 §5.3).

Revision ID: 0047
Revises: 0046
Create Date: 2026-11-13 20:30:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0047"
down_revision: str | Sequence[str] | None = "0046"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("grading_scales", schema=None) as batch_op:
        batch_op.alter_column("hide_gpa", new_column_name="hide_grades")


def downgrade() -> None:
    with op.batch_alter_table("grading_scales", schema=None) as batch_op:
        batch_op.alter_column("hide_grades", new_column_name="hide_gpa")
