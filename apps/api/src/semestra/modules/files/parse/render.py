"""Page images: for OCR (150 DPI) and the small previews the UI shows (M07 §3.1, §4)."""

import io
import math

import pymupdf
from PIL import Image, ImageOps
from pillow_heif import register_heif_opener

OCR_DPI = 150
# A page image never has more pixels than this, whatever the page's shape: a tiny PDF can
# declare a 40 x 14400 pt page.
OCR_MAX_PIXELS = 6_000_000
THUMB_WIDTH = 480
THUMB_MAX_HEIGHT = 960
OCR_IMAGE_MAX_SIDE = 2400
MAX_IMAGE_PIXELS = 60_000_000

register_heif_opener()


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


class PageRenderer:
    """Renders pages of one file; open once, call from one thread at a time, then `close()`."""

    def __init__(self, data: bytes, *, pdf: bool) -> None:
        self._pdf = pymupdf.open(stream=data, filetype="pdf") if pdf else None
        self._image: Image.Image | None = None
        if not pdf:
            image = Image.open(io.BytesIO(data))
            if image.width * image.height > MAX_IMAGE_PIXELS:
                raise ValueError("image too large")
            self._image = ImageOps.exif_transpose(image).convert("RGB")

    def close(self) -> None:
        if self._pdf is not None:
            self._pdf.close()

    def ocr_image(self, index: int) -> bytes:
        """PNG for the vision model: the page at 150 DPI, or the whole image."""
        if self._pdf is not None:
            rect = self._pdf[index].rect
            area = max(rect.width, 1) * max(rect.height, 1)
            dpi = min(OCR_DPI, 72 * math.sqrt(OCR_MAX_PIXELS / area))
            zoom = dpi / 72
            matrix = pymupdf.Matrix(zoom, zoom)
            return self._pdf[index].get_pixmap(matrix=matrix).tobytes("png")
        assert self._image is not None
        return _png(_fit(self._image, OCR_IMAGE_MAX_SIDE, OCR_IMAGE_MAX_SIDE))

    def thumbnail(self, index: int) -> bytes:
        """A PNG at most `THUMB_WIDTH` wide and `THUMB_MAX_HEIGHT` tall."""
        if self._pdf is not None:
            page = self._pdf[index]
            zoom = min(
                THUMB_WIDTH / max(page.rect.width, 1), THUMB_MAX_HEIGHT / max(page.rect.height, 1)
            )
            return page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom)).tobytes("png")
        assert self._image is not None
        return _png(_fit(self._image, THUMB_WIDTH, THUMB_MAX_HEIGHT))
