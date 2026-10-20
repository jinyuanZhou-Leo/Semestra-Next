from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules.plugins_builtin import instances
from semestra.modules.plugins_builtin.sticky_note.schemas import (
    CARD_IDS,
    MAX_CONTENT,
    Note,
    NoteList,
    NoteUpdateInput,
)


def _note(instance: instances.CardInstance) -> Note:
    content = instance.settings.get("content")
    color = instance.settings.get("color")
    return Note(
        instance_id=instance.instance_id,
        content=content if isinstance(content, str) else "",
        color=color if isinstance(color, str) else None,
    )


async def list_notes(ctx: Ctx, scope_type: str, scope_id: str) -> NoteList:
    found = await instances.list_card_instances(
        ctx, card_id=CARD_IDS[0], scope_type=scope_type, scope_id=scope_id
    )
    return NoteList(items=[_note(i) for i in found])


async def _new_content(ctx: Ctx, instance_id: str, content: str, mode: str) -> str:
    current = _note(await instances.get_card_instance(ctx, instance_id, card_ids=CARD_IDS))
    if mode == "append" and current.content:
        content = f"{current.content.rstrip(chr(10))}\n{content}"
    if len(content) > MAX_CONTENT:
        raise AppError("common.validation", 422, errors=[{"loc": ["content"], "code": "too_long"}])
    return content


async def check_update(ctx: Ctx, inp: NoteUpdateInput) -> None:
    """An append that would make the note too long is refused before the agent's card."""
    await _new_content(ctx, inp.instance_id, inp.content, inp.mode)


async def update_note(ctx: Ctx, instance_id: str, content: str, mode: str) -> Note:
    content = await _new_content(ctx, instance_id, content, mode)
    await instances.update_card_settings(ctx, instance_id, {"content": content})
    instance = await instances.get_card_instance(ctx, instance_id, card_ids=CARD_IDS)
    return _note(instance)
