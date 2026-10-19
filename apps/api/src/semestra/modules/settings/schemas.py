from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, JsonValue

from semestra.modules.settings.registry import ScopeType

Locale = Literal["en", "zh-CN"]
Theme = Literal["system", "light", "dark"]
Accent = Literal["neutral", "blue", "violet", "green", "orange", "rose", "teal", "amber"]
TimeFormat = Literal["auto", "12h", "24h"]
ReduceMotion = Literal["system", "on", "off"]
# 0 follows the locale (Monday for zh-CN, Sunday for en); 1 = Monday; 7 = Sunday.
WeekStart = Literal[0, 1, 7]
Level = ScopeType

UI_STATE_KEY_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9._-]*$"
UI_STATE_KEY_MAX = 128
UI_STATE_VALUE_MAX_BYTES = 16 * 1024
UiStateKey = Annotated[
    str, Field(min_length=1, max_length=UI_STATE_KEY_MAX, pattern=UI_STATE_KEY_PATTERN)
]


class Preferences(BaseModel):
    locale: Locale | None = Field(description="Interface language; null follows the browser")
    theme: Theme = Field(description="Light, dark, or follow the system")
    accent: Accent = Field(description="Accent color of buttons and highlights")
    time_format: TimeFormat = Field(description="12-hour or 24-hour clock; auto follows locale")
    week_start: WeekStart = Field(description="First day of the week; 0 follows the language")
    reduce_motion: ReduceMotion = Field(description="Reduce animations; system follows the OS")
    active_program_id: str | None = Field(description="The Program currently being viewed")
    updated_at: datetime | None = Field(description="Null until the first change")


class PreferencesUpdateInput(BaseModel):
    """Only fields that are sent change; `locale` and `active_program_id` accept null."""

    locale: Locale | None = Field(default=None, description="Interface language, or null")
    theme: Theme | None = Field(default=None, description="Light, dark, or follow the system")
    accent: Accent | None = Field(default=None, description="Accent color")
    time_format: TimeFormat | None = Field(default=None, description="12-hour or 24-hour clock")
    week_start: WeekStart | None = Field(default=None, description="First day of the week")
    reduce_motion: ReduceMotion | None = Field(default=None, description="Reduce animations")
    active_program_id: Annotated[str, Field(min_length=1, max_length=64)] | None = Field(
        default=None, description="The Program currently being viewed, or null"
    )


Source = Literal["default", "account", "program", "term", "course"]


class InheritedValue(BaseModel):
    value: Any = Field(description="The value the field would have without this level's own one")
    source: Source = Field(description="Where that value comes from")


class ResolvedSettings(BaseModel):
    namespace: str
    scope_type: Level
    scope_id: str | None
    values: dict[str, Any] = Field(description="Effective value of every field")
    sources: dict[str, Source] = Field(description="Where each effective value comes from")
    inherited: dict[str, InheritedValue] = Field(
        description="What every field resolves to from the levels above, ignoring this level's "
        "own values: what 'follow' shows and what a reset brings back"
    )


class ValuesGetInput(BaseModel):
    namespace: str = Field(description="Settings namespace, e.g. 'calendar' or 'plugin.pomodoro'")
    scope_type: Level = Field(default="account", description="Scope level to resolve for")
    scope_id: str | None = Field(default=None, description="Id of the scope; omit for 'account'")


class ValuesUpdateInput(BaseModel):
    namespace: str = Field(description="Settings namespace")
    scope_type: Level = Field(default="account", description="Level to write the values at")
    scope_id: str | None = Field(default=None, description="Id of the scope; omit for 'account'")
    values: dict[str, JsonValue] = Field(
        min_length=1, description="Fields to set at this level; other levels are not touched"
    )


class ValuesResetInput(BaseModel):
    namespace: str = Field(description="Settings namespace")
    key: str = Field(description="Field to restore to the value inherited from the level above")
    scope_type: Level = Field(default="account", description="Level to remove the value from")
    scope_id: str | None = Field(default=None, description="Id of the scope; omit for 'account'")


class SettingsSchemaOut(BaseModel):
    namespace: str
    levels: list[Level] = Field(description="Levels where values may be set")
    plugin_id: str | None
    json_schema: dict[str, Any] = Field(description="JSON Schema of the namespace's fields")


class SettingsSchemaList(BaseModel):
    items: list[SettingsSchemaOut]


class UiStateGetManyInput(BaseModel):
    keys: list[UiStateKey] = Field(
        default_factory=list, max_length=200, description="Exact keys to read"
    )
    prefixes: list[UiStateKey] = Field(
        default_factory=list,
        max_length=20,
        description="Read every key that starts with one of these, e.g. 'layout.'",
    )


class UiStateItems(BaseModel):
    items: dict[str, JsonValue] = Field(description="Existing keys and their values")


class UiStateSetInput(BaseModel):
    key: UiStateKey = Field(description="'<module>.<what>[.<scopeId>]', at most 128 characters")
    value: JsonValue = Field(description="Any JSON value up to 16 KB")


class UiStateEntry(BaseModel):
    key: str
    value: JsonValue
