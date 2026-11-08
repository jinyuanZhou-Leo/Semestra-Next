"""agent: conversation scopes stop at the term (M12 §6.1)

Conversations started on a course page before scopes stopped at the term named the course
(`agent_sessions.scope.course_id`). They now work in that course's term (the latest one for a
year-long course, unless the scope already named a term), and the key goes.

Revision ID: 0039
Revises: 0038
Create Date: 2026-11-08 18:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0039"
down_revision: str | Sequence[str] | None = "0038"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE agent_sessions SET scope = json_set(
            scope, '$.term_id', (
                SELECT ct.term_id FROM academics_course_terms ct
                JOIN academics_terms t ON t.id = ct.term_id
                WHERE ct.course_id = json_extract(agent_sessions.scope, '$.course_id')
                ORDER BY t.start_date DESC LIMIT 1
            )
        )
        WHERE json_extract(scope, '$.course_id') IS NOT NULL
          AND json_extract(scope, '$.term_id') IS NULL
        """
    )
    op.execute(
        """
        UPDATE agent_sessions SET scope = json_remove(scope, '$.course_id')
        WHERE scope IS NOT NULL AND json_type(scope, '$.course_id') IS NOT NULL
        """
    )


def downgrade() -> None:
    pass  # the course is not needed back: a term scope works in every version
