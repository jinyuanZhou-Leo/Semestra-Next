"""The child process of local embedding (M06 `ai.local_embedding_runtime` starts it).

Kept outside the modules on purpose: a spawned child imports only this file (and ONNX
Runtime, tokenizers, numpy once a model loads), not the API's modules, so its memory is the
model's.
"""

import json
import traceback
from collections.abc import Sequence
from dataclasses import dataclass
from multiprocessing.connection import Connection
from pathlib import Path
from typing import Any

# Texts per inference call. Activations grow with the batch size and the square of the length.
# Measured on an M3 (2026-11-04): e5-small int8 embeds about 27 texts of ~360 tokens a second
# with 8 per call, and the process peaks at about 2.2 GB (it keeps that until it idles out).
BATCH = 8
_PROVIDERS = {"cuda": "CUDAExecutionProvider"}
_CPU = "CPUExecutionProvider"


@dataclass
class _Model:
    session: Any
    tokenizer: Any
    spec: dict[str, Any]  # local_embedding.Spec, as written to semestra.json
    inputs: frozenset[str]
    # Empty key/value caches a decoder export (Qwen3) asks for: (name, shape with -1 for the
    # batch, numpy dtype name).
    caches: tuple[tuple[str, tuple[int, ...], str], ...]
    device: str


def _load(folder: str, wanted: str, thread_count: int) -> _Model:
    import onnxruntime  # pyright: ignore[reportMissingImports]
    from tokenizers import Tokenizer  # pyright: ignore[reportMissingImports]

    path = Path(folder)
    spec = json.loads((path / "semestra.json").read_text())
    onnxruntime.set_default_logger_severity(3)
    options = onnxruntime.SessionOptions()
    options.intra_op_num_threads = thread_count
    # No memory arena or pattern planning: both keep the largest batch's buffers around.
    options.enable_cpu_mem_arena = False
    options.enable_mem_pattern = False
    options.graph_optimization_level = onnxruntime.GraphOptimizationLevel.ORT_ENABLE_ALL
    session = None
    used = "cpu"
    if wanted != "cpu":
        try:
            session = onnxruntime.InferenceSession(
                str(path / spec["onnx"]), options, providers=[_PROVIDERS[wanted], _CPU]
            )
            used = wanted
        except Exception:  # a driver or an operator the device lacks: the CPU still works
            traceback.print_exc()
    if session is None:
        session = onnxruntime.InferenceSession(str(path / spec["onnx"]), options, providers=[_CPU])
    names = frozenset(i.name for i in session.get_inputs())
    # Decoder exports made for text generation take the previous tokens' keys and values; an
    # embedding has none, so they get empty caches: [batch, heads, 0 past tokens, head size].
    caches = tuple(
        (
            i.name,
            tuple(
                -1 if n == 0 else (d if isinstance(d, int) else 0) for n, d in enumerate(i.shape)
            ),
            "float16" if "float16" in i.type else "float32",
        )
        for i in session.get_inputs()
        if i.name.startswith("past_key_values")
    )
    known = {"input_ids", "attention_mask", "token_type_ids", "position_ids"}
    unknown = names - known - {name for name, _, _ in caches}
    if unknown:
        raise ValueError(f"unsupported model inputs: {sorted(unknown)}")
    tokenizer = Tokenizer.from_file(str(path / "tokenizer.json"))
    tokenizer.enable_truncation(spec["max_tokens"])
    pad_id = next(
        (
            i
            for t in ("<pad>", "[PAD]", "<|endoftext|>")
            if (i := tokenizer.token_to_id(t)) is not None
        ),
        0,
    )
    tokenizer.enable_padding(direction="right", pad_id=pad_id)
    return _Model(session, tokenizer, spec, names, caches, used)


def _embed(model: _Model, texts: Sequence[str], kind: str) -> list[list[float]]:
    import numpy as np  # pyright: ignore[reportMissingImports]

    spec = model.spec
    prefix = spec["query_prefix"] if kind == "query" else spec["passage_prefix"]
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
        for name, shape, dtype in model.caches:
            feed[name] = np.zeros([len(ids) if d < 0 else d for d in shape], dtype=dtype)
        outputs = [o.name for o in model.session.get_outputs()]
        # Only the hidden states: a decoder export's caches are not needed.
        wanted = next(
            (n for n in ("sentence_embedding", "last_hidden_state") if n in outputs), outputs[0]
        )
        (result,) = model.session.run([wanted], feed)
        if wanted == "sentence_embedding":  # already pooled by the export
            vectors = np.asarray(result, dtype=np.float32)
        else:
            hidden = np.asarray(result, dtype=np.float32)
            if spec["pooling"] == "cls":
                vectors = hidden[:, 0]
            elif spec["pooling"] == "last":  # right padding: the last real token
                vectors = hidden[np.arange(len(hidden)), mask.sum(axis=1) - 1]
            else:
                weights = mask[:, :, None].astype(np.float32)
                vectors = (hidden * weights).sum(axis=1) / np.clip(weights.sum(axis=1), 1e-9, None)
        norms = np.linalg.norm(vectors, axis=1, keepdims=True)
        vectors = vectors / np.clip(norms, 1e-12, None)
        for i, vector in zip(indexes, vectors, strict=True):
            out[i] = vector.tolist()
    return out


def serve(conn: Connection) -> None:
    """The child's loop: `("load", folder, device, threads)` then `("embed", texts, kind)`
    requests, each answered with `("ok", value)` or `("error", reason)`."""
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
                        model = _load(wanted_folder, wanted, thread_count)
                        folder = wanted_folder
                    assert model is not None
                    conn.send(("ok", model.device))
                case ("embed", list(texts), str(kind)):
                    assert model is not None
                    conn.send(("ok", _embed(model, texts, kind)))
                case _:
                    conn.send(("error", f"unknown request {message!r}"))
        except Exception as exc:
            traceback.print_exc()  # the child's stderr, for whoever runs the API
            conn.send(("error", repr(exc)))
