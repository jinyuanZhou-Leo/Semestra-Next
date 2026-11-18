"""files + lms: synced materials follow the platform's folders

- `files_source_folders` replaces `files_type_folders`: the sync no longer files materials by
  type, it puts them where they are on the platform (a module, a folder of the files area, the
  page that links them) and remembers the folders it made for those places.
- `lms_materials` keeps each material's place on the platform (`path`, filled by the next sync)
  and the folder the sync put its item in (`placed_folder_id`), so "Organize" can offer to move
  untouched items back to their platform folders. Items filed under a type folder get that
  folder here, from the type folders being dropped.
- `files.synced_scans` goes: synced files are read like any other, as `auto_index` says. The
  materials settings move from the Program to the account and the course: a Program's choice is
  copied to each of its courses that has none of its own, then the Program rows go.

Revision ID: 0060
Revises: 0059
Create Date: 2026-11-18 22:10:00

"""

import json
from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

from semestra.core.db import new_id

revision: str = "0060"
down_revision: str | Sequence[str] | None = "0059"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _move_program_settings(conn: sa.Connection, namespace: str, keys: set[str] | None) -> None:
    """Copies the `keys` (all when None) of each Program's row of `namespace` to its courses
    that do not set them, then drops them from the Program row (the row goes when empty)."""
    rows = conn.execute(
        sa.text(
            "SELECT id, user_id, scope_id, data FROM settings_values "
            "WHERE namespace = :ns AND scope_type = 'program'"
        ),
        {"ns": namespace},
    ).all()
    for row_id, user_id, program_id, raw in rows:
        data = _load(raw)
        moved = {k: v for k, v in data.items() if keys is None or k in keys}
        if moved:
            courses = conn.execute(
                sa.text("SELECT id FROM academics_courses WHERE user_id = :u AND program_id = :p"),
                {"u": user_id, "p": program_id},
            ).scalars()
            for course_id in list(courses):
                _merge(conn, user_id, namespace, "course", course_id, moved)
        left = {k: v for k, v in data.items() if k not in moved}
        if left:
            conn.execute(
                sa.text("UPDATE settings_values SET data = :d WHERE id = :id"),
                {"d": json.dumps(left), "id": row_id},
            )
        else:
            conn.execute(sa.text("DELETE FROM settings_values WHERE id = :id"), {"id": row_id})


def _load(raw: object) -> dict[str, object]:
    return json.loads(raw) if isinstance(raw, str) else dict(raw or {})  # type: ignore[arg-type]


def _drop_synced_scans(conn: sa.Connection) -> None:
    """`files.synced_scans` is gone: synced files are read like any other (`auto_index`)."""
    rows = conn.execute(
        sa.text("SELECT id, data FROM settings_values WHERE namespace = 'files'")
    ).all()
    for row_id, raw in rows:
        data = _load(raw)
        if "synced_scans" not in data:
            continue
        del data["synced_scans"]
        if data:
            conn.execute(
                sa.text("UPDATE settings_values SET data = :d WHERE id = :id"),
                {"d": json.dumps(data), "id": row_id},
            )
        else:
            conn.execute(sa.text("DELETE FROM settings_values WHERE id = :id"), {"id": row_id})


def _merge(
    conn: sa.Connection,
    user_id: str,
    namespace: str,
    scope_type: str,
    scope_id: str,
    values: dict[str, object],
) -> None:
    """Sets `values` on the scope's row where it does not set them itself (made if missing)."""
    own = conn.execute(
        sa.text(
            "SELECT id, data FROM settings_values WHERE user_id = :u AND namespace = :ns "
            "AND scope_type = :t AND scope_id = :s"
        ),
        {"u": user_id, "ns": namespace, "t": scope_type, "s": scope_id},
    ).first()
    if own is None:
        conn.execute(
            sa.text(
                "INSERT INTO settings_values (id, user_id, namespace, scope_type, scope_id, "
                "data, created_at, updated_at) VALUES (:id, :u, :ns, :t, :s, :d, :now, :now)"
            ),
            {
                "id": new_id(),
                "now": datetime.now(UTC),
                "u": user_id,
                "ns": namespace,
                "t": scope_type,
                "s": scope_id,
                "d": json.dumps(values),
            },
        )
    else:
        conn.execute(
            sa.text("UPDATE settings_values SET data = :d WHERE id = :id"),
            {"d": json.dumps({**values, **_load(own[1])}), "id": own[0]},
        )


def upgrade() -> None:
    op.create_table(
        "files_source_folders",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("course_id", sa.String(), nullable=False),
        sa.Column("source_kind", sa.String(), nullable=False),
        sa.Column("path", sa.String(), nullable=False),
        sa.Column("source_name", sa.String(), nullable=False),
        sa.Column("folder_id", sa.String(), nullable=True),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["course_id"], ["academics_courses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["folder_id"], ["files_folders.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["auth_users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("course_id", "source_kind", "path"),
    )
    with op.batch_alter_table("files_source_folders", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_files_source_folders_course_id"), ["course_id"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_files_source_folders_folder_id"), ["folder_id"], unique=False
        )
        batch_op.create_index(
            batch_op.f("ix_files_source_folders_user_id"), ["user_id"], unique=False
        )

    with op.batch_alter_table("lms_materials", schema=None) as batch_op:
        batch_op.add_column(sa.Column("path", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("placed_folder_id", sa.String(), nullable=True))

    conn = op.get_bind()
    # Items filed under a type folder: that folder is where the sync put them.
    conn.execute(
        sa.text(
            "UPDATE lms_materials SET placed_folder_id = ("
            " SELECT t.folder_id FROM files_type_folders t"
            " JOIN lms_course_links l ON l.course_id = t.course_id"
            " WHERE l.id = lms_materials.link_id AND t.type = lms_materials.type"
            ") WHERE state = 'synced' AND type IS NOT NULL"
        )
    )

    with op.batch_alter_table("lms_materials", schema=None) as batch_op:
        batch_op.drop_column("type")
        batch_op.drop_column("sorted_by_model")

    with op.batch_alter_table("files_type_folders", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_files_type_folders_course_id"))
        batch_op.drop_index(batch_op.f("ix_files_type_folders_folder_id"))
        batch_op.drop_index(batch_op.f("ix_files_type_folders_user_id"))
    op.drop_table("files_type_folders")

    _drop_synced_scans(conn)
    _move_program_settings(conn, "lms.materials", None)


def downgrade() -> None:
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
        batch_op.create_index(
            batch_op.f("ix_files_type_folders_user_id"), ["user_id"], unique=False
        )
    with op.batch_alter_table("lms_materials", schema=None) as batch_op:
        batch_op.add_column(sa.Column("type", sa.String(), nullable=True))
        batch_op.add_column(
            sa.Column("sorted_by_model", sa.Boolean(), nullable=False, server_default=sa.false())
        )
        batch_op.drop_column("placed_folder_id")
        batch_op.drop_column("path")
    op.drop_table("files_source_folders")
