"""Plugin catalog and installation capabilities (M10 §4)."""

from semestra.core.capability import Http, NoInput, capability
from semestra.core.context import Ctx
from semestra.modules.plugins import service
from semestra.modules.plugins.schemas import PluginCatalog, PluginOut, PluginRef, UninstallInput

TAGS = ("plugins",)


@capability(
    name="plugins.catalog.list",
    summary="List the app's modules and plugins, and which plugins the user has installed.",
    description="""Use to check whether a plugin (e.g. pomodoro, habit tracker, sticky notes) is
installed before suggesting its cards, or to tell the user what plugins exist. Core modules are
always installed.""",
    effect="read",
    http=Http("GET", "/plugins/catalog"),
    tags=TAGS,
)
async def catalog_list(ctx: Ctx, inp: NoInput) -> PluginCatalog:
    return await service.list_catalog(ctx)


@capability(
    name="plugins.install",
    summary="Install a plugin for the user's account.",
    description="Installing an already installed plugin does nothing.",
    effect="write",
    http=Http("PUT", "/plugins/{plugin_id}/installation"),
    expose=("http",),
    tags=TAGS,
)
async def install(ctx: Ctx, inp: PluginRef) -> PluginOut:
    return await service.install(ctx, inp.plugin_id)


@capability(
    name="plugins.uninstall",
    summary="Uninstall a plugin; optionally delete its data.",
    description="""Hides the plugin's pages, cards and features. Without purge_data its data is
kept and comes back on reinstall.""",
    effect="destructive",
    http=Http("DELETE", "/plugins/{plugin_id}/installation"),
    expose=("http",),
    tags=TAGS,
)
async def uninstall(ctx: Ctx, inp: UninstallInput) -> PluginOut:
    return await service.uninstall(ctx, inp)
