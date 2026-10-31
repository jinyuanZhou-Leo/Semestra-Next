"""M13 export/import adapter: tab bars, default layouts, boards and card instances.

Tab bars and default layouts are preferences; boards and card instances (which hold card
content such as sticky notes) go with the Program, term or course they are on.
"""

from typing import Any

from semestra.core.context import Ctx
from semestra.modules.layouts.models import (
    LayoutsBoard,
    LayoutsCardSetting,
    LayoutsNav,
    LayoutsTemplate,
)
from semestra.modules.portability import ImportOptions, Table, table_adapter

# Cards that were replaced by another card: id -> (new id, sizes the new card lacks -> size).
# Backups made before the change still name the old card (migration 0028 did the same).
RENAMED_CARDS: dict[str, tuple[str, dict[str, str]]] = {
    "habit.board": ("habit.ring", {"xl": "l"}),
}


def _renamed(card: Any) -> Any:
    if not isinstance(card, dict) or card.get("card_id") not in RENAMED_CARDS:  # pyright: ignore[reportUnknownMemberType]
        return card
    new, sizes = RENAMED_CARDS[card["card_id"]]  # pyright: ignore[reportUnknownArgumentType]
    size = card.get("size")  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
    return {
        **card,
        "card_id": new,
        "size": sizes.get(size, size) if isinstance(size, str) else size,
    }  # pyright: ignore[reportUnknownArgumentType]


async def _rename_in_list(_ctx: Ctx, row: dict[str, Any], _opts: ImportOptions) -> dict[str, Any]:
    cards = row.get("cards")
    return {**row, "cards": [_renamed(c) for c in cards]} if isinstance(cards, list) else row  # pyright: ignore[reportUnknownVariableType]


async def _rename_instance(_ctx: Ctx, row: dict[str, Any], _opts: ImportOptions) -> dict[str, Any]:
    old = row.get("card_id")
    return {**row, "card_id": RENAMED_CARDS[old][0]} if old in RENAMED_CARDS else row


ADAPTER = table_adapter(
    module="layouts",
    schema_version=1,
    depends_on=("academics",),
    tables=(
        Table(LayoutsNav, "nav", id_column=None, preferences=True, upsert_on=("scope_type",)),
        Table(
            LayoutsTemplate,
            "templates",
            id_column=None,
            preferences=True,
            upsert_on=("scope_type",),
            transform=_rename_in_list,
        ),
        # Card instances first: the boards' card lists refer to their ids.
        Table(
            LayoutsCardSetting,
            "card_settings",
            id_column="instance_id",
            refs={"scope_id": "required"},
            transform=_rename_instance,
        ),
        Table(LayoutsBoard, "boards", refs={"scope_id": "required"}, transform=_rename_in_list),
    ),
)
