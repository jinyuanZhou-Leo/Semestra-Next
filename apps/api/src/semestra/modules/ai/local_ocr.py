"""Local OCR of scanned pages with PaddleOCR (PP-OCR) on ONNX Runtime (M06, used by M07 §3.1).

Only self-hosted installs have it (`uv sync --extra ocr`, or the `-ocr` image, which ships every
model). Inference runs on the CPU, so the same code serves Linux containers and a Mac running the
API natively. It runs in a parse child process (`files.parse.isolated.ocr_isolated`), which loads
the engine once per document and reads its pages one at a time.
"""

import importlib.util
import io
import threading
from functools import cache
from typing import Any

from semestra.core.config import Settings
from semestra.core.context import Ctx
from semestra.modules.ai.models import AiModelAssignment

# The PP-OCR models a user can pick, smallest first; the `-ocr` image ships all of them
# (`semestra ocr-models --all`). `SEMESTRA_LOCAL_OCR_MODEL` is the one used until a user picks.
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


def download_models(model: str) -> None:
    """Fetches the models into PaddleX's cache (`PADDLE_PDX_CACHE_HOME`); the `-ocr` image runs
    this at build time for every model, so it never downloads at run time."""
    _engine(model)
