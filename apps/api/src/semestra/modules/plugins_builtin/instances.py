"""How the built-in plugins find the card instance a request is about (M10 §2, M14 §0).

Cards are user-created instances stored by M10 (`layouts_card_settings`); a plugin's own data
refers to them by `instance_id`. The plugins only need to know which card an instance is, where
it sits (to find the Program and its time zone) and its settings, so this is the one place that
reads M10.
"""

from dataclasses import dataclass
from typing import Any

from semestra.core.context import Ctx
from semestra.core.errors import AppError, not_found
from semestra.modules.academics import service as academics
from semestra.modules.academics.models import AcademicsProgram


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
    from semestra.modules.layouts import service as layouts

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
