"""lms: area reads and single reads of the course sync

What the sync last got from each area's list (`lms_course_links.area_reads`) and from each item
read on its own (`lms_item_checks`), the input of the one rule for "gone from the platform"
(M09 §4.2, table 3c). The materials' `checked_at` was such a single read of a material still in
the files: it becomes a `present` check.

Revision ID: 0068
Revises: 0067
Create Date: 2026-11-22 20:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import semestra.core.db
from semestra.core.db import new_id

# revision identifiers, used by Alembic.
revision: str = "0068"
down_revision: str | Sequence[str] | None = "0067"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

materials = sa.table(
    "lms_materials",
    sa.column("user_id", sa.String()),
    sa.column("link_id", sa.String()),
    sa.column("kind", sa.String()),
    sa.column("external_id", sa.String()),
    sa.column("state", sa.String()),
    sa.column("checked_at", semestra.core.db.UTCDateTime(timezone=True)),
)
checks = sa.table(
    "lms_item_checks",
    sa.column("id", sa.String()),
    sa.column("user_id", sa.String()),
    sa.column("link_id", sa.String()),
    sa.column("kind", sa.String()),
    sa.column("external_id", sa.String()),
    sa.column("result", sa.String()),
    sa.column("at", semestra.core.db.UTCDateTime(timezone=True)),
)


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "lms_item_checks",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("link_id", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("external_id", sa.String(), nullable=False),
        sa.Column("result", sa.String(), nullable=False),
        sa.Column("reason", sa.String(), nullable=True),
        sa.Column("at", semestra.core.db.UTCDateTime(timezone=True), nullable=False),
        sa.Column("unavailable_since", semestra.core.db.UTCDateTime(timezone=True), nullable=True),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["link_id"], ["lms_course_links.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["auth_users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("link_id", "kind", "external_id", name="uq_lms_item_checks_item"),
    )
    with op.batch_alter_table("lms_item_checks", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_lms_item_checks_link_id"), ["link_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_lms_item_checks_user_id"), ["user_id"], unique=False)
    with op.batch_alter_table("lms_course_links", schema=None) as batch_op:
        batch_op.add_column(sa.Column("area_reads", sa.JSON(), server_default="{}", nullable=False))

    bind = op.get_bind()
    rows = bind.execute(
        sa.select(
            materials.c.user_id,
            materials.c.link_id,
            materials.c.kind,
            materials.c.external_id,
            materials.c.checked_at,
        ).where(materials.c.checked_at.is_not(None), materials.c.state.in_(("synced", "list")))
    ).all()
    if rows:
        op.bulk_insert(
            checks,
            [
                {
                    "id": new_id(),
                    "user_id": r.user_id,
                    "link_id": r.link_id,
                    "kind": r.kind,
                    "external_id": r.external_id,
                    "result": "present",
                    "at": r.checked_at,
                }
                for r in rows
            ],
        )
    with op.batch_alter_table("lms_materials", schema=None) as batch_op:
        batch_op.drop_column("checked_at")


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("lms_materials", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("checked_at", semestra.core.db.UTCDateTime(timezone=True), nullable=True)
        )
    bind = op.get_bind()
    for r in bind.execute(
        sa.select(checks.c.link_id, checks.c.kind, checks.c.external_id, checks.c.at).where(
            checks.c.result == "present", checks.c.kind.in_(("file", "page", "link"))
        )
    ).all():
        op.execute(
            materials.update()
            .where(
                materials.c.link_id == r.link_id,
                materials.c.kind == r.kind,
                materials.c.external_id == r.external_id,
            )
            .values(checked_at=r.at)
        )
    with op.batch_alter_table("lms_course_links", schema=None) as batch_op:
        batch_op.drop_column("area_reads")
    with op.batch_alter_table("lms_item_checks", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_lms_item_checks_user_id"))
        batch_op.drop_index(batch_op.f("ix_lms_item_checks_link_id"))
    op.drop_table("lms_item_checks")
