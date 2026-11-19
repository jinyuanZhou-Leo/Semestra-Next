"""lms: course materials in four states; core: a job asked for again while it runs

- `lms_materials`: `restored`, `gone` and `handed_over` become `absent` (not in the files,
  brought in when the platform shows it); restored ones keep coming in quietly (`quiet`). What
  was applied from the platform is forgotten for all of them, so they are read whole when they
  come in (a restored page unchanged on the platform used to be skipped). A file handed over
  keeps naming the user's own file (`item_id`), no longer followed.
- `lms_materials.name` is again what the sync named the item (`safe_name` of the platform title
  it last applied): the sync used to write the item's current name back every run, so a name
  the user gave it read as the sync's and the next content update took it away.
- `core_jobs.next_payload`: a job asked for again while it ran (`enqueue(..., again=True)`)
  runs once more after it ends.

Revision ID: 0061
Revises: 0060
Create Date: 2026-11-19 16:30:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from semestra.modules.files.service import safe_name

revision: str = "0061"
down_revision: str | Sequence[str] | None = "0060"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("lms_materials", schema=None) as batch_op:
        batch_op.add_column(sa.Column("quiet", sa.Boolean(), server_default="0", nullable=False))
    with op.batch_alter_table("core_jobs", schema=None) as batch_op:
        batch_op.add_column(sa.Column("next_payload", sa.JSON(), nullable=True))
    op.execute(
        "UPDATE lms_materials SET quiet = (state = 'restored'),"
        " item_id = CASE WHEN state = 'handed_over' THEN item_id END,"
        " state = 'absent', version = NULL, name = NULL, checked_at = NULL,"
        " placed_folder_id = NULL, links = '[]'"
        " WHERE state IN ('restored', 'gone', 'handed_over')"
    )
    bind = op.get_bind()
    named = bind.execute(
        sa.text("SELECT id, title FROM lms_materials WHERE state = 'synced' AND title IS NOT NULL")
    ).all()
    for material_id, title in named:
        bind.execute(
            sa.text("UPDATE lms_materials SET name = :name WHERE id = :id"),
            {"name": safe_name(title), "id": material_id},
        )


def downgrade() -> None:
    op.execute(
        "UPDATE lms_materials SET state = CASE"
        " WHEN quiet THEN 'restored' WHEN item_id IS NOT NULL THEN 'handed_over' ELSE 'gone' END"
        " WHERE state = 'absent'"
    )
    with op.batch_alter_table("core_jobs", schema=None) as batch_op:
        batch_op.drop_column("next_payload")
    with op.batch_alter_table("lms_materials", schema=None) as batch_op:
        batch_op.drop_column("quiet")
