from typing import Annotated, Literal

from pydantic import BaseModel, Field

PLUGIN_ID = "sticky-note"
CARD_IDS = ("sticky.note",)
# The same limit as the card's zod schema.
MAX_CONTENT = 10_000

InstanceId = Annotated[str, Field(min_length=1, max_length=64)]


class NoteListInput(BaseModel):
    scope_type: Literal["program", "term", "course"] = Field(
        description="Kind of board the note sits on"
    )
    scope_id: InstanceId = Field(description="Id of that Program, term or course")


class NoteUpdateInput(BaseModel):
    instance_id: InstanceId = Field(description="Sticky note card instance id")
    content: Annotated[str, Field(max_length=MAX_CONTENT)] = Field(
        description="The new Markdown text of the note; replaces the old text"
    )


class Note(BaseModel):
    instance_id: str
    content: str
    color: str | None = None


class NoteList(BaseModel):
    items: list[Note]
