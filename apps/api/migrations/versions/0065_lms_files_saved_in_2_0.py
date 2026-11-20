"""lms: files saved from the Canvas tab in 2.0 become materials or the user's own

In 2.0 the Canvas tab saved a platform file into the course with a `source_ref` of its own
spelling (`lms:<provider>:<connection>:file:<id>`) and no material; since 2.1 a file saved there
is its material's item (`lms:file:<id>`), as one the sync brought in. Such a file follows its
source in name only: nothing reads it from the platform, the sync brings the platform's file in
beside it, and unlinking the course leaves it following.

Each is now what saving it today makes it: the item of its material, on the course still linked
through the same connection, unless that material already has an item (an earlier save, or the
sync's since 2.1); then, as on any other course, it is the user's own file, its copy's hash
taken back from `source_version` (where migration 0062 put it). The material's version stays
unknown, so the next sync reads the platform's file again.

Revision ID: 0065
Revises: 0064
Create Date: 2026-11-20 21:00:00

"""

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

revision: str = "0065"
down_revision: str | Sequence[str] | None = "0064"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The providers' names at this revision (`LmsProvider.display_name`).
PROVIDER_NAMES = {"canvas": "Canvas"}


def saved_in_2_0(ref: object) -> tuple[str, str, str] | None:
    """(provider, connection, file id) of a `source_ref` 2.0's Canvas tab wrote."""
    parts = ref.split(":") if isinstance(ref, str) else []
    if len(parts) == 5 and parts[0] == "lms" and parts[3] == "file" and all(parts):
        return parts[1], parts[2], parts[4]
    return None


def upgrade() -> None:
    conn = op.get_bind()
    now = datetime.now(UTC).isoformat(sep=" ")
    rows = conn.execute(
        sa.text(
            "SELECT id, user_id, course_id, display_name, source_ref FROM files_items"
            " WHERE kind = 'file' AND source_ref LIKE 'lms:%:%:file:%'"
            " ORDER BY created_at, id"
        )
    ).fetchall()
    for item_id, user_id, course_id, name, ref in rows:
        parsed = saved_in_2_0(ref)
        if parsed is None:
            continue
        provider, connection_id, file_id = parsed
        link_id = conn.scalar(
            sa.text(
                "SELECT id FROM lms_course_links WHERE course_id = :course"
                " AND connection_id = :connection"
            ).bindparams(course=course_id, connection=connection_id)
        )
        mat = (
            conn.execute(
                sa.text(
                    "SELECT id, state, item_id FROM lms_materials WHERE link_id = :link"
                    " AND kind = 'file' AND external_id = :file"
                ).bindparams(link=link_id, file=file_id)
            ).first()
            if link_id is not None
            else None
        )
        taken = mat is not None and mat.state == "synced" and mat.item_id is not None
        if link_id is None or taken:
            conn.execute(
                sa.text(
                    "UPDATE files_items SET source_ref = NULL, source_name = NULL,"
                    " keep_copy = NULL, sha256 = COALESCE(sha256, source_version),"
                    " source_version = NULL, source_mime = NULL, source_size = NULL,"
                    " copy_version = NULL, copy_modified_at = NULL, copy_error_code = NULL"
                    " WHERE id = :id"
                ).bindparams(id=item_id)
            )
            continue
        conn.execute(
            sa.text(
                "UPDATE files_items SET source_ref = :ref, source_name = :source,"
                " keep_copy = 1 WHERE id = :id"
            ).bindparams(
                ref=f"lms:file:{file_id}", source=PROVIDER_NAMES.get(provider), id=item_id
            )
        )
        state = {
            "state": "synced",
            "state_at": now,
            "item_id": item_id,
            "title": name,
            "name": name,
            "now": now,
        }
        if mat is None:
            conn.execute(
                sa.text(
                    "INSERT INTO lms_materials (id, user_id, link_id, kind, external_id, state,"
                    " state_at, quiet, item_id, title, name, links, imported_at)"
                    " VALUES (:id, :user, :link, 'file', :file, :state, :state_at, 0, :item_id,"
                    " :title, :name, '[]', :now)"
                ).bindparams(
                    id=str(uuid.uuid7()), user=user_id, link=link_id, file=file_id, **state
                )
            )
        else:
            conn.execute(
                sa.text(
                    "UPDATE lms_materials SET state = :state, state_at = :state_at, quiet = 0,"
                    " item_id = :item_id, title = :title, name = :name, version = NULL,"
                    " checked_at = NULL, placed_folder_id = NULL, links = '[]',"
                    " imported_at = :now, change = NULL, changed_at = NULL WHERE id = :id"
                ).bindparams(id=mat.id, **state)
            )


def downgrade() -> None:
    """Nothing to undo: the older code reads these as files saved since 2.1 and as the user's
    own."""
