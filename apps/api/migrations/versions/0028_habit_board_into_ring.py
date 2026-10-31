"""habit plugin: the calendar card becomes the ring card's larger sizes

The habit calendar (`habit.board`) was a second place to check in; it is now the history shown by
the ring card (`habit.ring`) at M and L. Check-ins and settings belong to the card instance, so
renaming the card keeps them; XL, which the ring card does not have, becomes L.

Revision ID: 0028
Revises: 0027
Create Date: 2026-10-31 19:00:00.000000

"""

import json
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0028"
down_revision: str | Sequence[str] | None = "0027"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD, NEW = "habit.board", "habit.ring"


def _cards(value: object) -> list[dict[str, object]] | None:
    cards = json.loads(value) if isinstance(value, str) else value
    return cards if isinstance(cards, list) else None


def _rename(cards: list[dict[str, object]]) -> bool:
    changed = False
    for card in cards:
        if isinstance(card, dict) and card.get("card_id") == OLD:
            card["card_id"] = NEW
            if card.get("size") == "xl":
                card["size"] = "l"
            changed = True
    return changed


def _rewrite(table: sa.TableClause, keys: list[str]) -> None:
    conn = op.get_bind()
    key_columns = [table.c[k] for k in keys]
    rows = conn.execute(
        sa.select(*key_columns, table.c.cards).where(table.c.cards.like(f"%{OLD}%"))
    ).all()
    for row in rows:
        cards = _cards(row[-1])
        if cards is None or not _rename(cards):
            continue
        conn.execute(
            table.update()
            .where(*(c == row[i] for i, c in enumerate(key_columns)))
            .values(cards=json.dumps(cards))
        )


def upgrade() -> None:
    boards = sa.table("layouts_boards", sa.column("id"), sa.column("cards"))
    templates = sa.table(
        "layouts_templates", sa.column("user_id"), sa.column("scope_type"), sa.column("cards")
    )
    _rewrite(boards, ["id"])
    _rewrite(templates, ["user_id", "scope_type"])
    op.execute(
        sa.text("UPDATE layouts_card_settings SET card_id = :new WHERE card_id = :old").bindparams(
            new=NEW, old=OLD
        )
    )


def downgrade() -> None:
    # Which ring cards were calendars is not kept; they stay ring cards.
    pass
