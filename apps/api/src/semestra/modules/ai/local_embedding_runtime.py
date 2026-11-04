"""The child process that runs local embedding models (M06 `local_embedding`).

Embedding happens for every search query as well as for every new document, so the model stays
loaded in one long-lived process instead of a process per call: a query then takes milliseconds,
not the seconds a model takes to load. The process starts on first use, keeps one model at a
time, and exits after `local_embedding_idle_seconds` without a request. A crash or a call that
runs out of time ends it; the next call starts a fresh one.

Requests are served one at a time; a search query waits at most for the batch in progress.
"""

import json
import multiprocessing
import os
import threading
import time
import traceback
from collections.abc import Sequence
from dataclasses import dataclass
from functools import cache
from multiprocessing.connection import Connection
from multiprocessing.process import BaseProcess
from pathlib import Path
from typing import Any, Literal

import anyio
import anyio.to_thread
import structlog

from semestra.core.config import Settings
from semestra.core.errors import AppError

log = structlog.get_logger(__name__)

type Kind = Literal["query", "passage"]
type Device = Literal["cpu", "cuda"]

# Seconds a model may take to load (from disk; downloads happen before), and per batch.
LOAD_SECONDS = 300
BATCH_SECONDS = 120
# Texts per inference call. Activations grow with the batch size and the square of the length,
# so a small batch keeps the process near the model's own size (e5-small int8 peaked at about
# 2 GB with 32 texts of ~360 tokens on an M3, 2026-11-04) for little loss of speed.
BATCH = 8

_PROVIDERS: dict[Device, str] = {"cuda": "CUDAExecutionProvider", "cpu": "CPUExecutionProvider"}


@cache
def _available_providers() -> tuple[str, ...]:
    try:
        import onnxruntime  # pyright: ignore[reportMissingImports]
    except ImportError:
        return ()
    return tuple(onnxruntime.get_available_providers())


def device(setting: str) -> Device:
    """The device a model runs on: the one configured, or CUDA when ONNX Runtime has it.

    There is no Core ML (Mac GPU) option: on an M3 (2026-11-04) ONNX Runtime split e5-small into
    38 Core ML partitions and inference took tens of gigabytes of swap until it was killed, while
    the CPU embeds about 22 chunks a second with the int8 model."""
    if setting in ("cpu", "cuda"):
        return setting  # pyright: ignore[reportReturnType]
    return "cuda" if _PROVIDERS["cuda"] in _available_providers() else "cpu"


def threads(setting: int) -> int:
    return setting if setting > 0 else max(1, (os.cpu_count() or 2) // 2)


# --- in the child -----------------------------------------------------------------------------


@dataclass
class _Model:
    session: Any
    tokenizer: Any
    spec: Any  # local_embedding.Spec
    inputs: frozenset[str]
    device: Device


def _load(folder: str, wanted: Device, thread_count: int) -> _Model:
    import onnxruntime  # pyright: ignore[reportMissingImports]
    from tokenizers import Tokenizer  # pyright: ignore[reportMissingImports]

    from semestra.modules.ai.local_embedding import Spec

    path = Path(folder)
    spec = Spec(**json.loads((path / "semestra.json").read_text()))
    onnxruntime.set_default_logger_severity(3)
    options = onnxruntime.SessionOptions()
    options.intra_op_num_threads = thread_count
    # No memory arena: it keeps the largest batch's memory for the life of the process.
    options.enable_cpu_mem_arena = False
    options.graph_optimization_level = onnxruntime.GraphOptimizationLevel.ORT_ENABLE_ALL
    session = None
    used: Device = "cpu"
    if wanted != "cpu":
        try:
            session = onnxruntime.InferenceSession(
                str(path / spec.onnx), options, providers=[_PROVIDERS[wanted], _PROVIDERS["cpu"]]
            )
            used = wanted
        except Exception:  # a driver or an operator the device lacks: the CPU still works
            traceback.print_exc()
    if session is None:
        session = onnxruntime.InferenceSession(
            str(path / spec.onnx), options, providers=[_PROVIDERS["cpu"]]
        )
    names = frozenset(i.name for i in session.get_inputs())
    unknown = names - {"input_ids", "attention_mask", "token_type_ids", "position_ids"}
    if unknown:  # e.g. a text-generation export that wants past key values
        raise ValueError(f"unsupported model inputs: {sorted(unknown)}")
    tokenizer = Tokenizer.from_file(str(path / "tokenizer.json"))
    tokenizer.enable_truncation(spec.max_tokens)
    pad_id = next(
        (
            i
            for t in ("<pad>", "[PAD]", "<|endoftext|>")
            if (i := tokenizer.token_to_id(t)) is not None
        ),
        0,
    )
    tokenizer.enable_padding(direction="right", pad_id=pad_id)
    return _Model(session, tokenizer, spec, names, used)


def _embed(model: _Model, texts: Sequence[str], kind: Kind) -> list[list[float]]:
    import numpy as np  # pyright: ignore[reportMissingImports]

    spec = model.spec
    prefix = spec.query_prefix if kind == "query" else spec.passage_prefix
    # Similar lengths together, so a batch pads little.
    order = sorted(range(len(texts)), key=lambda i: len(texts[i]))
    out: list[list[float]] = [[] for _ in texts]
    for start in range(0, len(order), BATCH):
        indexes = order[start : start + BATCH]
        encodings = model.tokenizer.encode_batch([prefix + texts[i] for i in indexes])
        ids = np.array([e.ids for e in encodings], dtype=np.int64)
        mask = np.array([e.attention_mask for e in encodings], dtype=np.int64)
        feed = {"input_ids": ids, "attention_mask": mask}
        if "token_type_ids" in model.inputs:
            feed["token_type_ids"] = np.zeros_like(ids)
        if "position_ids" in model.inputs:
            feed["position_ids"] = np.clip(np.cumsum(mask, axis=1) - 1, 0, None)
        feed = {k: v for k, v in feed.items() if k in model.inputs}
        outputs = model.session.get_outputs()
        named = {o.name: i for i, o in enumerate(outputs)}
        results = model.session.run(None, feed)
        if "sentence_embedding" in named:  # already pooled by the export
            vectors = np.asarray(results[named["sentence_embedding"]], dtype=np.float32)
        else:
            hidden = np.asarray(results[0], dtype=np.float32)
            if spec.pooling == "cls":
                vectors = hidden[:, 0]
            elif spec.pooling == "last":  # right padding: the last real token
                vectors = hidden[np.arange(len(hidden)), mask.sum(axis=1) - 1]
            else:
                weights = mask[:, :, None].astype(np.float32)
                vectors = (hidden * weights).sum(axis=1) / np.clip(weights.sum(axis=1), 1e-9, None)
        norms = np.linalg.norm(vectors, axis=1, keepdims=True)
        vectors = vectors / np.clip(norms, 1e-12, None)
        for i, vector in zip(indexes, vectors, strict=True):
            out[i] = vector.tolist()
    return out


def _serve(conn: Connection) -> None:
    model: _Model | None = None
    folder: str | None = None
    while True:
        try:
            message = conn.recv()
        except EOFError, KeyboardInterrupt:
            return
        try:
            match message:
                case ("load", str(wanted_folder), str(wanted), int(thread_count)):
                    if folder != wanted_folder:
                        model = None  # one model at a time
                        model = _load(wanted_folder, wanted, thread_count)  # pyright: ignore[reportArgumentType]
                        folder = wanted_folder
                    assert model is not None
                    conn.send(("ok", model.device))
                case ("embed", list(texts), str(kind)):
                    assert model is not None
                    conn.send(("ok", _embed(model, texts, kind)))  # pyright: ignore[reportArgumentType]
                case _:
                    conn.send(("error", f"unknown request {message!r}"))
        except Exception as exc:
            traceback.print_exc()  # the child's stderr, for whoever runs the API
            conn.send(("error", repr(exc)))


# --- in the API process -----------------------------------------------------------------------


class _Runtime:
    """The parent's handle on the child. Every method blocks: call them in a worker thread."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
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
            target=_serve, args=(theirs,), daemon=True, name="semestra-embedding"
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

    def _reap(self) -> None:
        while True:
            time.sleep(min(30.0, self._idle_seconds / 2))
            with self._lock:
                if self._process is None:
                    return
                if time.monotonic() - self._last_used > self._idle_seconds:
                    log.info("local_embedding_idle_exit")
                    self._stop()
                    return

    def _ask(self, conn: Connection, message: tuple[object, ...], seconds: float) -> object:
        conn.send(message)
        if not conn.poll(seconds):
            raise TimeoutError
        status, value = conn.recv()
        if status != "ok":
            raise RuntimeError(value)
        return value

    def embed(
        self, folder: Path, settings: Settings, texts: list[str], kind: Kind
    ) -> list[list[float]]:
        with self._lock:
            self._idle_seconds = settings.local_embedding_idle_seconds
            self._last_used = time.monotonic()
            try:
                conn = self._start()
                load = (
                    "load",
                    str(folder),
                    device(settings.local_embedding_device),
                    threads(settings.local_embedding_threads),
                )
                self._ask(conn, load, LOAD_SECONDS)
                seconds = BATCH_SECONDS * max(1, -(-len(texts) // BATCH))
                vectors = self._ask(conn, ("embed", texts, kind), seconds)
            except TimeoutError:
                self._stop()
                raise AppError("ai.timeout", 504) from None
            except (EOFError, OSError, RuntimeError) as exc:
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
    return await anyio.to_thread.run_sync(_runtime.embed, folder, settings, list(texts), kind)


def close() -> None:
    _runtime.close()
