"""Backups made by older versions (M13 §3.1): each module's payload is brought up to the
adapter's current schema version, one step at a time, before it is previewed or imported.

Like a migration of the module's tables, a step only rewrites data; the adapter then imports the
result as if this version had exported it. A step that needs another module's rows (tasks reading
assessments) asks `payload(other)`, which is upgraded first and converted once per import.
"""

from collections.abc import Callable, Mapping
from datetime import datetime
from typing import Any

from semestra.modules.portability.registry import get_adapter


class Payloads:
    """The archive's payloads at the current schema versions (implements `OlderArchive`)."""

    def __init__(
        self,
        read: Callable[[str], dict[str, Any] | None],
        versions: Mapping[str, int],
        now: datetime,
    ) -> None:
        self._read = read
        self._versions = versions
        self.now = now
        self._done: dict[str, dict[str, Any] | None] = {}
        self._converting: set[str] = set()

    def payload(self, module: str) -> dict[str, Any] | None:
        """`data/<module>.json`, upgraded; None when the archive has none. Raises
        `portability.unsupported_version` for a version no step leads up from."""
        if module in self._done:
            return self._done[module]
        if module in self._converting:
            raise ValueError(f"upgrade steps read each other's payloads in a cycle ({module})")
        data = self._read(module)
        adapter = get_adapter(module)
        if data is not None and adapter is not None and module in self._versions:
            version = self._versions[module]
            adapter.check_version(version)
            self._converting.add(module)
            try:
                for step in range(version, adapter.schema_version):
                    data = {**adapter.upgrades[step](data, self), "schema_version": step + 1}
            finally:
                self._converting.discard(module)
        self._done[module] = data
        return data
