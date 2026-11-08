"""Local text embedding on ONNX Runtime (M06, used by M07 for vector search).

Only self-hosted installs have it (`uv sync --extra embedding`, or the `-local` image). A user
picks one of the presets below, or (when the server allows it) any Hugging Face model that has
an ONNX export, by its repository name. Models are downloaded the first time they are needed into
`<DATA_DIR>/models/embedding`, shared by every user of the server, and run in one long-lived
child process (`local_embedding_runtime`) on the best device ONNX Runtime has: CUDA, Core ML or
the CPU.

Each model directory holds the chosen ONNX file, `tokenizer.json` and `semestra.json`, the
`Spec` the runtime follows (pooling, prefixes, length); it is written last, so a directory
without it is not a model yet.
"""

import contextlib
import importlib.metadata
import importlib.util
import json
import os
import re
import shutil
from dataclasses import asdict, dataclass
from functools import cache
from pathlib import Path
from typing import Any, Literal

import anyio
import structlog

from semestra.core.config import Settings
from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules.ai import local_download
from semestra.modules.ai.local_download import Download, Progress
from semestra.modules.ai.models import AiModelAssignment
from semestra.modules.ai.resolve import try_resolve

log = structlog.get_logger(__name__)

type Pooling = Literal["mean", "cls", "last"]


@dataclass(frozen=True)
class Spec:
    """How the runtime turns a model's output into one vector per text."""

    repo: str
    onnx: str  # path of the ONNX file inside the model directory
    pooling: Pooling
    query_prefix: str = ""
    passage_prefix: str = ""
    max_tokens: int = 512


@dataclass(frozen=True)
class Preset:
    repo: str
    pooling: Pooling
    query_prefix: str = ""
    passage_prefix: str = ""
    # The export to use on every device, when the usual pick (int8 on the CPU) is not good enough.
    onnx: str = ""


# The presets, smallest first. Each comes from a repository with ready-made ONNX exports.
PRESETS: dict[str, Preset] = {
    "multilingual-e5-small": Preset(
        "intfloat/multilingual-e5-small", "mean", query_prefix="query: ", passage_prefix="passage: "
    ),
    "bge-m3": Preset("Xenova/bge-m3", "cls"),
    # fp16 even on the CPU: the int8 export strays from the original model (cosine 0.83-0.88,
    # and a text's vector depends on its batch); fp16 matches it, at about 0.7 texts of ~360
    # tokens a second on an M3 (2026-11-04).
    "qwen3-embedding-0.6b": Preset(
        "onnx-community/Qwen3-Embedding-0.6B-ONNX",
        "last",
        query_prefix=(
            "Instruct: Given a web search query, retrieve relevant passages that answer the query\n"
            "Query:"
        ),
        onnx="onnx/model_fp16.onnx",
    ),
}
DEFAULT = "multilingual-e5-small"
# The longest input given to a model (longer input only costs time); M07 sizes its chunks to fit.
MAX_TOKENS = 512

# Files a model may need besides the ONNX graph; only those present are fetched.
_CONFIG_FILES = (
    "tokenizer.json",
    "1_Pooling/config.json",
    "config_sentence_transformers.json",
    "sentence_bert_config.json",
)
# The ONNX file to use, best first: quantised ones are smaller and faster on a CPU; a GPU wants
# half or full precision (int8 kernels mostly run on the CPU there).
_CPU_FILES = (
    "onnx/model_quantized.onnx",
    "onnx/model_int8.onnx",
    "onnx/model_qint8_avx512_vnni.onnx",  # optimum's export; runs on any CPU, ARM included
    "onnx/model.onnx",
    "model.onnx",
    "onnx/model_fp16.onnx",
)
_GPU_FILES = ("onnx/model_fp16.onnx", "onnx/model.onnx", "model.onnx", "onnx/model_quantized.onnx")
_REPO = re.compile(r"[A-Za-z0-9][\w.-]{0,95}/[\w.-]{1,96}")
_KEY = "embedding:"
GB = 1_000_000_000
DOWNLOAD_POLL_SECONDS = 0.5


@cache
def _installed() -> bool:
    return all(
        importlib.util.find_spec(m) is not None
        for m in ("onnxruntime", "tokenizers", "huggingface_hub", "numpy")
    )


def available(settings: Settings) -> bool:
    return settings.local_embedding and _installed()


def default_model(settings: Settings) -> str:
    chosen = settings.local_embedding_model
    return chosen if valid(settings, chosen) else DEFAULT


def is_custom(model: str) -> bool:
    return model not in PRESETS


def valid(settings: Settings, model: str) -> bool:
    """A preset, or a Hugging Face repository name when the server allows those."""
    return model in PRESETS or (settings.local_embedding_custom and bool(_REPO.fullmatch(model)))


async def choice(ctx: Ctx) -> str | None:
    """The local model that embeds this user's texts, or None when a provider's model does:
    local embedding is not installed, the user picked a provider's model, or (on automatic) a
    provider or the instance has an embedding model. Automatic only falls back to the local
    model, so turning local embedding on never moves anyone's vectors to a different model."""
    if not available(ctx.settings):
        return None
    row = await ctx.db.get(AiModelAssignment, (ctx.user_id, "embedding"))
    if row is None or (row.provider_id is None and row.model is None):  # Auto
        if await try_resolve(ctx, "embedding", with_key=False) is not None:
            return None
        return default_model(ctx.settings)
    if row.provider_id is not None or row.model is None:
        return None
    return row.model if valid(ctx.settings, row.model) else default_model(ctx.settings)


def model_tag(settings: Settings, model: str) -> str:
    """The model's name in the vector space's fingerprint: changing models rebuilds vectors.
    It names the ONNX file too: an int8 and a half-precision copy of a model (CPU or GPU) give
    slightly different vectors (cosine about 0.995), which should not be mixed."""
    try:
        return f"local:{model}@{Path(spec(settings, model).onnx).stem}"
    except OSError, ValueError, TypeError:
        return f"local:{model}"


# --- files ------------------------------------------------------------------------------------


def models_dir(settings: Settings) -> Path:
    return settings.local_embedding_dir or settings.data_dir / "models" / "embedding"


def _dir_name(model: str) -> str:
    return model if model in PRESETS else "hf--" + model.replace("/", "--")


def model_dir(settings: Settings, model: str) -> Path:
    return models_dir(settings) / _dir_name(model)


def downloaded(settings: Settings, model: str) -> bool:
    return (model_dir(settings, model) / "semestra.json").is_file()


def spec(settings: Settings, model: str) -> Spec:
    data = json.loads((model_dir(settings, model) / "semestra.json").read_text())
    return Spec(**data)


def custom_models(settings: Settings) -> list[str]:
    """Hugging Face models already on this server, by repository name."""
    root = models_dir(settings)
    if not root.is_dir():
        return []
    found: list[str] = []
    for path in sorted(root.glob("hf--*/semestra.json")):
        with contextlib.suppress(OSError, ValueError, KeyError):
            found.append(json.loads(path.read_text())["repo"])
    return found


def downloading() -> list[str]:
    return local_download.downloading(_KEY)


def size(settings: Settings, model: str) -> int:
    """Bytes the model takes on disk (blocking)."""
    return local_download.dir_size(model_dir(settings, model))


def delete(settings: Settings, model: str) -> None:
    """Removes the model's files (blocking). The embedding process is stopped first, as it may
    hold the model; it starts again on the next text to embed."""
    from semestra.modules.ai import local_embedding_runtime

    local_embedding_runtime.close()
    local_download.remove(model_dir(settings, model))


# --- Hugging Face -----------------------------------------------------------------------------


@dataclass(frozen=True)
class _Plan:
    repo: str
    onnx: str
    files: list[str]  # everything to fetch
    total: int  # bytes


def _api() -> Any:  # huggingface_hub is optional
    # Plain HTTPS rather than Xet: each file grows on disk as it arrives (what the progress
    # measures), and no chunk cache is left behind. Read when huggingface_hub is first imported.
    os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
    from huggingface_hub import HfApi  # pyright: ignore[reportMissingImports]

    return HfApi()


def _gpu_device(settings: Settings) -> bool:
    """Whether models run on CUDA: as configured, or on "auto" when ONNX Runtime's GPU build
    (the `local-cuda` extra) is installed, as its child process decides. Read from the package
    metadata, so the API process does not load ONNX Runtime."""
    if settings.local_embedding_device != "auto":
        return settings.local_embedding_device == "cuda"
    return _gpu_build()


@cache
def _gpu_build() -> bool:
    try:
        importlib.metadata.distribution("onnxruntime-gpu")
    except importlib.metadata.PackageNotFoundError:
        return False
    return True


def plan(settings: Settings, model: str) -> _Plan:
    """What to download for `model`, from its repository's file list (blocking). Raises
    `ai.local_model_*` errors for a repository that does not exist, has no ONNX export or
    tokenizer, or is larger than the server allows."""
    preset = PRESETS.get(model)
    repo = preset.repo if preset else model
    try:
        info = _api().model_info(repo, files_metadata=True)
    except Exception as exc:
        status = getattr(getattr(exc, "response", None), "status_code", None)
        if status in (401, 403, 404):  # gated and private repositories answer like missing ones
            raise AppError("ai.local_model_not_found", 404, model=model) from exc
        log.warning("local_embedding_plan_failed", model=model, error=repr(exc))
        raise AppError("ai.local_model_unreachable", 502, model=model) from exc
    sizes = {s.rfilename: s.size or 0 for s in info.siblings or []}
    preferred = _GPU_FILES if _gpu_device(settings) else _CPU_FILES
    if preset and preset.onnx:
        preferred = (preset.onnx,)
    onnx = next((f for f in preferred if f in sizes), None)
    if onnx is None or "tokenizer.json" not in sizes:
        raise AppError("ai.local_model_no_onnx", 400, model=model)
    # Large graphs keep their weights next to them (`model.onnx_data`, `model.onnx.data`, ...).
    files = [onnx, *(f for f in sizes if f != onnx and f.startswith(onnx) and "data" in f)]
    files += [f for f in _CONFIG_FILES if f in sizes]
    total = sum(sizes[f] for f in files)
    limit = settings.local_embedding_max_gb
    if is_custom(model) and total > limit * GB:
        raise AppError(
            "ai.local_model_too_large", 400, model=model, size_gb=round(total / GB, 1),
            limit_gb=limit,
        )  # fmt: skip
    return _Plan(repo, onnx, files, total)


def _read_spec(model: str, plan: _Plan, folder: Path) -> Spec:
    """The model's pooling and prefixes: fixed for presets, read from the sentence-transformers
    files of a custom model (mean pooling and no prefixes when it has none)."""
    if model in PRESETS:
        preset = PRESETS[model]
        return Spec(
            plan.repo, plan.onnx, preset.pooling, preset.query_prefix, preset.passage_prefix,
            MAX_TOKENS,
        )  # fmt: skip

    def read(name: str) -> dict[str, object]:
        with contextlib.suppress(OSError, ValueError):
            data = json.loads((folder / name).read_text())
            return data if isinstance(data, dict) else {}
        return {}

    pooling_config = read("1_Pooling/config.json")
    pooling: Pooling = (
        "cls"
        if pooling_config.get("pooling_mode_cls_token")
        else "last"
        if pooling_config.get("pooling_mode_lasttoken")
        else "mean"
    )
    prompts = read("config_sentence_transformers.json").get("prompts")
    prompts = prompts if isinstance(prompts, dict) else {}
    length = read("sentence_bert_config.json").get("max_seq_length")
    return Spec(
        plan.repo,
        plan.onnx,
        pooling,
        str(prompts.get("query") or ""),
        str(prompts.get("document") or prompts.get("passage") or ""),
        min(length, MAX_TOKENS) if isinstance(length, int) and length > 0 else MAX_TOKENS,
    )


def _fetch(settings: Settings, model: str, state: Download) -> None:
    from huggingface_hub import snapshot_download  # pyright: ignore[reportMissingImports]

    found = plan(settings, model)
    state.total = found.total or None
    folder = state.staging / "model"
    snapshot_download(repo_id=found.repo, local_dir=folder, allow_patterns=found.files)
    shutil.rmtree(folder / ".cache", ignore_errors=True)
    (folder / "semestra.json").write_text(json.dumps(asdict(_read_spec(model, found, folder))))
    target = model_dir(settings, model)
    shutil.rmtree(target, ignore_errors=True)  # an unfinished copy left by an older version
    folder.rename(target)


async def download(settings: Settings, model: str, progress: Progress | None = None) -> None:
    """Makes sure the model is on disk, reporting `progress(bytes_received, total_bytes)` while
    it downloads (shared by everyone waiting for it; see `local_download.ensure`)."""
    if not valid(settings, model):
        raise ValueError(f"unknown local embedding model {model!r}")
    await local_download.ensure(
        _KEY + model,
        parent=models_dir(settings),
        present=lambda: downloaded(settings, model),
        fetch=lambda state: _fetch(settings, model, state),
        progress=progress,
        poll_seconds=DOWNLOAD_POLL_SECONDS,
    )


async def check(settings: Settings, model: str) -> None:
    """Raises the reason a custom model cannot be used before anything is downloaded (presets
    are known to work; a failed download is reported by its job)."""
    if is_custom(model) and not downloaded(settings, model):
        await anyio.to_thread.run_sync(plan, settings, model)


def download_blocking(settings: Settings, model: str) -> None:
    """`download` for the command line (`semestra embedding-models`)."""
    anyio.run(download, settings, model)
