from typing import Annotated, Literal

from pydantic import BaseModel, Field

PLUGIN_ID = "sticky-note"
CARD_IDS = ("sticky.note",)
# The same limit as the card's zod schema.
MAX_CONTENT = 10_000

InstanceId = Annotated[str, Field(min_length=1, max_length=64)]


class NoteListInput(BaseModel):
    scope_type: Literal["program", "term", "course", "today"] = Field(
        description="Kind of board the note sits on; 'today' is the Program's Today page"
    )
    scope_id: InstanceId = Field(description="Id of that Program, term or course")


class NoteUpdateInput(BaseModel):
    instance_id: InstanceId = Field(description="Sticky note card instance id")
    content: Annotated[str, Field(max_length=MAX_CONTENT)] = Field(
        description="Markdown text: the lines to add, or the whole new note with mode replace"
    )
    mode: Literal["append", "replace"] = Field(
        default="append",
        description="append adds the text on a new line after the note; replace overwrites it",
    )


class Note(BaseModel):
    instance_id: str
    content: str
    color: str | None = None


class NoteList(BaseModel):
    items: list[Note]
