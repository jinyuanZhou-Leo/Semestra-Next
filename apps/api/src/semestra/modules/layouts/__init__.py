"""M10 布局: page order per scope type, card boards per scope, default layouts, card settings.

For modules keeping data per card instance (M14): `get_card_instance`, `list_card_instances`,
the `layouts.card.deleted` event, and `register_card_settings` for settings rules a JSON Schema
cannot express.
"""

from fastapi import FastAPI

from semestra.core.capability import registry
from semestra.modules.layouts import capabilities, models, portability, subscribers  # noqa: F401
from semestra.modules.layouts.service import (
    CardInstance,
    get_card_instance,
    list_card_instances,
    register_card_settings,
)

__all__ = [
    "CardInstance",
    "get_card_instance",
    "list_card_instances",
    "register",
    "register_card_settings",
]


def register(app: FastAPI) -> None:
    del app
    registry.set_id_source("instance_id", "layouts.card.list")
