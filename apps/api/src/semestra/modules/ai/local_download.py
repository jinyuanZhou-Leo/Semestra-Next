"""Downloading local models (M06): shared by local OCR and local embedding.

A download runs in a thread into a staging directory next to its destination, so a stopped
download leaves nothing half done, and everyone waiting for the same model shares it. Progress is
the size of the staging directory against the total the fetcher found out (when it could).
"""

import contextlib
import os
import shutil
import tempfile
import threading
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path

import anyio

# A staging directory this old was left by a server that stopped mid-download; a younger one may
# belong to another process downloading the same model (the CLI next to the server).
STALE_STAGING_SECONDS = 3600

type Progress = Callable[[int, int | None], Awaitable[None]]


@dataclass
class Download:
    """A download in progress. The fetcher sets `total` (bytes) once it knows it."""

    staging: Path
    total: int | None = None
    finished: threading.Event = field(default_factory=threading.Event)
    error: BaseException | None = None

    def received(self) -> int:
        size = 0
        for root, _, files in os.walk(self.staging):
            for name in files:
                with contextlib.suppress(OSError):
                    size += os.path.getsize(os.path.join(root, name))
        return size


_DOWNLOADS: dict[str, Download] = {}
_LOCK = threading.Lock()


def _run(key: str, state: Download, fetch: Callable[[Download], None]) -> None:
    try:
        fetch(state)
    except BaseException as exc:  # handed to whoever waits
        state.error = exc
    finally:
        shutil.rmtree(state.staging, ignore_errors=True)
        with _LOCK:
            _DOWNLOADS.pop(key, None)
        state.finished.set()


def _start(key: str, parent: Path, fetch: Callable[[Download], None]) -> Download:
    """The download of `key` in progress, started now if there is none."""
    with _LOCK:
        state = _DOWNLOADS.get(key)
        if state is None:
            parent.mkdir(parents=True, exist_ok=True)
            prefix = "." + "".join(c if c.isalnum() or c in "-_." else "_" for c in key) + "-"
            cutoff = time.time() - STALE_STAGING_SECONDS
            for stale in parent.glob(f"{prefix}*"):
                with contextlib.suppress(OSError):
                    if stale.stat().st_mtime < cutoff:
                        shutil.rmtree(stale, ignore_errors=True)
            # On the same file system as the destination, so finished files move in one rename.
            staging = Path(tempfile.mkdtemp(prefix=prefix, dir=parent))
            state = _DOWNLOADS[key] = Download(staging)
            threading.Thread(target=_run, args=(key, state, fetch), daemon=True).start()
        return state


async def ensure(
    key: str,
    *,
    parent: Path,
    present: Callable[[], bool],
    fetch: Callable[[Download], None],
    progress: Progress | None = None,
    poll_seconds: float = 0.5,
) -> None:
    """Runs `fetch(state)` (blocking, in a thread) unless `present()`, reporting
    `progress(bytes_received, total_bytes)` meanwhile. `fetch` downloads into `state.staging`
    (made under `parent`) and moves the finished files into place itself. Callers with the same
    `key` share one download, which carries on if a caller stops waiting (a cancelled job), so
    the bytes are not wasted."""
    if present():
        return
    state = _start(key, parent, fetch)
    while not state.finished.is_set():
        if progress is not None:
            await progress(await anyio.to_thread.run_sync(state.received), state.total)
        await anyio.sleep(poll_seconds)
    if state.error is not None:
        raise state.error
    if not present():
        raise RuntimeError(f"{key} is still missing after its download")
    if progress is not None and state.total is not None:
        await progress(state.total, state.total)


def downloading(prefix: str) -> list[str]:
    """Keys starting with `prefix` that this process is downloading now, without the prefix."""
    with _LOCK:
        return [k.removeprefix(prefix) for k in _DOWNLOADS if k.startswith(prefix)]
