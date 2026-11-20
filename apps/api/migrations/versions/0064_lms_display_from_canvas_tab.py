"""settings: the Canvas tab's display setting becomes `lms.display`

In 2.0 how platform HTML is shown was the Canvas tab plugin's account setting
(`plugin.canvas-tab`, `display`); since 2.1 it is the LMS module's (`lms`, `display`). A choice
made before moves over, unless one was made in `lms` since; the old rows go.

Revision ID: 0064
Revises: 0063
Create Date: 2026-11-20 19:00:00

"""

import json
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0064"
down_revision: str | Sequence[str] | None = "0063"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _load(raw: object) -> dict[str, object]:
    return json.loads(raw) if isinstance(raw, str) else dict(raw or {})  # type: ignore[arg-type]


def upgrade() -> None:
    conn = op.get_bind()
    old = conn.execute(
        sa.text(
            "SELECT id, user_id, data FROM settings_values"
            " WHERE namespace = 'plugin.canvas-tab' AND scope_type = 'account'"
        )
    ).all()
    for row_id, user_id, raw in old:
        display = _load(raw).get("display")
        own = conn.execute(
            sa.text(
                "SELECT id, data FROM settings_values WHERE user_id = :u AND namespace = 'lms'"
                " AND scope_type = 'account' AND scope_id = ''"
            ),
            {"u": user_id},
        ).first()
        if display is not None and own is None:
            conn.execute(
                sa.text("UPDATE settings_values SET namespace = 'lms', data = :d WHERE id = :id"),
                {"d": json.dumps({"display": display}), "id": row_id},
            )
            continue
        if display is not None and own is not None and "display" not in (data := _load(own[1])):
            conn.execute(
                sa.text("UPDATE settings_values SET data = :d WHERE id = :id"),
                {"d": json.dumps({**data, "display": display}), "id": own[0]},
            )
    op.execute("DELETE FROM settings_values WHERE namespace = 'plugin.canvas-tab'")


def downgrade() -> None:
    pass  # `lms.display` is harmless to the older code: nothing to undo
