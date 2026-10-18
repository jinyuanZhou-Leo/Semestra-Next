from typing import Annotated, Any, Self

from pydantic import (
    BaseModel,
    Field,
    SerializerFunctionWrapHandler,
    model_serializer,
    model_validator,
)

from semestra.modules.layouts.service import register_card_settings

CARD_ID = "counter.counter"


class CounterSettings(BaseModel):
    """Settings of a counter card; the same fields and defaults as the card's zod schema."""

    label: Annotated[str, Field(max_length=60)] = ""
    min: int = 0
    max: int = 10
    step: Annotated[int, Field(ge=1)] = 1
    initial: int = 0
    show_ring: bool = True
    # The current count; a card that was never used has none and shows `initial`.
    value: int | None = None

    @model_validator(mode="after")
    def _consistent(self) -> Self:
        if self.min >= self.max:
            raise ValueError("min must be below max")
        if not self.min <= self.initial <= self.max:
            raise ValueError("initial must be within the range")
        if self.value is not None and not self.min <= self.value <= self.max:
            raise ValueError("value must be within the range")
        return self

    @model_serializer(mode="wrap")
    def _without_empty_value(self, handler: SerializerFunctionWrapHandler) -> dict[str, Any]:
        data: dict[str, Any] = handler(self)
        if data.get("value") is None:
            data.pop("value", None)
        return data


register_card_settings(CARD_ID, CounterSettings)
