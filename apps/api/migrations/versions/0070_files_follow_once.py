"""files, lms: which source keeps an item, its name and its version, each kept once

`files_items.source_ref` only said whether the LMS kept an item (its id after the prefix was
never read: the material's `item_id` names the item), `source_name` said it again, and a followed
material's version was kept on the material and on its item. Now (M09 §4.6): `source_kind`
alone says which source keeps an item (`lms`, else none: `upload`/`agent` were never read), the
source's name is given by the source when read, a followed item's version is its
`source_version` (links too), a material keeps a version only while it has no followed item, and
each followed item is exactly one `synced` material's (`uq_lms_materials_followed`). What broke
that is mended: of materials sharing an item the latest stays (the others `absent`, brought in
again by the next sync); one whose item is gone is the user's delete (`dismissed`); one whose
item was handed over is `absent`; a followed item no material names is handed over (a link, a
stored file) or goes with its page images (a file read online: nothing is left to open). A handed-over file no longer keeps the platform's address. Backups made before
this are read the same way (`lms/older_backups.py`, step 0070).

Revision ID: 0070
Revises: 0068
Create Date: 2026-11-23 03:30:00

"""

import hashlib
import re
from collections.abc import Sequence
from pathlib import Path

import sqlalchemy as sa
from alembic import op

from semestra.core.config import get_settings

# revision identifiers, used by Alembic.
revision: str = "0070"
down_revision: str | Sequence[str] | None = "0068"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# A storage key (`core/storage._KEY` at 0070).
_KEY = re.compile(r"[A-Za-z0-9_-][A-Za-z0-9._-]*(/[A-Za-z0-9_-][A-Za-z0-9._-]*)*")
# Nothing applied from the platform (`sync_files.enter` at 0070).
_FORGET = (
    "state = 'absent', quiet = 0, version = NULL, name = NULL, checked_at = NULL,"
    " placed_folder_id = NULL, links = '[]'"
)
# What a file the user owns has none of.
_SOURCE_SIDE = (
    "source_kind = NULL, url = NULL, keep_copy = NULL, source_version = NULL,"
    " source_mime = NULL, source_size = NULL, copy_version = NULL, copy_modified_at = NULL,"
    " copy_error_code = NULL"
)


def upgrade() -> None:
    conn = op.get_bind()
    # Files handed over before this kept `lms` and the platform's address (their `source_ref`
    # was cleared).
    conn.execute(
        sa.text(
            "UPDATE files_items SET url = NULL WHERE kind = 'file' AND source_kind = 'lms'"
            " AND (source_ref IS NULL OR source_ref NOT LIKE 'lms:%')"
        )
    )
    conn.execute(
        sa.text(
            "UPDATE files_items SET source_kind = CASE WHEN source_ref LIKE 'lms:%'"
            " THEN 'lms' ELSE NULL END"
        )
    )
    items = {
        item_id: (source, stored, kind)
        for item_id, source, stored, kind in conn.execute(
            sa.text("SELECT id, source_kind, storage_key IS NOT NULL, kind FROM files_items")
        ).all()
    }
    synced = conn.execute(
        sa.text(
            "SELECT id, item_id, kind, version FROM lms_materials WHERE state = 'synced'"
            " ORDER BY state_at IS NULL, state_at DESC"
        )
    ).all()
    owned: set[str] = set()
    for mat_id, item_id, kind, version in synced:
        found = items.get(item_id or "")
        if item_id in owned:
            conn.execute(
                sa.text(f"UPDATE lms_materials SET {_FORGET}, item_id = NULL WHERE id = :id"),
                {"id": mat_id},
            )
        elif found is None:
            conn.execute(
                sa.text(
                    "UPDATE lms_materials SET state = 'dismissed', item_id = NULL, version = NULL"
                    " WHERE id = :id"
                ),
                {"id": mat_id},
            )
        elif found[0] != "lms":
            conn.execute(sa.text(f"UPDATE lms_materials SET {_FORGET} WHERE id = :id"), {"id": mat_id})
        else:
            owned.add(item_id)
            if kind == "link" and version:
                conn.execute(
                    sa.text("UPDATE files_items SET source_version = :v WHERE id = :id"),
                    {"v": hashlib.sha256(str(version).encode()).hexdigest(), "id": item_id},
                )
    images: list[str] = []
    for item_id, (source, stored, kind) in items.items():
        if source != "lms" or item_id in owned:
            continue
        if kind == "link":  # the user's link from now on: it still opens where it pointed
            conn.execute(
                sa.text(
                    "UPDATE files_items SET source_kind = NULL, source_version = NULL"
                    " WHERE id = :id"
                ),
                {"id": item_id},
            )
        elif stored:
            conn.execute(sa.text(f"UPDATE files_items SET {_SOURCE_SIDE} WHERE id = :id"), {"id": item_id})
        else:
            # Followed by nothing, and nothing kept of it: it goes with its text and search
            # entries (vector rows are left: search only finds chunks that are there).
            conn.execute(
                sa.text(
                    "DELETE FROM files_chunks_fts WHERE rowid IN (SELECT c.fts_rowid FROM"
                    " files_chunks c JOIN files_documents d ON d.id = c.document_id"
                    " WHERE d.item_id = :id)"
                ),
                {"id": item_id},
            )
            images += conn.execute(
                sa.text(
                    "SELECT p.image_storage_key FROM files_document_pages p JOIN files_documents d"
                    " ON d.id = p.document_id WHERE d.item_id = :id"
                    " AND p.image_storage_key IS NOT NULL"
                ),
                {"id": item_id},
            ).scalars().all()
            for table in ("files_chunks", "files_document_pages"):
                conn.execute(
                    sa.text(
                        f"DELETE FROM {table} WHERE document_id IN"
                        " (SELECT id FROM files_documents WHERE item_id = :id)"
                    ),
                    {"id": item_id},
                )
            for table in ("files_documents", "files_index_state"):
                conn.execute(sa.text(f"DELETE FROM {table} WHERE item_id = :id"), {"id": item_id})
            conn.execute(sa.text("DELETE FROM files_items WHERE id = :id"), {"id": item_id})
    conn.execute(sa.text("UPDATE lms_materials SET version = NULL WHERE state = 'synced'"))
    with op.batch_alter_table("lms_materials", schema=None) as batch_op:
        batch_op.create_index(
            "uq_lms_materials_followed",
            ["item_id"],
            unique=True,
            sqlite_where=sa.text("state = 'synced'"),
        )
    with op.batch_alter_table("files_items", schema=None) as batch_op:
        batch_op.drop_column("source_ref")
        batch_op.drop_column("source_name")
    # Last, once nothing else can fail: the page images of the files that went.
    _delete_stored(images)


def _delete_stored(keys: Sequence[str]) -> None:
    """Removes objects from the (local) storage, as `storage.LocalStorage.delete` does."""
    if not keys:
        return
    root = Path(get_settings().storage_local_root)
    for key in keys:
        if _KEY.fullmatch(key):
            (root / key).unlink(missing_ok=True)


def downgrade() -> None:
    with op.batch_alter_table("files_items", schema=None) as batch_op:
        batch_op.add_column(sa.Column("source_name", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("source_ref", sa.String(), nullable=True))
    with op.batch_alter_table("lms_materials", schema=None) as batch_op:
        batch_op.drop_index("uq_lms_materials_followed")
