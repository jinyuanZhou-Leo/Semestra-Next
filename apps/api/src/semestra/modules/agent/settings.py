"""The `assistant` settings namespace (M12 §6.1, M11): how conversations with Sem look."""

from pydantic import BaseModel, Field


class AssistantSettings(BaseModel):
    show_reasoning: bool = Field(
        default=True,
        description="Show the model's thinking text in the collapsible thinking block",
    )
