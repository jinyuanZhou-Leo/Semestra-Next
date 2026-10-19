"""M10 插件: the plugin catalog and per-account installation.

Backend packages of plugins call `register_plugin(PluginInfo(...))`; capabilities declared with
`plugin_id=` are then refused (`plugins.not_installed`) and hidden from agents for users who
have not installed the plugin.
"""

from fastapi import FastAPI

from semestra.core.capability import registry
from semestra.modules.plugins import capabilities, models, portability  # noqa: F401  (registers on import)
from semestra.modules.plugins.catalog import PluginInfo, register_plugin
from semestra.modules.plugins.service import installed_ids, is_installed, require_installed

__all__ = ["PluginInfo", "is_installed", "register", "register_plugin", "require_installed"]


def register(app: FastAPI) -> None:
    del app
    registry.set_plugin_gate(installed_ids)
