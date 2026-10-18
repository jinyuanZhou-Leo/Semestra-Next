from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import AfterValidator, BaseModel, Field

from semestra.modules.layouts.service import register_card_settings

CARD_ID = "clock.world"
MAX_ZONES = 3


def _zone(value: str) -> str:
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError, OSError) as exc:
        raise ValueError("unknown time zone") from exc
    return value


class WorldClockSettings(BaseModel):
    """Settings of a world clock card; the same fields and defaults as the card's zod schema."""

    zones: list[Annotated[str, Field(min_length=1, max_length=64), AfterValidator(_zone)]] = Field(
        default_factory=list, max_length=MAX_ZONES
    )
    show_seconds: bool = False
    show_offset: bool = True
    label: Annotated[str, Field(max_length=60)] | None = None


register_card_settings(CARD_ID, WorldClockSettings)
