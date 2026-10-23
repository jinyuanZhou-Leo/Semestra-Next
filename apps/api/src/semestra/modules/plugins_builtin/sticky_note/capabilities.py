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
    summary="List the sticky notes on a Program, term, course or Today board.",
    description="""Use to read the notes of one board ("what is in my note for this course").
Returns each note's instance_id and Markdown text. To find a note without knowing its board use
layouts.card.list.""",
    effect="read",
    http=Http("GET", "/sticky/notes"),
    tags=TAGS,
    plugin_id=PLUGIN_ID,
)
async def note_list(ctx: Ctx, inp: NoteListInput) -> NoteList:
    return await service.list_notes(ctx, inp.scope_type, inp.scope_id)


@capability(
    name="sticky.note.update",
    summary="Add to or replace the text of a sticky note.",
    description="""Use when the user asks to jot something down in a note ("note the midterm scope
in this course's sticky"): by default (mode append) the lines go after the note's text, so the
same call made twice adds them twice. To rewrite or delete text, read the note first and send the
whole new text with mode replace. At most 10 000 characters.""",
    effect="write",
    http=Http("PUT", "/sticky/notes/{instance_id}"),
    tags=TAGS,
    check=service.check_update,
    record=("instance_id", service.note_record),
    plugin_id=PLUGIN_ID,
)
async def note_update(ctx: Ctx, inp: NoteUpdateInput) -> Note:
    return await service.update_note(ctx, inp.instance_id, inp.content, inp.mode)
