"""Local OCR of scanned pages with PaddleOCR (PP-OCR) on ONNX Runtime (M06, used by M07 §3.1).

Only self-hosted installs have it (`uv sync --extra ocr`, or the `-ocr` image, which ships the
models). Inference runs on the CPU, so the same code serves Linux containers and a Mac running the
API natively. The engine is loaded once, on first use, and pages are read one at a time.
"""

import importlib.util
import io
import threading
from functools import cache
from typing import Any

from semestra.core.config import Settings

_LOCK = threading.Lock()
_ENGINES: dict[str, Any] = {}


@cache
def _installed() -> bool:
    return all(importlib.util.find_spec(m) is not None for m in ("paddleocr", "onnxruntime"))


def available(settings: Settings) -> bool:
    return settings.local_ocr and _installed()


def model_tag(settings: Settings) -> str:
    """Goes into the parser fingerprint, so changing the model re-reads documents."""
    return f"local:{settings.local_ocr_model}"


def _engine(model: str) -> Any:
    with _LOCK:
        if model not in _ENGINES:
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


def recognize(settings: Settings, png: bytes) -> str:
    """The page's text, one detected line per line in reading order. Blocking: call it in a
    worker thread."""
    import numpy as np  # pyright: ignore[reportMissingImports]
    from PIL import Image

    # PaddleOCR takes arrays in OpenCV's channel order (BGR).
    image = np.array(Image.open(io.BytesIO(png)).convert("RGB"))[:, :, ::-1]
    engine = _engine(settings.local_ocr_model)
    with _LOCK:  # one page at a time: the engine is not thread-safe and uses every core
        results = list(engine.predict(input=image))
    lines: list[str] = []
    for result in results:
        lines += [str(t).strip() for t in result.get("rec_texts", []) if str(t).strip()]
    return "\n".join(lines)


def download_models(model: str) -> None:
    """Fetches the models into PaddleX's cache (`PADDLE_PDX_CACHE_HOME`); the `-ocr` image runs
    this at build time so the server never downloads at run time."""
    _engine(model)
