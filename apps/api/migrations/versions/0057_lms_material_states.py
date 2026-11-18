"""lms: material states and two-level materials settings; files: local copies keep following

A course material gets an explicit state (`synced`, `list`, `dismissed`, `restored`, `gone`,
`handed_over`) and its last change for the sync panel. The per-link `files_sync` and
`files_offline` move to the M11 namespace `lms.materials` (course level, only where they differed
from the default). A file the user kept (`kept_offline`) no longer stops following its source:
it follows it with the local copy the user asked for (`keep_copy`). Synced files name their
source (`source_name`); they get the platform's modification time and the "new" mark from the
next sync on. Courses whose materials came in already count as settled, so what comes in next is
told as new.

Revision ID: 0057
Revises: 0056
Create Date: 2026-11-18 03:49:44.196432

"""

from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

import semestra.core.db

# revision identifiers, used by Alembic.
revision: str = "0057"
down_revision: str | Sequence[str] | None = "0056"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The providers' names at this revision (`LmsProvider.display_name`).
PROVIDER_NAMES = {"canvas": "Canvas"}


def upgrade() -> None:
    now = datetime.now(UTC).isoformat(sep=" ")
    with op.batch_alter_table("files_items", schema=None) as batch_op:
        batch_op.add_column(sa.Column("keep_copy", sa.Boolean(), nullable=True))
        batch_op.add_column(sa.Column("source_name", sa.String(), nullable=True))
        batch_op.add_column(
            sa.Column(
                "source_modified_at", semestra.core.db.UTCDateTime(timezone=True), nullable=True
            )
        )
        batch_op.add_column(sa.Column("unseen", sa.Boolean(), server_default="0", nullable=False))
        batch_op.add_column(sa.Column("copy_version", sa.String(length=64), nullable=True))
    op.execute("UPDATE files_items SET keep_copy = 1 WHERE kept_offline = 1")
    # The local copies hold the version their source last had.
    op.execute(
        "UPDATE files_items SET copy_version = sha256"
        " WHERE storage_key IS NOT NULL AND source_ref IS NOT NULL"
    )
    for provider, name in PROVIDER_NAMES.items():
        op.execute(
            sa.text(
                """
                UPDATE files_items SET source_name = :name
                WHERE source_ref LIKE 'lms:%' AND id IN (
                    SELECT m.item_id FROM lms_materials m
                    JOIN lms_course_links l ON l.id = m.link_id
                    JOIN lms_connections c ON c.id = l.connection_id
                    WHERE c.provider = :provider AND m.item_id IS NOT NULL
                )
                """
            ).bindparams(name=name, provider=provider)
        )
    with op.batch_alter_table("files_items", schema=None) as batch_op:
        batch_op.drop_column("kept_offline")

    with op.batch_alter_table("lms_course_links", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "materials_settled_at", semestra.core.db.UTCDateTime(timezone=True), nullable=True
            )
        )
    bind = op.get_bind()
    op.execute(
        sa.text(
            "UPDATE lms_course_links SET materials_settled_at = :now WHERE id IN "
            "(SELECT DISTINCT link_id FROM lms_materials)"
        ).bindparams(now=now)
    )
    values = sa.table(
        "settings_values",
        sa.column("id", sa.String()),
        sa.column("user_id", sa.String()),
        sa.column("namespace", sa.String()),
        sa.column("scope_type", sa.String()),
        sa.column("scope_id", sa.String()),
        sa.column("data", sa.JSON()),
        sa.column("created_at", semestra.core.db.UTCDateTime(timezone=True)),
        sa.column("updated_at", semestra.core.db.UTCDateTime(timezone=True)),
    )
    rows = bind.execute(
        sa.text(
            "SELECT user_id, course_id, files_sync, files_offline FROM lms_course_links "
            "WHERE files_sync = 0 OR files_offline = 1"
        )
    ).all()
    stamp = datetime.now(UTC)
    op.bulk_insert(
        values,
        [
            {
                "id": semestra.core.db.new_id(),
                "user_id": user_id,
                "namespace": "lms.materials",
                "scope_type": "course",
                "scope_id": course_id,
                "data": {
                    **({"sync": False} if not files_sync else {}),
                    **({"store": "local"} if files_offline else {}),
                },
                "created_at": stamp,
                "updated_at": stamp,
            }
            for user_id, course_id, files_sync, files_offline in rows
        ],
    )
    with op.batch_alter_table("lms_course_links", schema=None) as batch_op:
        batch_op.drop_column("files_sync")
        batch_op.drop_column("files_offline")

    with op.batch_alter_table("lms_materials", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("state", sa.String(), server_default="synced", nullable=False)
        )
        batch_op.add_column(
            sa.Column("state_at", semestra.core.db.UTCDateTime(timezone=True), nullable=True)
        )
        batch_op.add_column(sa.Column("change", sa.String(), nullable=True))
        batch_op.add_column(
            sa.Column("changed_at", semestra.core.db.UTCDateTime(timezone=True), nullable=True)
        )
        batch_op.create_index(
            batch_op.f("ix_lms_materials_changed_at"), ["changed_at"], unique=False
        )
    op.execute(
        "UPDATE lms_materials SET state = 'dismissed', state_at = deleted_at "
        "WHERE deleted_at IS NOT NULL"
    )
    op.execute("UPDATE lms_materials SET state = 'list' WHERE is_list = 1 AND deleted_at IS NULL")
    # Without an item, not deleted by the user, not a list: it left the platform.
    op.execute(
        "UPDATE lms_materials SET state = 'gone' "
        "WHERE item_id IS NULL AND deleted_at IS NULL AND is_list = 0"
    )
    with op.batch_alter_table("lms_materials", schema=None) as batch_op:
        batch_op.drop_column("is_list")
        batch_op.drop_column("deleted_at")


def downgrade() -> None:
    with op.batch_alter_table("lms_materials", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("deleted_at", semestra.core.db.UTCDateTime(timezone=True), nullable=True)
        )
        batch_op.add_column(
            sa.Column("is_list", sa.Boolean(), server_default="0", nullable=False)
        )
    op.execute("UPDATE lms_materials SET deleted_at = state_at WHERE state = 'dismissed'")
    op.execute("UPDATE lms_materials SET is_list = 1 WHERE state = 'list'")
    with op.batch_alter_table("lms_materials", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_lms_materials_changed_at"))
        batch_op.drop_column("changed_at")
        batch_op.drop_column("change")
        batch_op.drop_column("state_at")
        batch_op.drop_column("state")

    with op.batch_alter_table("lms_course_links", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("files_offline", sa.Boolean(), server_default="0", nullable=False)
        )
        batch_op.add_column(
            sa.Column("files_sync", sa.Boolean(), server_default="1", nullable=False)
        )
        batch_op.drop_column("materials_settled_at")
    op.execute("DELETE FROM settings_values WHERE namespace = 'lms.materials'")

    with op.batch_alter_table("files_items", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("kept_offline", sa.Boolean(), server_default="0", nullable=False)
        )
    op.execute("UPDATE files_items SET kept_offline = 1 WHERE keep_copy = 1")
    with op.batch_alter_table("files_items", schema=None) as batch_op:
        batch_op.drop_column("copy_version")
        batch_op.drop_column("unseen")
        batch_op.drop_column("source_modified_at")
        batch_op.drop_column("source_name")
        batch_op.drop_column("keep_copy")
