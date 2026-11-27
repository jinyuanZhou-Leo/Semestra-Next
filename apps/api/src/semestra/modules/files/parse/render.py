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
# An image more than this many times as tall as wide (a long screenshot, not a phone's usual one
# at about 2.2) is split into parts for a model, top to bottom, each at most
# `MODEL_IMAGE_MAX_SIDE` tall: scaled whole, its text would be too small to read. At most
# `MAX_PARTS` parts; past that they are taller and scaled.
TALL_RATIO = 3
MAX_PARTS = 20
# A PDF page more than `TALL_RATIO` times as tall as wide (a OneNote page, a long scroll of
# notes) is cut into parts about this many times as tall as wide, each rendered like a page of
# its own, overlapping by `PART_OVERLAP` of a part so a line on a cut is whole in one of them.
PART_RATIO = 1.5
PART_OVERLAP = 0.04
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


@dataclass(frozen=True)
class OcrLine:
    """A line local OCR read on a page: its text, how sure the engine is (0 to 1) and its box on
    the page (left, top, right, bottom; page points for a PDF, pixels for an image)."""

    text: str
    score: float
    box: tuple[float, float, float, float]


@dataclass(frozen=True)
class OcrPart:
    """A part of a page for the local OCR engine: its PNG, where it is on the page (`left`,
    `top`, in page points, or pixels for an image) and how many pixels a point is, so what the
    engine finds can be placed on the page; and the band of the page (`owns`) whose lines this
    part reports, so a line in the overlap of two parts is reported once."""

    png: bytes
    left: float
    top: float
    zoom: float
    owns: tuple[float, float]


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


def _opaque(image: Image.Image) -> Image.Image:
    """RGB with transparent parts on white: converting alone keeps the color of transparent
    pixels, usually black, so black text on a transparent background became all black."""
    if image.mode in ("RGBA", "LA", "PA") or "transparency" in image.info:
        rgba = image.convert("RGBA")
        return Image.alpha_composite(Image.new("RGBA", rgba.size, "white"), rgba).convert("RGB")
    return image.convert("RGB")


def _parts(image: Image.Image) -> int:
    if image.height <= TALL_RATIO * image.width:
        return 1
    width = min(image.width, MODEL_IMAGE_MAX_SIDE)
    return min(MAX_PARTS, math.ceil(image.height * width / image.width / MODEL_IMAGE_MAX_SIDE))


def _matrix(zoom: float) -> pymupdf.Matrix:
    import pymupdf

    return pymupdf.Matrix(zoom, zoom)


class PageRenderer:
    """Renders pages of one file; open once, call from one thread at a time, then `close()`.

    An image is one page, or with `split_tall` (for a model to look at) a long one is several:
    its parts, top to bottom (`TALL_RATIO`)."""

    def __init__(self, data: bytes, *, pdf: bool, split_tall: bool = False) -> None:
        # Imported here, like in `readers._pdf`: pages render in child processes only.
        import pymupdf

        self._pdf: pymupdf.Document | None = (
            pymupdf.open(stream=data, filetype="pdf") if pdf else None
        )
        self._image: Image.Image | None = None
        self._parts = 1
        if not pdf:
            image = Image.open(io.BytesIO(data))
            if image.width * image.height > MAX_IMAGE_PIXELS:
                raise ValueError("image too large")
            self._image = _opaque(ImageOps.exif_transpose(image))
            if split_tall:
                self._parts = _parts(self._image)

    @property
    def page_count(self) -> int:
        return self._pdf.page_count if self._pdf is not None else self._parts

    def close(self) -> None:
        if self._pdf is not None:
            self._pdf.close()

    def model_image(self, index: int) -> PageImage:
        """The page as a model sees it: at most 150 DPI, `OCR_MAX_PIXELS` and
        `MODEL_IMAGE_MAX_SIDE` a side; or the image (or its part), upright, scaled to that side."""
        return _for_model(self._page(index, MODEL_IMAGE_MAX_SIDE))

    def model_parts(self, index: int) -> list[PageImage]:
        """The page for a model to read, top to bottom: one image, or for a tall page (a PDF
        page or an image more than `TALL_RATIO` times as tall as wide) its parts, each as sharp
        as a page of its own would be."""
        return [_for_model(image) for image, *_ in self._parts_of(index, MODEL_IMAGE_MAX_SIDE)]

    def local_ocr_png(self, index: int) -> bytes:
        """The page for the local OCR engine, which runs here, not at a provider: no side limit
        for PDF pages (150 DPI, `OCR_MAX_PIXELS`), so a large page keeps its small print."""
        return _png(self._page(index, None))

    def local_ocr_parts(self, index: int) -> list[OcrPart]:
        """`local_ocr_png`, a tall page in parts (`model_parts`)."""
        return [
            OcrPart(_png(image), left, top, zoom, owns)
            for image, left, top, zoom, owns in self._parts_of(index, None)
        ]

    def _parts_of(
        self, index: int, max_side: int | None
    ) -> list[tuple[Image.Image, float, float, float, tuple[float, float]]]:
        """Each part's image, its top-left corner and zoom, and the band it owns."""
        if self._pdf is not None:
            import pymupdf

            rect = self._pdf[index].rect
            width, height = max(rect.width, 1), max(rect.height, 1)
            count = 1
            if height > TALL_RATIO * width:
                count = min(MAX_PARTS, math.ceil(height / (width * PART_RATIO)))
            step = height / count
            overlap = step * PART_OVERLAP if count > 1 else 0
            out: list[tuple[Image.Image, float, float, float, tuple[float, float]]] = []
            for part in range(count):
                top, bottom = (
                    max(0, part * step - overlap),
                    min(height, (part + 1) * step + overlap),
                )
                clip = pymupdf.Rect(rect.x0, rect.y0 + top, rect.x1, rect.y0 + bottom)
                image, zoom = self._render_pdf(index, max_side, clip)
                out.append((image, 0.0, top, zoom, (part * step, (part + 1) * step)))
            return out
        assert self._image is not None
        image = self._image
        count = 1 if self._parts > 1 else _parts(image)  # split_tall: each part is a page
        if count == 1:
            fitted = self._page(index, max_side)
            return [(fitted, 0.0, 0.0, fitted.width / image.width, (0.0, float(image.height)))]
        out = []
        for part in range(count):
            top, bottom = (image.height * i // count for i in (part, part + 1))
            fitted = _fit(
                image.crop((0, top, image.width, bottom)),
                *(2 * (max_side or LOCAL_OCR_IMAGE_MAX_SIDE,)),
            )
            out.append(
                (fitted, 0.0, float(top), fitted.width / image.width, (float(top), float(bottom)))
            )
        return out

    def _render_pdf(
        self, index: int, max_side: int | None, clip: pymupdf.Rect | None = None
    ) -> tuple[Image.Image, float]:
        """The page (or the part of it in `clip`) at most 150 DPI and `OCR_MAX_PIXELS`, and at
        most `max_side` a side; with the zoom it was drawn at (pixels per point)."""
        assert self._pdf is not None
        page = self._pdf[index]
        area = clip if clip is not None else page.rect
        width, height = max(area.width, 1), max(area.height, 1)
        dpi = min(OCR_DPI, 72 * math.sqrt(OCR_MAX_PIXELS / (width * height)))
        if max_side is not None:
            dpi = min(dpi, 72 * max_side / max(width, height))
        pixmap = page.get_pixmap(matrix=_matrix(dpi / 72), clip=clip)
        image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
        if max_side is not None:  # PyMuPDF rounds the size up: a pixel more than asked
            image = _fit(image, max_side, max_side)
        return image, image.width / width

    def _page(self, index: int, max_side: int | None) -> Image.Image:
        if self._pdf is not None:
            return self._render_pdf(index, max_side)[0]
        assert self._image is not None
        image = self._image
        if self._parts > 1:
            top, bottom = (image.height * i // self._parts for i in (index, index + 1))
            image = image.crop((0, top, image.width, bottom))
        side = max_side or LOCAL_OCR_IMAGE_MAX_SIDE
        return _fit(image, side, side)

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
