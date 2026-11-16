"""M13: device connections and their per-task CalDAV state belong to this server (passwords,
names a device chose), so they are removed with the account but not exported."""

from semestra.modules.caldav.models import CaldavConnection, CaldavItem
from semestra.modules.portability import Table, table_adapter

ADAPTER = table_adapter(
    module="caldav",
    schema_version=1,
    depends_on=("academics", "tasks"),
    tables=(
        Table(CaldavConnection, "connections", exported=False),
        Table(CaldavItem, "items", exported=False),
    ),
)
