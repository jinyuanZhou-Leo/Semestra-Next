"""The `grading` settings namespace (M03, M11): how a Program's grade pages count."""

from pydantic import BaseModel, Field


class GradingSettings(BaseModel):
    count_in_progress: bool = Field(
        default=False,
        description="Term grades count unfinished courses at their current average",
    )
