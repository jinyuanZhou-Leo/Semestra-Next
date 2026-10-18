"""How the built-in plugins find the card instance a request is about (M10 §2, M14 §0).

Cards are user-created instances stored by M10 (`layouts_card_settings`); a plugin's own data
refers to them by `instance_id`. The plugins only need to know which card an instance is, where
it sits (to find the Program and its time zone) and its settings, so this is the one place that
reads M10.
"""

import importlib
from dataclasses import dataclass
from typing import Any

from semestra.core.context import Ctx
from semestra.core.errors import AppError, not_found
from semestra.modules.academics import service as academics
from semestra.modules.academics.models import AcademicsProgram


def _layouts() -> Any:
    """M10's service. Until M10 is merged there are no card instances at all, so every lookup is
    "not found". TODO(M10): replace with `from semestra.modules.layouts import ...` and drop
    the `Any`."""
    try:
        return importlib.import_module("semestra.modules.layouts.service")
    except ModuleNotFoundError:
        raise not_found() from None


@dataclass(frozen=True)
class CardInstance:
    instance_id: str
    card_id: str
    scope_type: str  # 'program' | 'term' | 'course' | 'today'
    scope_id: str
    settings: dict[str, Any]


async def get_card_instance(
    ctx: Ctx, instance_id: str, *, card_ids: tuple[str, ...]
) -> CardInstance:
    """The user's card instance, which must be one of `card_ids`; `common.not_found` otherwise."""
    layouts = _layouts()
    found = await layouts.get_card_instance(ctx, instance_id)
    if found is None or found.card_id not in card_ids:
        raise not_found()
    return CardInstance(
        found.instance_id, found.card_id, found.scope_type, found.scope_id, dict(found.settings)
    )


async def instance_program(ctx: Ctx, instance: CardInstance) -> AcademicsProgram:
    """The Program a card sits in (its board's scope, or that scope's parent)."""
    if instance.scope_type in ("program", "today"):
        return await academics.get_program_row(ctx, instance.scope_id)
    if instance.scope_type == "term":
        return await academics.get_program_row(
            ctx, (await academics.get_term_row(ctx, instance.scope_id)).program_id
        )
    if instance.scope_type == "course":
        return await academics.get_program_row(
            ctx, (await academics.get_course_row(ctx, instance.scope_id)).program_id
        )
    raise AppError("common.not_found", 404)


async def list_card_instances(
    ctx: Ctx, *, card_id: str, scope_type: str, scope_id: str
) -> list[CardInstance]:
    """The user's instances of `card_id` on one board (the scope's own cards only)."""
    layouts = _layouts()
    found = await layouts.list_card_instances(
        ctx, card_id=card_id, scope_type=scope_type, scope_id=scope_id
    )
    return [
        CardInstance(f.instance_id, f.card_id, f.scope_type, f.scope_id, dict(f.settings))
        for f in found
    ]


async def update_card_settings(ctx: Ctx, instance_id: str, patch: dict[str, Any]) -> None:
    """Merge `patch` into the card's settings, validated by the card's schema (M10)."""
    layouts = _layouts()
    await layouts.update_card_settings(ctx, instance_id, patch)
