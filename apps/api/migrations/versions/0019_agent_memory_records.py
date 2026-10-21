"""agent memories as named records (name, type, description, body)

Revision ID: 0019
Revises: 0018
Create Date: 2026-10-21 02:10:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0019"
down_revision: str | Sequence[str] | None = "0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Old categories → types: preferences and background describe the user; goals and constraints
# are what they are working towards or within.
_TYPES = {"preference": "user", "context": "user", "goal": "project", "constraint": "project"}
# The new one-line limit (old memories could be 200 characters).
_LINE = 150


def _split(content: str) -> tuple[str, str]:
    """A line that fits, and the whole text as the body when it did not (nothing is lost)."""
    content = " ".join(content.split())
    if len(content) <= _LINE:
        return content, ""
    cut = content[: _LINE - 1]
    space = cut.rfind(" ")
    if space > _LINE // 2:
        cut = cut[:space]
    return cut.rstrip() + "…", content


_CATEGORIES = {
    "user": "context",
    "feedback": "preference",
    "project": "goal",
    "reference": "context",
}


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("agent_memories", schema=None) as batch_op:
        batch_op.add_column(sa.Column("name", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("type", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("description", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("body", sa.String(), nullable=False, server_default=""))

    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, category, content FROM agent_memories")).all()
    for row in rows:
        description, body = _split(row.content)
        conn.execute(
            sa.text(
                "UPDATE agent_memories SET name = :name, type = :type, description = :description, "
                "body = :body WHERE id = :id"
            ),
            {
                "id": row.id,
                # The random tail of the UUIDv7 (its head is the timestamp, shared by memories
                # saved in the same minute). The model can rename it later.
                "name": "memory-" + row.id.replace("-", "")[-8:],
                "type": _TYPES.get(row.category, "user"),
                "description": description,
                "body": body,
            },
        )

    with op.batch_alter_table("agent_memories", schema=None) as batch_op:
        batch_op.alter_column("name", existing_type=sa.String(), nullable=False)
        batch_op.alter_column("type", existing_type=sa.String(), nullable=False)
        batch_op.alter_column("description", existing_type=sa.String(), nullable=False)
        batch_op.alter_column("body", existing_type=sa.String(), server_default=None)
        batch_op.drop_column("category")
        batch_op.drop_column("content")
        batch_op.create_index("ux_agent_memories_user_name", ["user_id", "name"], unique=True)


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("agent_memories", schema=None) as batch_op:
        batch_op.add_column(sa.Column("category", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("content", sa.String(), nullable=True))

    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, type, description FROM agent_memories")).all()
    for row in rows:
        conn.execute(
            sa.text(
                "UPDATE agent_memories SET category = :category, content = :content WHERE id = :id"
            ),
            {
                "id": row.id,
                "category": _CATEGORIES.get(row.type, "context"),
                "content": row.description[:200],
            },
        )

    with op.batch_alter_table("agent_memories", schema=None) as batch_op:
        batch_op.drop_index("ux_agent_memories_user_name")
        batch_op.alter_column("category", existing_type=sa.String(), nullable=False)
        batch_op.alter_column("content", existing_type=sa.String(), nullable=False)
        batch_op.drop_column("body")
        batch_op.drop_column("description")
        batch_op.drop_column("type")
        batch_op.drop_column("name")
