"""Index every foreign key column that no index starts with

With `foreign_keys=ON`, deleting a parent row makes SQLite look up the rows that refer to it in
each child table; without an index on the child column that is a scan of the whole table (all
users' rows). `tests/test_models.py` keeps new foreign keys indexed.

Revision ID: 0040
Revises: 0039
Create Date: 2026-11-08 17:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

revision: str = "0040"
down_revision: str | None = "0039"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

COLUMNS = (
    ("agent_memories", "source_session_id"),
    ("agent_proposals", "message_id"),
    ("agent_suggestions", "program_id"),
    ("auth_email_challenges", "user_id"),
    ("files_folders", "parent_id"),
    ("files_items", "folder_id"),
    ("grading_assessments", "category_id"),
    ("schedule_events", "term_id"),
    ("tasks_items", "program_id"),
    ("tasks_items", "term_id"),
    ("tasks_lists", "term_id"),
)


def upgrade() -> None:
    for table, column in COLUMNS:
        op.create_index(f"ix_{table}_{column}", table, [column])


def downgrade() -> None:
    for table, column in reversed(COLUMNS):
        op.drop_index(f"ix_{table}_{column}", table_name=table)
