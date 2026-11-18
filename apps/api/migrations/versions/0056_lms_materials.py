"""lms: course materials tracked in lms_materials; lms_imported_refs keeps the assignments

The sync's rows for a course's files, pages and links (`external_kind` file, page, link) kept
their state in `snapshot` JSON; they move to `lms_materials`, one column per state, with the
course file item in `item_id`. What is left in `lms_imported_refs` is assignments only, so its
`external_kind` goes.

Revision ID: 0056
Revises: 0055
Create Date: 2026-11-18 03:13:15.530331

"""

import json
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any

import sqlalchemy as sa
from alembic import op

import semestra.core.db

# revision identifiers, used by Alembic.
revision: str = "0056"
down_revision: str | Sequence[str] | None = "0055"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

MATERIALS = ("file", "page", "link")

materials = sa.table(
    "lms_materials",
    sa.column("id", sa.String()),
    sa.column("user_id", sa.String()),
    sa.column("link_id", sa.String()),
    sa.column("kind", sa.String()),
    sa.column("external_id", sa.String()),
    sa.column("item_id", sa.String()),
    sa.column("title", sa.String()),
    sa.column("version", sa.String()),
    sa.column("name", sa.String()),
    sa.column("type", sa.String()),
    sa.column("sorted_by_model", sa.Boolean()),
    sa.column("is_list", sa.Boolean()),
    sa.column("links", sa.JSON()),
    sa.column("checked_at", semestra.core.db.UTCDateTime(timezone=True)),
    sa.column("imported_at", semestra.core.db.UTCDateTime(timezone=True)),
    sa.column("deleted_at", semestra.core.db.UTCDateTime(timezone=True)),
)
refs = sa.table(
    "lms_imported_refs",
    sa.column("id", sa.String()),
    sa.column("user_id", sa.String()),
    sa.column("link_id", sa.String()),
    sa.column("external_kind", sa.String()),
    sa.column("external_id", sa.String()),
    sa.column("target_kind", sa.String()),
    sa.column("target_id", sa.String()),
    sa.column("snapshot", sa.JSON()),
    sa.column("imported_at", semestra.core.db.UTCDateTime(timezone=True)),
    sa.column("dismissed_at", semestra.core.db.UTCDateTime(timezone=True)),
    sa.column("conflicts", sa.JSON()),
)


def _when(value: Any) -> datetime | None:
    if value is None:
        return None
    when = value if isinstance(value, datetime) else datetime.fromisoformat(str(value))
    return when.replace(tzinfo=UTC) if when.tzinfo is None else when


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "lms_materials",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("link_id", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("external_id", sa.String(), nullable=False),
        sa.Column("item_id", sa.String(), nullable=True),
        sa.Column("title", sa.String(), nullable=True),
        sa.Column("version", sa.String(), nullable=True),
        sa.Column("name", sa.String(), nullable=True),
        sa.Column("type", sa.String(), nullable=True),
        sa.Column("sorted_by_model", sa.Boolean(), nullable=False),
        sa.Column("is_list", sa.Boolean(), nullable=False),
        sa.Column("links", sa.JSON(), nullable=False),
        sa.Column("checked_at", semestra.core.db.UTCDateTime(timezone=True), nullable=True),
        sa.Column("imported_at", semestra.core.db.UTCDateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", semestra.core.db.UTCDateTime(timezone=True), nullable=True),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["link_id"], ["lms_course_links.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["auth_users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("link_id", "kind", "external_id", name="uq_lms_materials_item"),
    )
    with op.batch_alter_table("lms_materials", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_lms_materials_item_id"), ["item_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_lms_materials_link_id"), ["link_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_lms_materials_user_id"), ["user_id"], unique=False)

    bind = op.get_bind()
    rows = bind.execute(
        sa.select(
            refs.c.id,
            refs.c.user_id,
            refs.c.link_id,
            refs.c.external_kind,
            refs.c.external_id,
            refs.c.target_id,
            refs.c.snapshot,
            refs.c.imported_at,
            refs.c.dismissed_at,
        ).where(refs.c.external_kind.in_(MATERIALS))
    ).all()
    moved: list[dict[str, Any]] = []
    for r in rows:
        snap = r.snapshot if isinstance(r.snapshot, dict) else json.loads(r.snapshot or "{}")
        moved.append(
            {
                # The id stays: nothing points at it, but it keeps the row recognisable.
                "id": r.id,
                "user_id": r.user_id,
                "link_id": r.link_id,
                "kind": r.external_kind,
                "external_id": r.external_id,
                "item_id": r.target_id,
                "title": snap.get("title"),
                "version": snap.get("version"),
                "name": snap.get("name"),
                "type": snap.get("type"),
                "sorted_by_model": snap.get("by") == "ai",
                "is_list": bool(snap.get("list")),
                "links": snap.get("links") or [],
                "checked_at": _when(snap.get("checked")),
                "imported_at": _when(r.imported_at),
                "deleted_at": _when(r.dismissed_at),
            }
        )
    if moved:
        op.bulk_insert(materials, moved)
    op.execute(refs.delete().where(refs.c.external_kind != "assignment"))

    with op.batch_alter_table("lms_imported_refs", schema=None) as batch_op:
        batch_op.drop_constraint("uq_lms_imported_refs_item", type_="unique")
        batch_op.create_unique_constraint("uq_lms_imported_refs_item", ["link_id", "external_id"])
        batch_op.drop_column("external_kind")


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("lms_imported_refs", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("external_kind", sa.VARCHAR(), server_default="assignment", nullable=False)
        )
        batch_op.drop_constraint("uq_lms_imported_refs_item", type_="unique")
        batch_op.create_unique_constraint(
            "uq_lms_imported_refs_item", ["link_id", "external_kind", "external_id"]
        )

    bind = op.get_bind()
    back: list[dict[str, Any]] = []
    for m in bind.execute(sa.select(materials)).all():
        snap: dict[str, Any] = {"links": m.links or []}
        for key, value in (
            ("title", m.title),
            ("version", m.version),
            ("name", m.name),
            ("type", m.type),
        ):
            if value is not None:
                snap[key] = value
        if m.sorted_by_model:
            snap["by"] = "ai"
        if m.is_list:
            snap["list"] = True
        if (checked := _when(m.checked_at)) is not None:
            snap["checked"] = checked.isoformat()
        back.append(
            {
                "id": m.id,
                "user_id": m.user_id,
                "link_id": m.link_id,
                "external_kind": m.kind,
                "external_id": m.external_id,
                "target_kind": "file_item" if m.item_id else None,
                "target_id": m.item_id,
                "snapshot": snap,
                "imported_at": _when(m.imported_at),
                "dismissed_at": _when(m.deleted_at),
                "conflicts": {},
            }
        )
    if back:
        op.bulk_insert(refs, back)

    with op.batch_alter_table("lms_materials", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_lms_materials_user_id"))
        batch_op.drop_index(batch_op.f("ix_lms_materials_link_id"))
        batch_op.drop_index(batch_op.f("ix_lms_materials_item_id"))

    op.drop_table("lms_materials")
