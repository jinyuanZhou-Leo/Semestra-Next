"""How the built-in plugins find the card instance a request is about (M10 §2, M14 §0).

Cards are user-created instances stored by M10 (`layouts_card_settings`); a plugin's own data
refers to them by `instance_id`. The plugins only need to know which card an instance is, where
it sits (to find the Program and its time zone) and its settings, so this is the one place that
reads M10.
"""

from typing import Any, cast

from semestra.core.context import Ctx
from semestra.core.errors import AppError, not_found
from semestra.modules.academics import service as academics
from semestra.modules.academics.models import AcademicsProgram
from semestra.modules.layouts import CardInstance
from semestra.modules.layouts import service as layouts
from semestra.modules.layouts.schemas import CardSettingsUpdateInput


async def get_card_instance(
    ctx: Ctx, instance_id: str, *, card_ids: tuple[str, ...]
) -> CardInstance:
    """The user's card instance, which must be one of `card_ids`; `common.not_found` otherwise."""
    found = await layouts.get_card_instance(ctx, instance_id)
    if found.card_id not in card_ids:
        raise not_found()
    return found


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
    """The user's stored instances of `card_id` on one board."""
    return await layouts.list_card_instances(ctx, card_id, scope_type, scope_id)


async def update_card_settings(ctx: Ctx, instance_id: str, patch: dict[str, Any]) -> None:
    """Merge `patch` into the card's settings; M10 validates the result with the card's schema."""
    current = await layouts.get_card_instance(ctx, instance_id)
    await layouts.update_card_settings(
        ctx,
        CardSettingsUpdateInput(
            instance_id=instance_id,
            settings=cast(Any, {**current.settings, **patch}),
        ),
    )
