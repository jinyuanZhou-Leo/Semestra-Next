from semestra.core.capability import Http, capability
from semestra.core.context import Ctx
from semestra.modules.plugins_builtin._template import service
from semestra.modules.plugins_builtin._template.schemas import (
    PLUGIN_ID,
    Note,
    NoteAppendInput,
    NoteGetInput,
)

TAGS = ("hello-note",)


# The description is what the AI agent reads to decide when to call the tool: say when to use it,
# how to find the inputs and what not to use it for. `plugin_id` makes the framework refuse the
# call (and hide the tool from the agent) while the user has not installed the plugin.
@capability(
    name="hello.note.get",
    summary="Read the text of a hello note card.",
    description="""Use to see what a hello note says. Find the instance_id with layouts.board.get
(the hello note card of the course, term or Program board).""",
    effect="read",
    http=Http("GET", "/hello/notes/{instance_id}"),
    tags=TAGS,
    plugin_id=PLUGIN_ID,
)
async def note_get(ctx: Ctx, inp: NoteGetInput) -> Note:
    return await service.get_note(ctx, inp.instance_id)


@capability(
    name="hello.note.append",
    summary="Add one line to the end of a hello note card.",
    description="""Use when the user asks to jot something down in a hello note. Adds one line; it
never removes text. Refused once the note would pass 2000 characters.""",
    effect="write",
    http=Http("POST", "/hello/notes/{instance_id}/lines"),
    tags=TAGS,
    plugin_id=PLUGIN_ID,
)
async def note_append(ctx: Ctx, inp: NoteAppendInput) -> Note:
    return await service.append_line(ctx, inp.instance_id, inp.line)
