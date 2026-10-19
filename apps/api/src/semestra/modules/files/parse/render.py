"""Page images: for OCR (150 DPI) and the small previews the UI shows (M07 §3.1, §4)."""

import io

import pymupdf
from PIL import Image, ImageOps
from pillow_heif import register_heif_opener

OCR_DPI = 150
THUMB_WIDTH = 480
OCR_IMAGE_MAX_SIDE = 2400
MAX_IMAGE_PIXELS = 60_000_000

register_heif_opener()


def _png(image: Image.Image) -> bytes:
    out = io.BytesIO()
    image.save(out, "PNG", optimize=True)
    return out.getvalue()


def _scaled(
    image: Image.Image, longest: int | None = None, width: int | None = None
) -> Image.Image:
    if width is not None and image.width > width:
        return image.resize((width, round(image.height * width / image.width)))
    if longest is not None and max(image.size) > longest:
        factor = longest / max(image.size)
        return image.resize((round(image.width * factor), round(image.height * factor)))
    return image


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
            return self._pdf[index].get_pixmap(dpi=OCR_DPI).tobytes("png")
        assert self._image is not None
        return _png(_scaled(self._image, longest=OCR_IMAGE_MAX_SIDE))

    def thumbnail(self, index: int) -> bytes:
        """A PNG about `THUMB_WIDTH` wide."""
        if self._pdf is not None:
            page = self._pdf[index]
            zoom = THUMB_WIDTH / max(page.rect.width, 1)
            return page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom)).tobytes("png")
        assert self._image is not None
        return _png(_scaled(self._image, width=THUMB_WIDTH))
