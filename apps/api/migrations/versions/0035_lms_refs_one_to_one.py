"""lms: one Semestra object per imported platform item

An assignment is imported once: into the gradebook when it is worth points, else as a to-do,
and a to-do can later move into the gradebook (the ref then points at the assessment). The
unique key drops `target_kind`. Where an older import left both kinds, the assessment's ref is
kept: the to-do is the assessment's own since migration 0033.

Revision ID: 0035
Revises: 0034
Create Date: 2026-11-08 00:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0035"
down_revision: str | Sequence[str] | None = "0034"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        DELETE FROM lms_imported_refs
        WHERE target_kind != 'assessment'
          AND EXISTS (
            SELECT 1 FROM lms_imported_refs AS other
            WHERE other.link_id = lms_imported_refs.link_id
              AND other.external_kind = lms_imported_refs.external_kind
              AND other.external_id = lms_imported_refs.external_id
              AND other.target_kind = 'assessment'
          )
        """
    )
    with op.batch_alter_table("lms_imported_refs", schema=None) as batch_op:
        batch_op.drop_constraint("uq_lms_imported_refs_target", type_="unique")
        batch_op.create_unique_constraint(
            "uq_lms_imported_refs_item", ["link_id", "external_kind", "external_id"]
        )


def downgrade() -> None:
    with op.batch_alter_table("lms_imported_refs", schema=None) as batch_op:
        batch_op.drop_constraint("uq_lms_imported_refs_item", type_="unique")
        batch_op.create_unique_constraint(
            "uq_lms_imported_refs_target",
            ["link_id", "external_kind", "external_id", "target_kind"],
        )
