"""The process that runs local embedding models (M06 `local_embedding`); its loop is in
`semestra/embedding_worker.py`.

Embedding happens for every search query as well as for every new document, so the model stays
loaded in one long-lived process instead of a process per call: a query then takes milliseconds,
not the seconds a model takes to load. The process starts on first use, keeps up to
`local_embedding_max_loaded` models (users who picked different models take turns without
reloading), and exits after `local_embedding_idle_seconds` without a request. A crash or a call that
runs out of time ends it; the next call starts a fresh one. A model that fails to load or embed
fails only that call: the process, and the models other users have loaded, stay.

Requests are served one at a time; a search query waits at most for the batch in progress.
Among documents, batches for a model already loaded go before those that would load another, so
two users indexing with different models do not make the child reload at every batch.
"""

import multiprocessing
import os
import threading
import time
from collections import Counter
from collections.abc import Sequence
from multiprocessing.connection import Connection
from multiprocessing.process import BaseProcess
from pathlib import Path
from typing import Literal

import anyio
import anyio.to_thread
import structlog

from semestra import embedding_worker
from semestra.core.config import Settings
from semestra.core.errors import AppError

log = structlog.get_logger(__name__)

type Kind = Literal["query", "passage"]

# Seconds a model may take to load (from disk; downloads happen before), and per batch. The
# batch limit only catches a stuck child: Qwen3 in fp16 takes ~11 s a batch on an M3 and may be
# ten times slower on a small VPS, and a timeout kills the child (so the next batch reloads).
LOAD_SECONDS = 300
BATCH_SECONDS = 600


def threads(setting: int) -> int:
    return setting if setting > 0 else max(1, (os.cpu_count() or 2) // 2)


# --- in the API process -----------------------------------------------------------------------


class _ChildError(Exception):
    """The child answered with an error; it is still running, with `loaded` models."""

    def __init__(self, reason: str, loaded: list[str]) -> None:
        super().__init__(reason)
        self.loaded = loaded


class _Runtime:
    """The parent's handle on the child. Every method blocks: call them in a worker thread."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        # Search waits on a query; indexing a file can wait. A long file goes to the child in
        # batches, and a query waiting for the child goes before the file's next batch.
        self._turn = threading.Condition(self._lock)
        self._count = threading.Lock()
        self._queries = 0
        # Document batches waiting, by model folder; the folders loaded in the child, oldest
        # first (the child evicts the same way).
        self._waiting: Counter[str] = Counter()
        self._loaded: list[str] = []
        self._process: BaseProcess | None = None
        self._conn: Connection | None = None
        self._last_used = 0.0
        self._idle_seconds = 600.0
        self._reaper: threading.Thread | None = None

    def _start(self) -> Connection:
        if self._process is not None and self._process.is_alive() and self._conn is not None:
            return self._conn
        self._stop()
        ours, theirs = multiprocessing.Pipe()
        # Spawn: a clean interpreter, none of the API's threads or open connections.
        process = multiprocessing.get_context("spawn").Process(
            target=embedding_worker.serve, args=(theirs,), daemon=True, name="semestra-embedding"
        )
        process.start()
        theirs.close()
        self._process, self._conn = process, ours
        if self._reaper is None or not self._reaper.is_alive():
            self._reaper = threading.Thread(target=self._reap, daemon=True)
            self._reaper.start()
        return ours

    def _stop(self) -> None:
        if self._conn is not None:
            self._conn.close()
        if self._process is not None:
            if self._process.is_alive():
                self._process.kill()
            self._process.join(5)
        self._process = self._conn = None
        self._loaded = []

    def _reap(self) -> None:
        # Runs as long as the API does: one that ended with its process could miss the next one,
        # started while it was ending.
        while True:
            time.sleep(min(30.0, self._idle_seconds / 2))
            with self._lock:
                idle = time.monotonic() - self._last_used > self._idle_seconds
                if self._process is not None and idle:
                    log.info("local_embedding_idle_exit")
                    self._stop()

    def _ask(self, conn: Connection, message: tuple[object, ...], seconds: float) -> object:
        conn.send(message)
        if not conn.poll(seconds):
            raise TimeoutError
        match conn.recv():
            case ("ok", value):
                return value
            case ("error", str(reason), list(loaded)):
                raise _ChildError(reason, loaded)  # pyright: ignore[reportUnknownArgumentType]
            case other:
                raise OSError(f"unexpected answer {other!r}")

    def embed(
        self, folder: Path, settings: Settings, texts: list[str], kind: Kind
    ) -> list[list[float]]:
        size = embedding_worker.BATCH
        vectors: list[list[float]] = []
        for start in range(0, len(texts), size):
            vectors += self._embed_batch(folder, settings, texts[start : start + size], kind)
        return vectors

    def _embed_batch(
        self, folder: Path, settings: Settings, texts: list[str], kind: Kind
    ) -> list[list[float]]:
        query = kind == "query"
        name = str(folder)
        if query:
            with self._count:
                self._queries += 1
        with self._turn:
            if query:
                with self._count:
                    self._queries -= 1
            else:
                self._waiting[name] += 1
                try:
                    self._turn.wait_for(lambda: self._queries == 0 and self._my_turn(name))
                finally:
                    self._waiting[name] -= 1
            try:
                return self._ask_embed(folder, settings, texts, kind)
            finally:
                self._turn.notify_all()

    def _my_turn(self, name: str) -> bool:
        """A document batch for a model that is not loaded waits while batches for loaded ones
        do (holds `_lock`)."""
        return name in self._loaded or not any(self._waiting[f] for f in self._loaded)

    def _ask_embed(
        self, folder: Path, settings: Settings, texts: list[str], kind: Kind
    ) -> list[list[float]]:
        self._idle_seconds = settings.local_embedding_idle_seconds
        self._last_used = time.monotonic()
        try:
            conn = self._start()
            keep = max(1, settings.local_embedding_max_loaded)
            load = (
                "load",
                str(folder),
                settings.local_embedding_device,  # "auto" is decided in the child
                threads(settings.local_embedding_threads),
                keep,
            )
            loaded = self._ask(conn, load, LOAD_SECONDS)
            assert isinstance(loaded, tuple)
            self._loaded = list(loaded[1])  # pyright: ignore[reportUnknownArgumentType]
            vectors = self._ask(conn, ("embed", texts, kind), BATCH_SECONDS)
        except TimeoutError:
            self._stop()
            raise AppError("ai.timeout", 504) from None
        except _ChildError as exc:  # this model or batch failed; the child is fine
            log.warning("local_embedding_failed", error=str(exc), model=folder.name)
            self._loaded = exc.loaded
            raise AppError("ai.local_model_failed", 500) from exc
        except (EOFError, OSError) as exc:
            log.warning("local_embedding_failed", error=repr(exc))
            self._stop()
            raise AppError("ai.local_model_failed", 500) from exc
        finally:
            self._last_used = time.monotonic()
        assert isinstance(vectors, list)
        return vectors  # pyright: ignore[reportUnknownVariableType]

    def close(self) -> None:
        with self._lock:
            self._stop()


_runtime = _Runtime()


async def embed(
    folder: Path, settings: Settings, texts: Sequence[str], kind: Kind
) -> list[list[float]]:
    """Vectors of `texts` with the model in `folder`. Raises `ai.timeout` or
    `ai.local_model_failed`."""
    # Abandoned on cancel: a search that stops waiting (it answers by keyword) leaves the batch to
    # finish in its thread, so the model it loaded is there for the next query.
    return await anyio.to_thread.run_sync(
        _runtime.embed, folder, settings, list(texts), kind, abandon_on_cancel=True
    )


def close() -> None:
    _runtime.close()
