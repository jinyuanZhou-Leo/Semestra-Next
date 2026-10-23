"""Installation of plugins per account (M10 §2, §4)."""

from sqlalchemy import delete, select
from sqlalchemy.dialects.sqlite import insert

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.core.events import events
from semestra.modules.plugins import catalog
from semestra.modules.plugins.models import PluginsDefaultOffer, PluginsInstallation
from semestra.modules.plugins.schemas import (
    PluginCatalog,
    PluginOut,
    PluginProvides,
    UninstallInput,
)


async def _seed_defaults(ctx: Ctx, user_id: str) -> None:
    """Install every `default_installed` plugin not offered to this user before."""
    defaults = {
        m.id for m in catalog.modules() if m.info.kind == "plugin" and m.info.default_installed
    }
    if not defaults:
        return
    offered = set(
        (
            await ctx.db.scalars(
                select(PluginsDefaultOffer.plugin_id).where(PluginsDefaultOffer.user_id == user_id)
            )
        ).all()
    )
    new = sorted(defaults - offered)
    if not new:
        return
    rows = [{"user_id": user_id, "plugin_id": pid} for pid in new]
    await ctx.db.execute(insert(PluginsDefaultOffer).values(rows).on_conflict_do_nothing())
    await ctx.db.execute(
        insert(PluginsInstallation)
        .values([{**row, "installed_at": ctx.now} for row in rows])
        .on_conflict_do_nothing()
    )


async def _installations(ctx: Ctx) -> dict[str, PluginsInstallation]:
    await _seed_defaults(ctx, ctx.user_id)
    rows = await ctx.db.scalars(
        select(PluginsInstallation).where(PluginsInstallation.user_id == ctx.user_id)
    )
    return {row.plugin_id: row for row in rows}


_CACHE_KEY = "plugins.installed_ids"


async def installed_ids(ctx: Ctx) -> set[str]:
    """Ids of the plugins the ctx user can use: installed plugins and every core module.
    Worked out once per request: the capability gate, plugin settings and boards all ask."""
    key = (_CACHE_KEY, ctx.user_id)
    cached = ctx.cache.get(key)
    if cached is None:
        installed = set(await _installations(ctx))
        cached = installed | {m.id for m in catalog.modules() if m.info.kind == "core"}
        ctx.cache[key] = cached
    return set(cached)


async def is_installed(ctx: Ctx, module_id: str) -> bool:
    return module_id in await installed_ids(ctx)


async def require_installed(ctx: Ctx, plugin_id: str) -> None:
    """Raises `plugins.not_installed` unless the user can use the plugin (M10 §3)."""
    if not await is_installed(ctx, plugin_id):
        raise AppError("plugins.not_installed", 403, plugin_id=plugin_id)


async def list_catalog(ctx: Ctx) -> PluginCatalog:
    installs = await _installations(ctx)
    items: list[PluginOut] = []
    for m in catalog.modules():
        info = m.info
        row = installs.get(m.id)
        items.append(
            PluginOut(
                id=m.id,
                kind=info.kind,
                name_key=info.name_key or catalog.message_key(m.id, "name"),
                description_key=info.description_key or catalog.message_key(m.id, "description"),
                summary=info.summary,
                version=info.version,
                author=info.author,
                default_installed=info.kind == "core" or info.default_installed,
                installed=info.kind == "core" or row is not None,
                installed_at=row.installed_at if row else None,
                provides=PluginProvides(
                    pages=[p.id for p in m.pages],
                    cards=[c.id for c in m.cards],
                    capabilities=m.capabilities,
                ),
            )
        )
    return PluginCatalog(items=items)


def _plugin(plugin_id: str) -> catalog.ModuleDef:
    found = catalog.module(plugin_id)
    if found is None:
        raise AppError("common.not_found", 404)
    if found.info.kind == "core":
        raise AppError("plugins.core_not_removable", 409, plugin_id=plugin_id)
    return found


async def _out(ctx: Ctx, plugin_id: str) -> PluginOut:
    return next(p for p in (await list_catalog(ctx)).items if p.id == plugin_id)


async def install(ctx: Ctx, plugin_id: str) -> PluginOut:
    _plugin(plugin_id)
    ctx.cache.pop((_CACHE_KEY, ctx.user_id), None)
    installs = await _installations(ctx)
    if plugin_id not in installs:
        await ctx.db.execute(
            insert(PluginsInstallation)
            .values(user_id=ctx.user_id, plugin_id=plugin_id, installed_at=ctx.now)
            .on_conflict_do_nothing()
        )
        await events.publish(ctx, "plugins.installed", {"plugin_id": plugin_id})
    return await _out(ctx, plugin_id)


async def uninstall(ctx: Ctx, inp: UninstallInput) -> PluginOut:
    """Hides the plugin's pages, cards and capabilities; its data stays unless purged, so a
    reinstall brings everything back. Purging runs `plugins.purge` in this transaction for every
    module that keeps data for the plugin (settings, card instances, the plugin's own tables), so
    a failing cleanup fails the whole uninstall instead of leaving half the data behind."""
    _plugin(inp.plugin_id)
    ctx.cache.pop((_CACHE_KEY, ctx.user_id), None)
    installs = await _installations(ctx)
    if inp.plugin_id in installs:
        await ctx.db.execute(
            delete(PluginsInstallation).where(
                PluginsInstallation.user_id == ctx.user_id,
                PluginsInstallation.plugin_id == inp.plugin_id,
            )
        )
        await events.publish(ctx, "plugins.uninstalled", {"plugin_id": inp.plugin_id})
    if inp.purge_data:
        data = {"plugin_id": inp.plugin_id}
        await events.publish_in_transaction(ctx, "plugins.purge", data)
        await events.publish(ctx, "plugins.purged", data)
    return await _out(ctx, inp.plugin_id)
