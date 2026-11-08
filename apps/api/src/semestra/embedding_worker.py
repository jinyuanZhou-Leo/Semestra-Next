"""The child process of local embedding (M06 `ai.local_embedding_runtime` starts it).

Kept outside the modules on purpose: a spawned child imports only this file (and ONNX
Runtime, tokenizers, numpy once a model loads), not the API's modules, so its memory is the
model's.
"""

import json
import traceback
from collections import OrderedDict
from collections.abc import Sequence
from dataclasses import dataclass
from multiprocessing.connection import Connection
from pathlib import Path
from typing import Any

# Texts per inference call. Activations grow with the batch size and the square of the length.
# Measured 2026-11-04 with e5-small int8 and texts of ~360 tokens: about 27 a second on an M3;
# in a 2-core Linux container about 15 a second, the process peaking at about 0.9 GB.
# Batches of 4 did not lower the peak.
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
    pad: int
    # Last-token pooling reads the end-of-text token's state (Qwen3-Embedding); a tokenizer
    # that does not add it itself gets it appended.
    eos: int | None
    device: str


def _load(folder: str, wanted: str, thread_count: int) -> _Model:
    """`wanted`: "cpu", "cuda", or "auto" (CUDA when ONNX Runtime has it). There is no Core ML
    (Mac GPU) option: on an M3 (2026-11-04) ONNX Runtime split e5-small into 38 Core ML
    partitions and inference took tens of gigabytes of swap until it was killed, while the CPU
    embeds about 22 chunks a second with the int8 model."""
    import onnxruntime  # pyright: ignore[reportMissingImports]
    from tokenizers import Tokenizer  # pyright: ignore[reportMissingImports]

    if wanted == "auto":
        available = onnxruntime.get_available_providers()
        wanted = "cuda" if _PROVIDERS["cuda"] in available else "cpu"

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
            # ORT may fall back to the CPU quietly (a missing CUDA library): report what runs.
            used = wanted if _PROVIDERS[wanted] in session.get_providers() else "cpu"
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
    eos = tokenizer.token_to_id("<|endoftext|>") if spec["pooling"] == "last" else None
    return _Model(session, tokenizer, spec, names, caches, pad_id, eos, used)


def _embed(model: _Model, texts: Sequence[str], kind: str) -> list[list[float]]:
    import numpy as np  # pyright: ignore[reportMissingImports]

    spec = model.spec
    prefix = spec["query_prefix"] if kind == "query" else spec["passage_prefix"]
    limit = spec["max_tokens"]
    # Similar lengths together, so a batch pads little.
    order = sorted(range(len(texts)), key=lambda i: len(texts[i]))
    out: list[list[float]] = [[] for _ in texts]
    for start in range(0, len(order), BATCH):
        indexes = order[start : start + BATCH]
        encodings = model.tokenizer.encode_batch([prefix + texts[i] for i in indexes])
        rows: list[list[int]] = [e.ids for e in encodings]
        if model.eos is not None:
            rows = [r if r and r[-1] == model.eos else [*r[: limit - 1], model.eos] for r in rows]
        width = max(len(r) for r in rows)
        ids = np.array([r + [model.pad] * (width - len(r)) for r in rows], dtype=np.int64)
        mask = np.array([[1] * len(r) + [0] * (width - len(r)) for r in rows], dtype=np.int64)
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
            elif spec["pooling"] == "last":  # padded on the right: the last real token
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
    """The child's loop: `("load", folder, device, threads, keep)` then `("embed", texts, kind)`
    requests, each answered with `("ok", value)` or `("error", reason, loaded folders)`; a load
    answers `(device, loaded folders)`. Up to `keep` models stay loaded, the least recently used
    going first. A request that fails (a model that does not load, a batch that does not run)
    leaves the process and the other models as they are."""
    models: OrderedDict[str, _Model] = OrderedDict()
    model: _Model | None = None
    while True:
        try:
            message = conn.recv()
        except EOFError, KeyboardInterrupt:
            return
        try:
            match message:
                case ("load", str(folder), str(wanted), int(thread_count), int(keep)):
                    model = models.get(folder)
                    if model is None:
                        while models and len(models) >= max(1, keep):
                            models.popitem(last=False)
                        model = None  # the evicted model's memory goes before the next loads
                        model = models[folder] = _load(folder, wanted, thread_count)
                    models.move_to_end(folder)
                    conn.send(("ok", (model.device, list(models))))
                case ("embed", list(texts), str(kind)):
                    assert model is not None
                    conn.send(("ok", _embed(model, texts, kind)))
                case _:
                    conn.send(("error", f"unknown request {message!r}", list(models)))
        except Exception as exc:
            traceback.print_exc()  # the child's stderr, for whoever runs the API
            conn.send(("error", repr(exc), list(models)))
