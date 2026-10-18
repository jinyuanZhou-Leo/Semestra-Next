from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field

PluginId = Annotated[str, Field(min_length=1, max_length=64, pattern=r"^[a-z][a-z0-9-]*$")]


class PluginProvides(BaseModel):
    pages: list[str] = Field(description="Page ids the plugin adds to scope tab bars")
    cards: list[str] = Field(description="Card ids the plugin adds to boards")
    capabilities: list[str] = Field(description="Capability names gated by the plugin")


class PluginOut(BaseModel):
    id: str
    kind: Literal["core", "plugin"] = Field(description="core modules cannot be uninstalled")
    name_key: str = Field(description="Frontend message key of the name")
    description_key: str = Field(description="Frontend message key of the description")
    summary: str = Field(description="One English sentence on what the plugin does")
    version: str
    author: str
    default_installed: bool
    installed: bool = Field(description="Always true for core modules")
    installed_at: datetime | None
    provides: PluginProvides


class PluginCatalog(BaseModel):
    items: list[PluginOut]


class PluginRef(BaseModel):
    plugin_id: PluginId = Field(description="Plugin id, e.g. 'pomodoro'")


class UninstallInput(BaseModel):
    plugin_id: PluginId = Field(description="Plugin id, e.g. 'pomodoro'")
    purge_data: bool = Field(
        default=False,
        description="Also delete the plugin's data (cards, settings, records); cannot be undone",
    )
