"""Local OCR of scanned pages with PaddleOCR (PP-OCR) on ONNX Runtime (M06, used by M07 §3.1).

Only self-hosted installs have it (`uv sync --extra ocr`, or the `-ocr` image). Inference runs on
the CPU, so the same code serves Linux containers and a Mac running the API natively. It runs in a
parse child process (`files.parse.isolated.ocr_isolated`), which loads the engine once per document
and reads its pages one at a time.

Models are not part of the install: each is downloaded the first time it is needed (`download`),
into PaddleX's cache (`PADDLE_PDX_CACHE_HOME`, under `/data` in the image), and shared by every
user of the server.
"""

import contextlib
import importlib.util
import io
import os
import shutil
import tempfile
import threading
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path
from typing import Any

import anyio
import structlog

from semestra.core.config import Settings
from semestra.core.context import Ctx
from semestra.modules.ai.models import AiModelAssignment

log = structlog.get_logger(__name__)

# The PP-OCR models a user can pick, smallest first. `SEMESTRA_LOCAL_OCR_MODEL` is the one used
# until a user picks.
MODELS = (
    "PP-OCRv6_tiny",
    "PP-OCRv6_small",
    "PP-OCRv6_medium",
    "PP-OCRv5_mobile",
    "PP-OCRv5_server",
)

_LOCK = threading.Lock()
_ENGINES: dict[str, Any] = {}


@cache
def _installed() -> bool:
    return all(importlib.util.find_spec(m) is not None for m in ("paddleocr", "onnxruntime"))


def available(settings: Settings) -> bool:
    return settings.local_ocr and _installed()


def default_model(settings: Settings) -> str:
    return settings.local_ocr_model if settings.local_ocr_model in MODELS else "PP-OCRv6_medium"


async def choice(ctx: Ctx) -> str | None:
    """The local model that reads this user's scanned pages, or None when they go to an AI
    model: local OCR is not installed, or the user picked a provider's model for OCR."""
    if not available(ctx.settings):
        return None
    row = await ctx.db.get(AiModelAssignment, (ctx.user_id, "ocr"))
    if row is None:
        return default_model(ctx.settings)
    if row.provider_id is not None:
        return None
    return row.model if row.model in MODELS else default_model(ctx.settings)


async def picked(ctx: Ctx) -> bool:
    """Whether the user chose a local model for OCR themselves, rather than leaving it on Auto."""
    row = await ctx.db.get(AiModelAssignment, (ctx.user_id, "ocr"))
    return row is not None and row.provider_id is None


def model_tag(model: str) -> str:
    """Goes into the parser fingerprint, so changing the model re-reads documents."""
    return f"local:{model}"


def _engine(model: str) -> Any:
    with _LOCK:
        if model not in _ENGINES:
            # One engine at a time: each holds over a gigabyte once loaded.
            _ENGINES.clear()
            import onnxruntime  # pyright: ignore[reportMissingImports]
            from paddleocr import PaddleOCR  # pyright: ignore[reportMissingImports]

            # Errors only: some models log dozens of "unused initializer" warnings on load.
            onnxruntime.set_default_logger_severity(3)
            _ENGINES[model] = PaddleOCR(
                text_detection_model_name=f"{model}_det",
                text_recognition_model_name=f"{model}_rec",
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                use_textline_orientation=False,
                engine="onnxruntime",
                device="cpu",
            )
        return _ENGINES[model]


def recognize(model: str, png: bytes) -> str:
    """The page's text, one detected line per line in reading order. Blocking: call it in a
    worker thread."""
    import numpy as np  # pyright: ignore[reportMissingImports]
    from PIL import Image

    # PaddleOCR takes arrays in OpenCV's channel order (BGR).
    image = np.array(Image.open(io.BytesIO(png)).convert("RGB"))[:, :, ::-1]
    engine = _engine(model)
    with _LOCK:  # one page at a time: the engine is not thread-safe and uses every core
        results = list(engine.predict(input=image))
    lines: list[str] = []
    for result in results:
        lines += [str(t).strip() for t in result.get("rec_texts", []) if str(t).strip()]
    return "\n".join(lines)


# --- downloads --------------------------------------------------------------------------------


def _parts(model: str) -> tuple[str, str]:
    """PaddleX's names for the model's ONNX packages, which are also their cache directories."""
    return f"{model}_det_onnx", f"{model}_rec_onnx"


def models_dir() -> Path:
    """Where PaddleX keeps downloaded models (same rule as `paddlex.utils.cache`)."""
    home = os.environ.get("PADDLE_PDX_CACHE_HOME") or os.path.join(Path.home(), ".paddlex")
    return Path(home) / "official_models"


def downloaded(model: str) -> bool:
    return all((models_dir() / part).is_dir() for part in _parts(model))


@dataclass
class _Download:
    """A download in progress, shared by everyone waiting for the same model."""

    staging: Path
    total: int | None = None  # bytes, once known
    finished: threading.Event = field(default_factory=threading.Event)
    error: BaseException | None = None

    def received(self) -> int:
        size = 0
        for root, _, files in os.walk(self.staging):
            for name in files:
                with contextlib.suppress(OSError):
                    size += os.path.getsize(os.path.join(root, name))
        return size


_DOWNLOADS: dict[str, _Download] = {}
_DOWNLOADS_LOCK = threading.Lock()

# Seconds between progress reports while a model downloads.
DOWNLOAD_POLL_SECONDS = 0.5
# A staging directory this old was left by a server that stopped mid-download; a younger one may
# belong to another process downloading the same model (`semestra ocr-models` next to the server).
STALE_STAGING_SECONDS = 3600


def _fetch(model: str, state: _Download) -> None:
    """Downloads the model's missing packages, from Hugging Face with a known size when it can
    (so progress has a total), otherwise through PaddleX's own list of mirrors. Each package is
    staged next to the cache and moved in whole, so a stopped download leaves nothing half done."""
    target = models_dir()
    missing = [part for part in _parts(model) if not (target / part).is_dir()]
    try:
        _fetch_from_hugging_face(missing, state)
    except Exception as exc:  # any failure falls back to the mirrors
        log.warning("local_ocr_download_hf_failed", model=model, error=repr(exc))
        state.total = None
        _fetch_from_mirrors(missing)
        return
    for part in missing:
        # Another process may have finished the same package first.
        with contextlib.suppress(OSError):
            (state.staging / part).rename(target / part)


def _fetch_from_hugging_face(parts: list[str], state: _Download) -> None:
    # Plain HTTPS rather than Xet: each file grows on disk as it arrives (what the progress
    # measures), and no chunk cache is left behind. Read when huggingface_hub is first imported.
    os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
    from huggingface_hub import HfApi, snapshot_download  # pyright: ignore[reportMissingImports]

    endpoint = os.environ.get("PADDLE_PDX_HUGGING_FACE_ENDPOINT", "https://huggingface.co")
    api = HfApi(endpoint=endpoint)
    repos = [f"PaddlePaddle/{part}" for part in parts]
    infos = [api.model_info(repo, files_metadata=True) for repo in repos]
    state.total = sum(s.size or 0 for info in infos for s in info.siblings or []) or None
    for part, repo in zip(parts, repos, strict=True):
        snapshot_download(repo_id=repo, local_dir=state.staging / part, endpoint=endpoint)
        # huggingface_hub's own bookkeeping for the download; the model does not need it.
        shutil.rmtree(state.staging / part / ".cache", ignore_errors=True)


def _fetch_from_mirrors(parts: list[str]) -> None:
    from paddlex.inference.utils.official_models import (  # pyright: ignore[reportMissingImports]
        official_models,
    )

    for part in parts:
        official_models.get_model_path(part.removesuffix("_onnx"), model_formats=("onnx",))


def _run(model: str, state: _Download) -> None:
    try:
        _fetch(model, state)
    except BaseException as exc:  # handed to whoever waits
        state.error = exc
    finally:
        shutil.rmtree(state.staging, ignore_errors=True)
        with _DOWNLOADS_LOCK:
            _DOWNLOADS.pop(model, None)
        state.finished.set()


async def download(
    model: str, progress: Callable[[int, int | None], Awaitable[None]] | None = None
) -> None:
    """Makes sure the model is on disk, reporting `progress(bytes_received, total_bytes)` while
    it downloads. Callers asking for the same model share one download, and it carries on in the
    background if a caller stops waiting (a cancelled job), so the bytes are not wasted."""
    if model not in MODELS:
        raise ValueError(f"unknown local OCR model {model!r}")
    if downloaded(model):
        return
    with _DOWNLOADS_LOCK:
        state = _DOWNLOADS.get(model)
        if state is None:
            models_dir().mkdir(parents=True, exist_ok=True)
            cutoff = time.time() - STALE_STAGING_SECONDS
            for stale in models_dir().glob(f".{model}-*"):
                with contextlib.suppress(OSError):
                    if stale.stat().st_mtime < cutoff:
                        shutil.rmtree(stale, ignore_errors=True)
            # On the same file system as the cache, so finished packages move in one rename.
            staging = Path(tempfile.mkdtemp(prefix=f".{model}-", dir=models_dir()))
            state = _DOWNLOADS[model] = _Download(staging)
            threading.Thread(target=_run, args=(model, state), daemon=True).start()
    while not state.finished.is_set():
        if progress is not None:
            await progress(await anyio.to_thread.run_sync(state.received), state.total)
        await anyio.sleep(DOWNLOAD_POLL_SECONDS)
    if state.error is not None:
        raise state.error
    if not downloaded(model):
        raise RuntimeError(f"{model} is still missing after its download")
    if progress is not None and state.total is not None:
        await progress(state.total, state.total)


def downloading() -> list[str]:
    """The models this process is downloading now, whoever asked for them."""
    with _DOWNLOADS_LOCK:
        return [m for m in MODELS if m in _DOWNLOADS]


def download_blocking(model: str) -> None:
    """`download` for the command line (`semestra ocr-models`)."""
    anyio.run(download, model)
