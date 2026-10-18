from semestra.core.context import Ctx
from semestra.modules.plugins_builtin import instances
from semestra.modules.plugins_builtin.sticky_note.schemas import CARD_IDS, Note, NoteList


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


async def update_note(ctx: Ctx, instance_id: str, content: str) -> Note:
    await instances.get_card_instance(ctx, instance_id, card_ids=CARD_IDS)
    await instances.update_card_settings(ctx, instance_id, {"content": content})
    instance = await instances.get_card_instance(ctx, instance_id, card_ids=CARD_IDS)
    return _note(instance)
