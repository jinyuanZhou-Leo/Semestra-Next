"""lms: a material whose file was made the user's own in 2.1.0 is dismissed

Until 2.1.0 a synced file could be made the user's own (its `source_ref` cleared) while its
material stayed `synced`; each sync then marked it `dismissed` (the user's now, and the
platform's not brought in beside it, listed so it can be restored). Done here once instead.

Revision ID: 0063
Revises: 0062
Create Date: 2026-11-19 21:00:00

"""

from collections.abc import Sequence

from alembic import op

revision: str = "0063"
down_revision: str | Sequence[str] | None = "0062"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "UPDATE lms_materials SET state = 'dismissed', quiet = 0, item_id = NULL,"
        " state_at = (SELECT f.updated_at FROM files_items f WHERE f.id = lms_materials.item_id)"
        " WHERE state = 'synced' AND item_id IN"
        " (SELECT id FROM files_items WHERE kind = 'file' AND source_ref IS NULL)"
    )


def downgrade() -> None:
    """Nothing to undo: `dismissed` is a state the older code reads the same way."""
