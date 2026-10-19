"""M13 export/import adapter: which plugins are installed (a preference)."""

from semestra.modules.plugins.models import PluginsDefaultOffer, PluginsInstallation
from semestra.modules.portability import Table, table_adapter

ADAPTER = table_adapter(
    module="plugins",
    schema_version=1,
    tables=(
        Table(
            PluginsInstallation,
            "installations",
            id_column=None,
            preferences=True,
            upsert_on=("plugin_id",),
        ),
        Table(
            PluginsDefaultOffer,
            "default_offers",
            id_column=None,
            preferences=True,
            upsert_on=("plugin_id",),
        ),
    ),
)
