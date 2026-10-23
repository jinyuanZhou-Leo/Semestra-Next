"""Built-in backup for self-hosted installs: SQLite snapshots plus a mirror of stored files.

Enabled by `SEMESTRA_BACKUP_DIR`; `semestra backup` runs one backup on demand. Snapshots use
SQLite's online backup API, so they are consistent while the server is writing.
"""

import asyncio
import shutil
import sqlite3
import time
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path

import structlog
from sqlalchemy.engine import make_url

from semestra.core.config import Settings

log = structlog.get_logger()

BACKUP_INTERVAL_SECONDS = 24 * 3600
_DB_SUBDIR = "db"
_STORAGE_SUBDIR = "storage"
_REMOVED_SUBDIR = "storage-removed"


def _snapshot(src: Path, dest: Path) -> None:
    tmp = dest.with_name(dest.name + ".partial")
    with closing(sqlite3.connect(src)) as source, closing(sqlite3.connect(tmp)) as target:
        source.backup(target)
    tmp.replace(dest)


def _sqlite_sources(settings: Settings) -> dict[str, Path]:
    sources: dict[str, Path] = {}
    url = make_url(settings.database_url)
    if url.get_backend_name() == "sqlite" and url.database not in (None, "", ":memory:"):
        sources["semestra"] = Path(url.database)
    sources["agent_checkpoints"] = settings.data_dir / "agent_checkpoints.sqlite"
    return {name: path for name, path in sources.items() if path.is_file()}


def _mirror_storage(src: Path, dest: Path, removed: Path, stamp: str, oldest: str) -> None:
    """Copy new or changed files. A file no longer in `src` (a deleted account's, say) moves to
    `removed/<stamp>/` and stays while a database snapshot older than its removal (`oldest` is
    the oldest snapshot's stamp) may still refer to it; then it is gone from the backup too."""
    present: set[Path] = set()
    if src.is_dir():
        for file in src.rglob("*"):
            if not file.is_file():
                continue
            relative = file.relative_to(src)
            present.add(relative)
            target = dest / relative
            stat = file.stat()
            if target.is_file():
                existing = target.stat()
                if existing.st_size == stat.st_size and int(existing.st_mtime) == int(
                    stat.st_mtime
                ):
                    continue
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(file, target)
    if dest.is_dir():
        for file in sorted(dest.rglob("*"), reverse=True):  # children before their folders
            relative = file.relative_to(dest)
            if file.is_file() and relative not in present:
                target = removed / stamp / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                file.replace(target)
            elif file.is_dir() and not any(file.iterdir()):
                file.rmdir()
    if removed.is_dir():
        for old in removed.iterdir():
            if old.name <= oldest:
                shutil.rmtree(old)


def run_backup(
    settings: Settings, dest: Path | None = None, *, include_storage: bool = True
) -> list[Path]:
    """Take one backup into `dest` (default `SEMESTRA_BACKUP_DIR`); returns the new snapshots."""
    root = dest or Path(settings.backup_dir)
    db_dir = root / _DB_SUBDIR
    db_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    created: list[Path] = []
    for name, src in _sqlite_sources(settings).items():
        target = db_dir / f"{name}-{stamp}.sqlite"
        _snapshot(src, target)
        created.append(target)
        for old in sorted(db_dir.glob(f"{name}-*.sqlite"))[: -max(settings.backup_keep, 1)]:
            old.unlink()
    if include_storage:
        _mirror_storage(
            settings.storage_local_root,
            root / _STORAGE_SUBDIR,
            root / _REMOVED_SUBDIR,
            stamp,
            min((p.stem.rsplit("-", 1)[1] for p in db_dir.glob("*.sqlite")), default=stamp),
        )
    return created


def seconds_until_due(settings: Settings, now: float | None = None) -> float:
    """Time until the next daily backup, so a restart does not trigger an extra one."""
    snapshots = list((Path(settings.backup_dir) / _DB_SUBDIR).glob("*.sqlite"))
    if not snapshots:
        return 0
    newest = max(p.stat().st_mtime for p in snapshots)
    return max(0.0, newest + BACKUP_INTERVAL_SECONDS - (now if now is not None else time.time()))


async def backup_loop(settings: Settings) -> None:
    while True:
        await asyncio.sleep(seconds_until_due(settings))
        try:
            created = await asyncio.to_thread(run_backup, settings)
            log.info("backup.done", files=[p.name for p in created])
        except Exception:
            log.exception("backup.failed")
            await asyncio.sleep(3600)  # retry in an hour instead of hot-looping
        else:
            await asyncio.sleep(1)  # snapshot mtimes now say "just done"
