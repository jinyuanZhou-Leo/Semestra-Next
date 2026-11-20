"""Backups made by older versions (M13 §3.1): each module's payload is brought up to the
adapter's current schema version, one step at a time, then reshaped by the steps of the
migrations made since the backup (`register_reshape`), before it is previewed or imported.

Like a migration of the module's tables, a step only rewrites data; the adapter then imports the
result as if this version had exported it. A schema step that needs another module's rows (tasks
reading assessments) asks `payload(other)`, which is upgraded first and converted once per
import. The reshape steps run migration by migration, every module's step of a migration seeing
the other payloads as they were before it, as a migration reads the tables it changes.
"""

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from packaging.version import InvalidVersion, Version

from semestra.modules.portability.archive import Manifest
from semestra.modules.portability.registry import get_adapter, reshapes

# The last migration of each release, for backups made before manifests named it
# (`Manifest.db_revision`). Releases before 2.1.0 (2.0.0, its betas, and 1.x backups once their
# schema steps have run) read as 2.0.0's.
RELEASE_REVISIONS = (
    (Version("2.0.0"), "0051"),
    (Version("2.1.0"), "0059"),
    (Version("2.2.0"), "0060"),
    (Version("2.3.0"), "0063"),
)


def revision_of(manifest: Manifest) -> str:
    """The migration the backup's database was at when it was made."""
    if manifest.db_revision is not None:
        return manifest.db_revision
    try:
        made_by = Version(manifest.app_version)
    except InvalidVersion:
        made_by = RELEASE_REVISIONS[0][0]
    found = RELEASE_REVISIONS[0][1]
    for release, revision in RELEASE_REVISIONS:
        if made_by >= release:
            found = revision
    return found


@dataclass
class _Before:
    """What a reshape step sees: the payloads as they were before its migration."""

    payloads: Mapping[str, dict[str, Any] | None]
    now: datetime
    preferences: bool

    def payload(self, module: str) -> dict[str, Any] | None:
        return self.payloads.get(module)


class Payloads:
    """The archive's payloads in the current shape (implements `OlderArchive` for the schema
    steps)."""

    def __init__(
        self,
        read: Callable[[str], dict[str, Any] | None],
        manifest: Manifest,
        now: datetime,
        *,
        preferences: bool = True,
    ) -> None:
        self._read = read
        self._versions = manifest.modules
        self._revision = int(revision_of(manifest))
        self.now = now
        self.preferences = preferences
        self._done: dict[str, dict[str, Any] | None] = {}
        self._converting: set[str] = set()
        self._current: dict[str, dict[str, Any] | None] | None = None

    def payload(self, module: str) -> dict[str, Any] | None:
        """`data/<module>.json` as this version exports it; None when the archive has none.
        Raises `portability.unsupported_version` for a version no step leads up from."""
        if self._current is None:
            self._current = self._reshaped()
        if module not in self._current:
            self._current[module] = self._upgraded(module)
        return self._current[module]

    def _reshaped(self) -> dict[str, dict[str, Any] | None]:
        current = {module: self._upgraded(module) for module in self._versions}
        for revision, steps in sorted(reshapes().items()):
            if int(revision) <= self._revision:
                continue
            before = _Before(dict(current), self.now, self.preferences)
            for module, step in steps.items():
                if (data := before.payload(module)) is not None:
                    current[module] = step(data, before)
        return current

    def _upgraded(self, module: str) -> dict[str, Any] | None:
        """The payload at its module's current schema version, before any reshape step."""
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
                    data = {
                        **adapter.upgrades[step](data, _Upgrading(self)),
                        "schema_version": step + 1,
                    }
            finally:
                self._converting.discard(module)
        self._done[module] = data
        return data


class _Upgrading:
    """What a schema step sees: the other payloads at their current schema versions."""

    def __init__(self, payloads: Payloads) -> None:
        self._payloads = payloads
        self.now = payloads.now
        self.preferences = payloads.preferences

    def payload(self, module: str) -> dict[str, Any] | None:
        return self._payloads._upgraded(module)  # pyright: ignore[reportPrivateUsage]
