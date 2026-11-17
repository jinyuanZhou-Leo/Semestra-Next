"""Page images: what models see (OCR, timetables, the assistant) and the small previews the UI
shows (M07 §3.1, §4)."""

import io
import math
from dataclasses import dataclass
from typing import TYPE_CHECKING

from PIL import Image, ImageOps
from pillow_heif import register_heif_opener

OCR_DPI = 150
# A page image never has more pixels than this, whatever the page's shape: a tiny PDF can
# declare a 40 x 14400 pt page.
OCR_MAX_PIXELS = 6_000_000
# A page image for a model is at most this long a side: providers scale larger ones down before
# looking (Anthropic to about 1568 px), so more pixels would only cost bytes and tokens.
MODEL_IMAGE_MAX_SIDE = 1600
# A PNG larger than this (a page with photos) is sent as JPEG instead: well under every
# provider's limit per image (Anthropic: 5 MB), and the pages of a request stay small.
PNG_MAX_BYTES = 800_000
JPEG_QUALITY = 85
LOCAL_OCR_IMAGE_MAX_SIDE = 2400
THUMB_WIDTH = 480
THUMB_MAX_HEIGHT = 960
MAX_IMAGE_PIXELS = 60_000_000

register_heif_opener()

if TYPE_CHECKING:
    import pymupdf


@dataclass(frozen=True)
class PageImage:
    data: bytes
    media_type: str


def _for_model(image: Image.Image) -> PageImage:
    """PNG keeps text sharp; a page whose PNG is large (photos) goes as JPEG."""
    png = _png(image)
    if len(png) <= PNG_MAX_BYTES:
        return PageImage(png, "image/png")
    out = io.BytesIO()
    image.convert("RGB").save(out, "JPEG", quality=JPEG_QUALITY, optimize=True)
    return PageImage(out.getvalue(), "image/jpeg")


def _png(image: Image.Image) -> bytes:
    out = io.BytesIO()
    image.save(out, "PNG", optimize=True)
    return out.getvalue()


def _fit(image: Image.Image, width: int, height: int) -> Image.Image:
    """Scaled down (never up) to fit in `width` by `height`."""
    factor = min(width / image.width, height / image.height)
    if factor >= 1:
        return image
    return image.resize((max(1, round(image.width * factor)), max(1, round(image.height * factor))))


def _matrix(zoom: float) -> pymupdf.Matrix:
    import pymupdf

    return pymupdf.Matrix(zoom, zoom)


class PageRenderer:
    """Renders pages of one file; open once, call from one thread at a time, then `close()`."""

    def __init__(self, data: bytes, *, pdf: bool) -> None:
        # Imported here, like in `readers._pdf`: pages render in child processes only.
        import pymupdf

        self._pdf: pymupdf.Document | None = (
            pymupdf.open(stream=data, filetype="pdf") if pdf else None
        )
        self._image: Image.Image | None = None
        if not pdf:
            image = Image.open(io.BytesIO(data))
            if image.width * image.height > MAX_IMAGE_PIXELS:
                raise ValueError("image too large")
            self._image = ImageOps.exif_transpose(image).convert("RGB")

    @property
    def page_count(self) -> int:
        return self._pdf.page_count if self._pdf is not None else 1

    def close(self) -> None:
        if self._pdf is not None:
            self._pdf.close()

    def model_image(self, index: int) -> PageImage:
        """The page as a model sees it: at most 150 DPI, `OCR_MAX_PIXELS` and
        `MODEL_IMAGE_MAX_SIDE` a side; or the whole image, upright, scaled to that side."""
        return _for_model(self._page(index, MODEL_IMAGE_MAX_SIDE))

    def local_ocr_png(self, index: int) -> bytes:
        """The page for the local OCR engine, which runs here, not at a provider: no side limit
        for PDF pages (150 DPI, `OCR_MAX_PIXELS`), so a large page keeps its small print."""
        return _png(self._page(index, None))

    def _page(self, index: int, max_side: int | None) -> Image.Image:
        if self._pdf is not None:
            page = self._pdf[index]
            width, height = max(page.rect.width, 1), max(page.rect.height, 1)
            dpi = min(OCR_DPI, 72 * math.sqrt(OCR_MAX_PIXELS / (width * height)))
            if max_side is not None:
                dpi = min(dpi, 72 * max_side / max(width, height))
            pixmap = page.get_pixmap(matrix=_matrix(dpi / 72))
            return Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
        assert self._image is not None
        side = max_side or LOCAL_OCR_IMAGE_MAX_SIDE
        return _fit(self._image, side, side)

    def thumbnail(self, index: int) -> bytes:
        """A PNG at most `THUMB_WIDTH` wide and `THUMB_MAX_HEIGHT` tall."""
        if self._pdf is not None:
            page = self._pdf[index]
            zoom = min(
                THUMB_WIDTH / max(page.rect.width, 1), THUMB_MAX_HEIGHT / max(page.rect.height, 1)
            )
            return page.get_pixmap(matrix=_matrix(zoom)).tobytes("png")
        assert self._image is not None
        return _png(_fit(self._image, THUMB_WIDTH, THUMB_MAX_HEIGHT))
