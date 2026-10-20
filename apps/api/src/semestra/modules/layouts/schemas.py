from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, JsonValue

BoardScopeType = Literal["program", "term", "course", "today"]
NavScopeType = Literal["program", "term", "course"]
CardSize = Literal["s", "m", "l", "xl"]

Id = Annotated[str, Field(min_length=1, max_length=200)]
CardId = Annotated[str, Field(min_length=1, max_length=100)]
Coord = Annotated[int, Field(ge=0, le=1000)]

MAX_CARDS = 60
SETTINGS_MAX_BYTES = 64 * 1024


class BoardCard(BaseModel):
    instance_id: str = Field(description="Card instance id; pass it to card capabilities")
    card_id: str = Field(description="Which card, e.g. 'sticky.note'")
    size: CardSize = Field(description="s=1x1, m=2x1, l=2x2, xl=4x2 on a 4-column grid")
    x: int = Field(description="Column, 0-3")
    y: int = Field(description="Row, from 0")
    settings: dict[str, Any] = Field(description="The card's settings as stored")


class Board(BaseModel):
    scope_type: BoardScopeType
    scope_id: str
    cards: list[BoardCard]
    customized: bool = Field(description="False while the board still follows the template")
    updated_at: datetime | None


class CardInstanceListInput(BaseModel):
    program_id: Id = Field(description="Program id; every board of it is searched")
    card_id: CardId | None = Field(
        default=None, description="Only this card, e.g. 'sticky.note' or 'habit.calendar'"
    )


class CardInstanceSummary(BaseModel):
    instance_id: str = Field(description="Pass it to the card's own tools")
    card_id: str
    scope_type: BoardScopeType
    scope_id: str
    board_name: str = Field(description="The Program, term or course the board belongs to")
    label: str | None = Field(
        description="What the user named it: a habit's name, a note's first line"
    )


class CardInstanceList(BaseModel):
    items: list[CardInstanceSummary]


class BoardRef(BaseModel):
    scope_type: BoardScopeType = Field(
        description="program, term or course overview; 'today' is the Program's Today page"
    )
    scope_id: Id = Field(description="Program, term or course id; for 'today' the Program id")


class BoardCardInput(BaseModel):
    instance_id: Id | None = Field(
        default=None, description="Existing instance; null adds a new card"
    )
    card_id: CardId = Field(description="Card id")
    size: CardSize = Field(description="Card size")
    x: Coord = Field(description="Column, 0-3")
    y: Coord = Field(description="Row")
    settings: dict[str, JsonValue] | None = Field(
        default=None, description="Settings of a new card (ignored for existing ones)"
    )


class BoardUpdateInput(BaseModel):
    scope_type: BoardScopeType = Field(description="Board scope type")
    scope_id: Id = Field(description="Board scope id")
    cards: list[BoardCardInput] = Field(
        max_length=MAX_CARDS, description="The whole layout; cards left out are deleted"
    )


class CardAddInput(BaseModel):
    scope_type: BoardScopeType = Field(
        description="program, term or course overview; 'today' is the Program's Today page"
    )
    scope_id: Id = Field(description="Program, term or course id; for 'today' the Program id")
    card_id: CardId = Field(description="Card to add, e.g. 'sticky.note' or 'pomodoro.timer'")
    size: CardSize | None = Field(default=None, description="Size; default is the card's own")
    settings: dict[str, JsonValue] | None = Field(default=None, description="Initial settings")


class CardRef(BaseModel):
    instance_id: Id = Field(description="Card instance id")


class CardSettings(BaseModel):
    instance_id: str
    card_id: str
    settings: dict[str, Any]


class CardSettingsUpdateInput(BaseModel):
    instance_id: Id = Field(description="Card instance id")
    settings: dict[str, JsonValue] = Field(description="The card's whole settings object")


class Removed(BaseModel):
    instance_id: str


class Nav(BaseModel):
    scope_type: NavScopeType
    order: list[str] = Field(description="Page ids in tab order; pages not listed come last")
    hidden: list[str] = Field(description="Hidden page ids")


class NavRef(BaseModel):
    scope_type: NavScopeType = Field(description="Scope type whose tab bar to read")


PageIds = Annotated[
    list[Annotated[str, Field(min_length=1, max_length=100)]], Field(max_length=100)
]


class NavUpdateInput(BaseModel):
    scope_type: NavScopeType = Field(description="Scope type whose tab bar to change")
    order: PageIds = Field(description="Page ids in tab order")
    hidden: PageIds = Field(description="Page ids to hide")


class TemplateCard(BaseModel):
    card_id: str
    size: CardSize
    x: int
    y: int


class Template(BaseModel):
    scope_type: BoardScopeType
    cards: list[TemplateCard]
    customized: bool = Field(description="True when the user saved their own default layout")


class TemplateRef(BaseModel):
    scope_type: BoardScopeType = Field(description="Scope type of the default layout")


class TemplateFromBoardInput(BaseModel):
    scope_type: BoardScopeType = Field(description="Scope type of the board and template")
    scope_id: Id = Field(description="The board whose layout becomes the default")
