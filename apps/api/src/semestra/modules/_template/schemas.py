from typing import Annotated

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
