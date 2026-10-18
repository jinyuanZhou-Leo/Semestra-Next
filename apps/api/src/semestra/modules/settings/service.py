"""Preferences, scoped configuration values and UI state (M11)."""

import json
from typing import Any, cast

from pydantic import BaseModel, JsonValue, ValidationError
from sqlalchemy import delete, or_, select

from semestra.core.capability import registry
from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.core.events import events
from semestra.modules.auth.service import set_locale_cache
from semestra.modules.settings.models import SettingsPreferences, SettingsUiState, SettingsValue
from semestra.modules.settings.registry import (
    LEVELS,
    ScopeChain,
    ScopeType,
    SettingsDef,
    resolve_scope,
    settings_registry,
)
from semestra.modules.settings.schemas import (
    UI_STATE_VALUE_MAX_BYTES,
    Preferences,
    PreferencesUpdateInput,
    ResolvedSettings,
    SettingsSchemaList,
    SettingsSchemaOut,
    UiStateItems,
)

# --- preferences ----------------------------------------------------------------------------

_NULLABLE_PREFERENCES = {"locale", "active_program_id"}
_DEFAULTS: dict[str, Any] = {
    "locale": None,
    "theme": "system",
    "accent": "blue",
    "time_format": "auto",
    "week_start": 0,
    "reduce_motion": "system",
    "active_program_id": None,
}


def _preferences_out(row: SettingsPreferences | None) -> Preferences:
    if row is None:
        return Preferences(**_DEFAULTS, updated_at=None)
    return Preferences.model_validate(row, from_attributes=True)


async def get_preferences(ctx: Ctx) -> Preferences:
    return _preferences_out(await ctx.db.get(SettingsPreferences, ctx.user_id))


async def update_preferences(ctx: Ctx, inp: PreferencesUpdateInput) -> Preferences:
    sent = inp.model_fields_set
    bad = sorted(f for f in sent if getattr(inp, f) is None and f not in _NULLABLE_PREFERENCES)
    if bad:
        raise AppError(
            "settings.invalid_value",
            422,
            errors=[{"loc": [f], "code": "none_not_allowed"} for f in bad],
        )
    row = await ctx.db.get(SettingsPreferences, ctx.user_id)
    current = _preferences_out(row)
    changed = sorted(f for f in sent if getattr(current, f) != getattr(inp, f))
    if not changed:
        return current
    if row is None:
        row = SettingsPreferences(user_id=ctx.user_id, **_DEFAULTS)
        ctx.db.add(row)
    for field in changed:
        setattr(row, field, getattr(inp, field))
    row.updated_at = ctx.now
    if "locale" in changed:
        set_locale_cache(ctx, row.locale)
    await ctx.db.flush()
    await events.publish(ctx, "settings.preferences.updated", {"fields": changed})
    return _preferences_out(row)


# --- scoped values --------------------------------------------------------------------------


def _check_level(definition: SettingsDef, level: ScopeType) -> None:
    if level not in definition.levels:
        raise AppError(
            "settings.level_not_allowed", 422, namespace=definition.namespace, level=level
        )


def _scope_id_for_storage(level: ScopeType, chain_id: str | None) -> str:
    return "" if level == "account" else (chain_id or "")


async def _layer_rows(
    ctx: Ctx, definition: SettingsDef, chain: ScopeChain
) -> list[tuple[ScopeType, SettingsValue | None]]:
    """Rows of the levels that apply to the chain, lowest priority first."""
    layers: list[tuple[ScopeType, str]] = []
    for level in LEVELS:
        scope_id = chain.id_for(level)
        if level in definition.levels and scope_id is not None:
            layers.append((level, scope_id))
    if not layers:
        return []
    rows = (
        await ctx.db.scalars(
            select(SettingsValue).where(
                SettingsValue.user_id == ctx.user_id,
                SettingsValue.namespace == definition.namespace,
                or_(
                    *[
                        (SettingsValue.scope_type == level) & (SettingsValue.scope_id == scope_id)
                        for level, scope_id in layers
                    ]
                ),
            )
        )
    ).all()
    by_scope = {(r.scope_type, r.scope_id): r for r in rows}
    return [(level, by_scope.get((level, scope_id))) for level, scope_id in layers]


def _effective(
    definition: SettingsDef, layers: list[tuple[ScopeType, SettingsValue | None]]
) -> tuple[dict[str, Any], dict[str, str]]:
    """Merge the explicit keys level by level, then complete with the schema defaults.

    Stored data can outlive its schema (a field removed or tightened in an update); such keys
    fall back to the default instead of breaking every page that reads the namespace.
    """
    fields = definition.schema.model_fields
    explicit: dict[str, Any] = {}
    sources: dict[str, str] = {}
    for level, row in layers:
        for key, value in (row.data if row else {}).items():
            if key in fields:
                explicit[key] = value
                sources[key] = level
    model = _validate_dropping_invalid(definition.schema, explicit, sources)
    values = model.model_dump(mode="json")
    return values, {key: sources.get(key, "default") for key in values}


def _validate_dropping_invalid(
    schema: type[BaseModel], explicit: dict[str, Any], sources: dict[str, str]
) -> BaseModel:
    try:
        return schema.model_validate(explicit)
    except ValidationError as exc:
        for error in exc.errors():
            key = str(error["loc"][0]) if error["loc"] else ""
            explicit.pop(key, None)
            sources.pop(key, None)
        try:
            return schema.model_validate(explicit)
        except ValidationError:  # a cross-field rule that no dropped key explains
            sources.clear()
            return schema.model_validate({})


async def _resolved(
    ctx: Ctx,
    definition: SettingsDef,
    chain: ScopeChain,
    scope_type: ScopeType,
    scope_id: str | None,
) -> ResolvedSettings:
    values, sources = _effective(definition, await _layer_rows(ctx, definition, chain))
    return ResolvedSettings(
        namespace=definition.namespace,
        scope_type=scope_type,
        scope_id=None if scope_type == "account" else scope_id,
        values=values,
        sources=cast("dict[str, Any]", sources),
    )


async def get_values(
    ctx: Ctx, namespace: str, scope_type: ScopeType, scope_id: str | None
) -> ResolvedSettings:
    definition = settings_registry.get(namespace)
    await registry.require_plugin(ctx, definition.plugin_id)
    chain = await resolve_scope(ctx, scope_type, scope_id)
    return await _resolved(ctx, definition, chain, scope_type, scope_id)


async def _own_row(
    ctx: Ctx, namespace: str, scope_type: ScopeType, stored_scope_id: str
) -> SettingsValue | None:
    return await ctx.db.scalar(
        select(SettingsValue).where(
            SettingsValue.user_id == ctx.user_id,
            SettingsValue.namespace == namespace,
            SettingsValue.scope_type == scope_type,
            SettingsValue.scope_id == stored_scope_id,
        )
    )


async def update_values(
    ctx: Ctx,
    namespace: str,
    scope_type: ScopeType,
    scope_id: str | None,
    values: dict[str, JsonValue],
) -> ResolvedSettings:
    definition = settings_registry.get(namespace)
    await registry.require_plugin(ctx, definition.plugin_id)
    _check_level(definition, scope_type)
    chain = await resolve_scope(ctx, scope_type, scope_id)
    unknown = sorted(set(values) - set(definition.schema.model_fields))
    if unknown:
        raise AppError(
            "settings.invalid_value",
            422,
            errors=[{"loc": [key], "code": "extra_forbidden"} for key in unknown],
        )
    # Validate the result the user would end up with (what they inherit plus this change), so a
    # rule across fields, such as start before end, sees the inherited values and not defaults.
    effective, _ = _effective(definition, await _layer_rows(ctx, definition, chain))
    try:
        validated = definition.schema.model_validate({**effective, **values})
    except ValidationError as exc:
        errors = [{"loc": list(e["loc"]), "code": e["type"]} for e in exc.errors()]
        raise AppError("settings.invalid_value", 422, errors=errors) from exc
    # Store the validated (coerced) form of exactly the keys that were sent.
    clean = validated.model_dump(mode="json", include=set(values))
    stored_id = _scope_id_for_storage(scope_type, chain.id_for(scope_type))
    row = await _own_row(ctx, namespace, scope_type, stored_id)
    if row is None:
        ctx.db.add(
            SettingsValue(
                user_id=ctx.user_id,
                namespace=namespace,
                scope_type=scope_type,
                scope_id=stored_id,
                data=clean,
            )
        )
    else:
        row.data = {**row.data, **clean}
    await ctx.db.flush()
    await _publish_values_updated(ctx, namespace, scope_type, stored_id)
    return await _resolved(ctx, definition, chain, scope_type, scope_id)


async def reset_value(
    ctx: Ctx, namespace: str, key: str, scope_type: ScopeType, scope_id: str | None
) -> ResolvedSettings:
    definition = settings_registry.get(namespace)
    await registry.require_plugin(ctx, definition.plugin_id)
    _check_level(definition, scope_type)
    if key not in definition.schema.model_fields:
        raise AppError(
            "settings.invalid_value", 422, errors=[{"loc": [key], "code": "extra_forbidden"}]
        )
    chain = await resolve_scope(ctx, scope_type, scope_id)
    stored_id = _scope_id_for_storage(scope_type, chain.id_for(scope_type))
    row = await _own_row(ctx, namespace, scope_type, stored_id)
    if row is not None and key in row.data:
        remaining = {k: v for k, v in row.data.items() if k != key}
        if remaining:
            row.data = remaining
        else:
            await ctx.db.delete(row)
        await ctx.db.flush()
        await _publish_values_updated(ctx, namespace, scope_type, stored_id)
    return await _resolved(ctx, definition, chain, scope_type, scope_id)


async def _publish_values_updated(
    ctx: Ctx, namespace: str, scope_type: ScopeType, stored_id: str
) -> None:
    await events.publish(
        ctx,
        "settings.values.updated",
        {"namespace": namespace, "scope": {"type": scope_type, "id": stored_id or None}},
    )


def list_schemas() -> SettingsSchemaList:
    return SettingsSchemaList(
        items=[
            SettingsSchemaOut(
                namespace=d.namespace,
                levels=list(d.levels),
                plugin_id=d.plugin_id,
                json_schema=d.schema.model_json_schema(),
            )
            for d in settings_registry.list()
        ]
    )


# --- cleanup (event subscribers and tests) ---------------------------------------------------


async def purge_scope(ctx: Ctx, user_id: str, scope_type: ScopeType, scope_id: str) -> None:
    """Remove every value stored for a scope that no longer exists."""
    await ctx.db.execute(
        delete(SettingsValue).where(
            SettingsValue.user_id == user_id,
            SettingsValue.scope_type == scope_type,
            SettingsValue.scope_id == scope_id,
        )
    )


async def purge_plugin(ctx: Ctx, user_id: str, plugin_id: str) -> None:
    """Remove the configuration of an uninstalled plugin (`plugins.purge`)."""
    namespace = f"plugin.{plugin_id}"
    await ctx.db.execute(
        delete(SettingsValue).where(
            SettingsValue.user_id == user_id,
            or_(
                SettingsValue.namespace == namespace,
                SettingsValue.namespace.startswith(f"{namespace}.", autoescape=True),
            ),
        )
    )


async def forget_active_program(ctx: Ctx, user_id: str, program_id: str) -> None:
    row = await ctx.db.get(SettingsPreferences, user_id)
    if row is not None and row.active_program_id == program_id:
        row.active_program_id = None
        row.updated_at = ctx.now


# --- UI state -------------------------------------------------------------------------------


async def get_ui_state(ctx: Ctx, keys: list[str], prefixes: list[str]) -> UiStateItems:
    if not keys and not prefixes:
        return UiStateItems(items={})
    conditions = [SettingsUiState.key.in_(keys)] if keys else []
    conditions += [SettingsUiState.key.startswith(p, autoescape=True) for p in prefixes]
    rows = (
        await ctx.db.scalars(
            select(SettingsUiState).where(SettingsUiState.user_id == ctx.user_id, or_(*conditions))
        )
    ).all()
    return UiStateItems(items={r.key: r.value for r in rows})


async def set_ui_state(ctx: Ctx, key: str, value: JsonValue) -> None:
    if len(json.dumps(value, separators=(",", ":")).encode()) > UI_STATE_VALUE_MAX_BYTES:
        raise AppError("settings.ui_state_too_large", 413, key=key)
    row = await ctx.db.get(SettingsUiState, (ctx.user_id, key))
    if row is None:
        ctx.db.add(SettingsUiState(user_id=ctx.user_id, key=key, value=value))
    else:
        row.value = value
        row.updated_at = ctx.now
    await ctx.db.flush()
