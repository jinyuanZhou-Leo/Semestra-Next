from typing import Annotated, Literal

from pydantic import BaseModel, Field


class EchoInput(BaseModel):
    text: Annotated[str, Field(min_length=1, max_length=200)] = Field(
        description="Text to send back."
    )


class Echo(BaseModel):
    text: str
    length: int


class CountdownInput(BaseModel):
    steps: Annotated[int, Field(ge=1, le=20)] = Field(
        default=3, description="How many progress steps the job reports."
    )


class CountdownResult(BaseModel):
    steps_done: int


class TemplateSettings(BaseModel):
    """Module configuration (M11): every field has a default and a description."""

    compact: bool = Field(default=False, description="Use a compact layout")
    greeting: Literal["formal", "casual"] = Field(default="casual", description="Greeting tone")
    countdown_steps: Annotated[int, Field(ge=1, le=20)] = Field(
        default=3, description="Default number of steps of the countdown"
    )
