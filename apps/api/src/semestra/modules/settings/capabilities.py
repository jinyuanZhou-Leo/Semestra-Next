"""Settings capabilities (M11 §4)."""

from semestra.core.capability import Http, NoInput, capability
from semestra.core.context import Ctx
from semestra.modules.settings import service
from semestra.modules.settings.schemas import (
    Preferences,
    PreferencesUpdateInput,
    ResolvedSettings,
    SettingsSchemaList,
    UiStateEntry,
    UiStateGetManyInput,
    UiStateItems,
    UiStateSetInput,
    ValuesGetInput,
    ValuesResetInput,
    ValuesUpdateInput,
)

HTTP_ONLY = ("http",)


@capability(
    name="settings.preferences.get",
    summary="Get the user's personal preferences.",
    description="""Use when you need the user's language, clock format (12h/24h) or first day of
the week, for example to format a time or date in the way the user expects.
Do not use to read per-module settings such as the calendar default view;
use settings.values.get.""",
    effect="read",
    http=Http("GET", "/me/preferences"),
    tags=("settings",),
    agent_output_fields=("locale", "time_format", "week_start"),
)
async def preferences_get(ctx: Ctx, inp: NoInput) -> Preferences:
    return await service.get_preferences(ctx)


@capability(
    name="settings.preferences.update",
    summary="Change personal preferences (language, theme, accent, clock, week start).",
    description="Partial update: only the fields that are sent change. Not for agents.",
    effect="write",
    http=Http("PATCH", "/me/preferences"),
    expose=HTTP_ONLY,
    tags=("settings",),
)
async def preferences_update(ctx: Ctx, inp: PreferencesUpdateInput) -> Preferences:
    return await service.update_preferences(ctx, inp)


@capability(
    name="settings.schemas.list",
    summary="List every settings namespace with its fields.",
    description="""Use before changing a module setting to find the namespace, the field names,
their allowed values and the levels (account, program, term, course) where they can be set.
Do not use to read current values; use settings.values.get.""",
    effect="read",
    http=Http("GET", "/settings/schemas"),
    tags=("settings",),
)
async def schemas_list(ctx: Ctx, inp: NoInput) -> SettingsSchemaList:
    return service.list_schemas()


@capability(
    name="settings.values.get",
    summary="Get the effective settings of a module or plugin at a scope.",
    description="""Use when the user asks how a module is configured, e.g. the default calendar
view. Returns the effective value of every field and the level it is inherited from
(default, account, program, term or course).
Do not use for personal preferences such as language or theme; use settings.preferences.get.""",
    effect="read",
    http=Http("GET", "/settings/{namespace}"),
    tags=("settings",),
)
async def values_get(ctx: Ctx, inp: ValuesGetInput) -> ResolvedSettings:
    return await service.get_values(ctx, inp.namespace, inp.scope_type, inp.scope_id)


@capability(
    name="settings.values.update",
    summary="Change settings of a module or plugin at one scope level.",
    description="""Use when the user wants to change a module setting, e.g. make the calendar
open in month view. Only the given fields are set at that level; deeper levels still override them.
Look up namespace and field names with settings.schemas.list first.
Do not use to change language, theme or other personal preferences.""",
    effect="write",
    http=Http("PATCH", "/settings/{namespace}"),
    tags=("settings",),
)
async def values_update(ctx: Ctx, inp: ValuesUpdateInput) -> ResolvedSettings:
    return await service.update_values(ctx, inp.namespace, inp.scope_type, inp.scope_id, inp.values)


@capability(
    name="settings.values.reset",
    summary="Remove one setting at a scope level so it is inherited again.",
    description="""Restores a field to the value of the level above (or the default).
Not available to agents.""",
    effect="write",
    http=Http("DELETE", "/settings/{namespace}/keys/{key}"),
    expose=HTTP_ONLY,
    tags=("settings",),
)
async def values_reset(ctx: Ctx, inp: ValuesResetInput) -> ResolvedSettings:
    return await service.reset_value(ctx, inp.namespace, inp.key, inp.scope_type, inp.scope_id)


@capability(
    name="settings.ui_state.get_many",
    summary="Read several UI state entries at once.",
    description="""Reads interface state (sort orders, collapsed panels) by key or key prefix.
Not available to agents.""",
    effect="read",
    http=Http("POST", "/me/ui-state:get"),
    expose=HTTP_ONLY,
    tags=("settings",),
)
async def ui_state_get_many(ctx: Ctx, inp: UiStateGetManyInput) -> UiStateItems:
    return await service.get_ui_state(ctx, inp.keys, inp.prefixes)


@capability(
    name="settings.ui_state.set",
    summary="Save one UI state entry.",
    description="Stores interface state under a key. Not available to agents.",
    effect="write",
    http=Http("PUT", "/me/ui-state/{key}"),
    expose=HTTP_ONLY,
    tags=("settings",),
)
async def ui_state_set(ctx: Ctx, inp: UiStateSetInput) -> UiStateEntry:
    await service.set_ui_state(ctx, inp.key, inp.value)
    return UiStateEntry(key=inp.key, value=inp.value)
