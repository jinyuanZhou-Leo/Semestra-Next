"""M13 adapter: import drafts are work in progress, not account data.

Sessions, their items and uploaded source files are neither exported nor replaced; they are only
purged with the account (uploads live under `users/<id>/imports/`, removed with the account's
storage).
"""

from semestra.modules.imports.models import ImportsItem, ImportsSession, ImportsUpload
from semestra.modules.portability import Table, table_adapter

ADAPTER = table_adapter(
    module="imports",
    schema_version=1,
    depends_on=("academics",),
    tables=(
        Table(ImportsSession, "sessions", exported=False),
        Table(ImportsItem, "items", exported=False),
        Table(ImportsUpload, "uploads", exported=False),
    ),
)
