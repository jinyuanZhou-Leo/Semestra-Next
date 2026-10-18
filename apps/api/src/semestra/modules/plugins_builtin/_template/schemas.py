from typing import Annotated, Literal

from pydantic import BaseModel, Field

PLUGIN_ID = "hello-note"
CARD_IDS = ("hello.note",)
MAX_NOTE = 2000

InstanceId = Annotated[str, Field(min_length=1, max_length=64)]


class HelloNoteSettings(BaseModel):
    """Plugin configuration (M11): every field has a default and a description. The form on the
    settings page is generated from this model; its texts are the messages
    `settings_plugin_hello_note_<field>_label|_description|_option_<value>`."""

    greeting: Literal["formal", "casual"] = Field(default="casual", description="Greeting tone")
    show_count: bool = Field(default=True, description="Show the number of lines on the card")


class NoteGetInput(BaseModel):
    instance_id: InstanceId = Field(description="Hello note card instance id")


class NoteAppendInput(BaseModel):
    instance_id: InstanceId = Field(description="Hello note card instance id")
    line: Annotated[str, Field(min_length=1, max_length=200)] = Field(
        description="One line to add at the end of the note"
    )


class Note(BaseModel):
    instance_id: str
    text: str
    lines: int
