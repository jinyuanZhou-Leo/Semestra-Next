"""Business logic. Capabilities stay thin and call into here.

The note lives in the card's settings (M10), so this plugin needs no table. A plugin that keeps
its own rows (like habit-streak) adds `models.py`, a migration and an `layouts.card.deleted`
subscriber that deletes a card's rows.
"""

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules.plugins_builtin import instances
from semestra.modules.plugins_builtin._template.schemas import CARD_IDS, MAX_NOTE, Note


def _note(instance: instances.CardInstance) -> Note:
    text = instance.settings.get("text")
    text = text if isinstance(text, str) else ""
    return Note(instance_id=instance.instance_id, text=text, lines=len(text.splitlines()))


async def get_note(ctx: Ctx, instance_id: str) -> Note:
    return _note(await instances.get_card_instance(ctx, instance_id, card_ids=CARD_IDS))


async def append_line(ctx: Ctx, instance_id: str, line: str) -> Note:
    current = await get_note(ctx, instance_id)
    text = f"{current.text}\n{line}" if current.text else line
    if len(text) > MAX_NOTE:
        # Domain errors are `<module>.<reason>`; the frontend maps the code to a message
        # (`error_hello_note_too_long`) and `params` fill its placeholders.
        raise AppError("hello_note.too_long", 400, limit=MAX_NOTE)
    await instances.update_card_settings(ctx, instance_id, {"text": text})
    return await get_note(ctx, instance_id)
