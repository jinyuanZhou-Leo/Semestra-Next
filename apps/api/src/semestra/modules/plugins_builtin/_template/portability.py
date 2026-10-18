"""Export/import adapter (M13 §3). The hello note keeps its text in the card settings, which
M10's adapter already carries, so this plugin has no rows of its own and the adapter is empty.

A plugin with tables exports and imports its rows here; see `plugins_builtin/portability.py`
for a complete example (habit check-ins, pomodoro sessions), including `id_map` use and a
purge that deletes every row of the user.
"""

from collections.abc import Mapping
from typing import Any, Protocol

from semestra.core.context import Ctx

SCHEMA_VERSION = 1


class Writer(Protocol):
    def write_json(self, obj: Any) -> None: ...


async def export(ctx: Ctx, writer: Writer) -> None:
    del ctx
    writer.write_json({"schema_version": SCHEMA_VERSION})


async def import_(
    ctx: Ctx, payload: dict[str, Any], id_map: Mapping[str, str], options: Any = None
) -> dict[str, int]:
    del ctx, payload, id_map, options
    return {}


async def preview(payload: dict[str, Any]) -> dict[str, int]:
    del payload
    return {}


async def purge(ctx: Ctx) -> None:
    del ctx


ADAPTER = {
    "module": "hello_note",
    "schema_version": SCHEMA_VERSION,
    "depends_on": ("layouts",),
    "export": export,
    "import_": import_,
    "preview": preview,
    "purge": purge,
}
