from semestra.core.capability import Http, capability
from semestra.core.context import Ctx
from semestra.modules.plugins_builtin.sticky_note import service
from semestra.modules.plugins_builtin.sticky_note.schemas import (
    PLUGIN_ID,
    Note,
    NoteList,
    NoteListInput,
    NoteUpdateInput,
)

TAGS = ("sticky",)


@capability(
    name="sticky.note.list",
    summary="List the sticky notes on a Program, term or course board.",
    description="""Use to find a note before reading or changing it ("what is in my note for this
course"). Returns each note's instance_id and Markdown text.""",
    effect="read",
    http=Http("GET", "/sticky/notes"),
    tags=TAGS,
    plugin_id=PLUGIN_ID,
)
async def note_list(ctx: Ctx, inp: NoteListInput) -> NoteList:
    return await service.list_notes(ctx, inp.scope_type, inp.scope_id)


@capability(
    name="sticky.note.update",
    summary="Replace the text of a sticky note.",
    description="""Use when the user asks to jot something down in a note ("note the midterm scope
in this course's sticky"). It replaces the whole text, so call sticky.note.list first and send
the old text with the new lines added. At most 10 000 characters.""",
    effect="write",
    http=Http("PUT", "/sticky/notes/{instance_id}"),
    tags=TAGS,
    plugin_id=PLUGIN_ID,
)
async def note_update(ctx: Ctx, inp: NoteUpdateInput) -> Note:
    return await service.update_note(ctx, inp.instance_id, inp.content)
